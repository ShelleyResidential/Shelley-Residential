import { supabaseAdmin } from '@/lib/supabase-admin'
import { getValidAccessToken } from '@/lib/calendar-tokens'
import {
  copyDriveFile, replaceTextInDoc, exportDocAsPdf, deleteDriveFile,
  getDocument, findParagraphsByText, deleteParagraphRanges,
} from '@/lib/google-docs'
import { DOCUMENTS_BUCKET } from '@/lib/evaluation-documents'
import {
  ROAD_LEVEL_OPTS, LAND_SIZE_OPTS, GATE_FENCING_OPTS, GARAGE_DESC_OPTS, PARKING_OPTS,
  SIZE_OPTS, GARDEN_DESC_OPTS, GOOD_POOR_OPTS, FINISH_OPTS, KITCHEN_POS_OPTS,
  RECEPTION_TYPE_OPTS, STUDY_TYPE_OPTS, FLATLET_BED_OPTS,
  PATIO_OPTIONS, SECURITY_OPTIONS, CONDITION_ITEMS, ADDITIONAL_OPTS, conditionLabel,
} from '@/lib/inspection-options'

const TEMPLATE_DOC_ID = process.env.GOOGLE_INSPECTION_FORM_TEMPLATE_ID

type Result = { ok: boolean; error?: string }
type Opt = { value: string; label: string }

// A ☑/❏ line for every option, matching the printed template's own
// checkbox-list style -- built from the same option arrays the Inspection
// tab UI uses, so the wording on paper can never drift from the app.
function checkLine(opts: Opt[], selected: string): string {
  return opts.map(o => `${o.value === selected ? '☑' : '❏'} ${o.label}`).join('   ')
}
function checkLineStrings(opts: string[], selected: string[]): string {
  return opts.map(o => `${selected.includes(o) ? '☑' : '❏'} ${o}`).join('   ')
}
function yesNo(value: boolean | null): string {
  return `${value === true ? '☑' : '❏'} Yes   ${value === false ? '☑' : '❏'} No`
}

// How many pre-built slots the template has for each repeating section --
// fixed by the template's own layout, not by anything in the app. If a
// property has more units than this, the slots that exist still get filled
// and the quantity cell still shows the true total -- it's just that only
// this many get their own individually-detailed line.
const REPEATING_SECTIONS = [
  { prefix: 'patio',     label: 'Entertainment Patio', slots: 2 },
  { prefix: 'flatlet',   label: 'Flatlet',             slots: 2 },
  { prefix: 'bedroom',   label: 'Bedroom',             slots: 5 },
  { prefix: 'study',     label: 'Study',                slots: 2 },
  { prefix: 'bathroom',  label: 'Bathroom',             slots: 4 },
  { prefix: 'guest_loo', label: 'Guest Loo',            slots: 2 },
] as const

// Generates (or regenerates) an evaluation's Inspection Form: copies the
// Google Doc template, deletes whichever repeating-section slot lines go
// unused (a 2-bedroom property gets Bedroom 1/2 and nothing else, not 5
// lines with 3 left blank), fills in every merge field, exports to PDF, and
// stores it the same way Cover Letter does. Purely Generate-button-driven --
// unlike the Cover Letter, this never auto-generates, since there's nothing
// to fill in until the agent has actually saved an inspection.
export async function generateInspectionForm(evaluationId: string, userId: string): Promise<Result> {
  if (!TEMPLATE_DOC_ID) return { ok: false, error: 'Inspection form template is not configured' }

  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) return { ok: false, error: 'Google account not connected' }

  const { data: ev } = await supabaseAdmin
    .from('evaluations')
    .select(`
      sellers_agent_user_id,
      properties (street_number, street_name, suburb),
      evaluation_contacts (
        is_primary, sort_order,
        contacts (first_name, last_name, phone_number, email_address),
        picklist_options:tag_option_id (label)
      )
    `)
    .eq('id', evaluationId)
    .single()

  if (!ev) return { ok: false, error: 'Evaluation not found' }

  type ContactRow = {
    is_primary: boolean
    sort_order: number | null
    contacts: { first_name: string; last_name: string; phone_number: string | null; email_address: string | null } | null
    picklist_options: { label: string } | null
  }
  const contactRows = ((ev.evaluation_contacts as unknown as ContactRow[]) ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const seller = contactRows.find(c => c.picklist_options?.label === 'Seller')
    ?? contactRows.find(c => c.is_primary)
    ?? contactRows[0]

  if (!seller?.contacts) {
    return { ok: false, error: 'Add a contact to this evaluation before generating an inspection form.' }
  }
  if (!ev.sellers_agent_user_id) {
    return { ok: false, error: 'Set an Agent on this evaluation before generating an inspection form.' }
  }
  const { data: agent } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email')
    .eq('id', ev.sellers_agent_user_id)
    .single()
  if (!agent) return { ok: false, error: 'Set an Agent on this evaluation before generating an inspection form.' }

  const prop = ev.properties as unknown as { street_number: string | null; street_name: string | null; suburb: string | null } | null
  const addressLabel = [prop?.street_number, prop?.street_name].filter(Boolean).join(' ') || 'Property'

  const { data: insp } = await supabaseAdmin
    .from('property_inspections')
    .select('*')
    .eq('evaluation_id', evaluationId)
    .maybeSingle()

  if (!insp) return { ok: false, error: 'Complete the Inspection tab before generating this form.' }

  // Decoded exactly the way InspectionTab.loadInspection decodes the same
  // row for the app's own UI -- comma-joined TEXT columns, JSON-TEXT columns.
  let generalCondition: { feature: string; condition: string }[] = []
  try { generalCondition = insp.general_condition ? JSON.parse(insp.general_condition) : [] } catch { generalCondition = [] }
  let patioSelections: string[][] = []
  try { patioSelections = insp.patio_descriptions ? JSON.parse(insp.patio_descriptions) : [] } catch { patioSelections = [] }
  const bedroomSizes       = insp.bedroom_sizes ? insp.bedroom_sizes.split(',') : []
  const bathroomConditions = insp.bathroom_conditions ? insp.bathroom_conditions.split(',') : []
  const guestLooConditions = insp.guest_loo_conditions ? insp.guest_loo_conditions.split(',') : []
  const studyTypes         = insp.study_types ? insp.study_types.split(',') : []
  const flatletTypes       = insp.flatlet_bedroom_type ? insp.flatlet_bedroom_type.split(',') : []
  const securityFeatures   = insp.security_features ? insp.security_features.split(',') : []
  const additionalFeatures = insp.additional_features ? insp.additional_features.split(',') : []

  const actualByPrefix: Record<string, number> = {
    patio:     insp.patio_quantity ?? 0,
    flatlet:   insp.flatlet_quantity ?? 0,
    bedroom:   insp.bedrooms_quantity ?? 0,
    study:     insp.study_quantity ?? 0,
    bathroom:  insp.bathrooms_quantity ?? 0,
    guest_loo: insp.guest_loo_quantity ?? 0,
  }

  // 1. Copy the template into a throwaway file the caller owns.
  const copy = await copyDriveFile(accessToken, TEMPLATE_DOC_ID, `Inspection Form - ${addressLabel}`)
  if (copy.error || !copy.id) {
    return { ok: false, error: copy.error?.message ?? 'Failed to copy the inspection form template' }
  }

  // 2. Delete unused repeating-section slot lines FIRST, while their
  // placeholder text ("{{bedroom_4}}") and label text ("Bedroom 4") are
  // still simple, unique strings to locate -- doing this after filling in
  // real data would risk a filled value accidentally containing the same
  // text as another slot's placeholder. A table cell can never be left with
  // zero paragraphs, so a section with 0 units keeps slot 1 (blanked via
  // replaceTextInDoc below, not deleted) and only slots 2..max are deleted.
  const docResult = await getDocument(accessToken, copy.id)
  if (docResult.error || !docResult.document) {
    await deleteDriveFile(accessToken, copy.id)
    return { ok: false, error: docResult.error?.message ?? 'Failed to read the inspection form template structure' }
  }

  const deleteTargets: string[] = []
  for (const section of REPEATING_SECTIONS) {
    const actual = actualByPrefix[section.prefix]
    const filledCount = Math.min(actual, section.slots)
    const firstToDelete = actual === 0 ? 2 : filledCount + 1
    for (let slot = firstToDelete; slot <= section.slots; slot++) {
      deleteTargets.push(`{{${section.prefix}_${slot}}}`)
      deleteTargets.push(`${section.label} ${slot}`)
    }
  }

  const ranges = findParagraphsByText(docResult.document, deleteTargets)
    .sort((a, b) => b.startIndex - a.startIndex)
    .map(r => ({ startIndex: r.startIndex, endIndex: r.endIndex }))

  if (ranges.length > 0) {
    const delResult = await deleteParagraphRanges(accessToken, copy.id, ranges)
    if (delResult.error) {
      await deleteDriveFile(accessToken, copy.id)
      return { ok: false, error: delResult.error.message }
    }
  }

  // 3. Fill in every remaining placeholder.
  const replacements: Record<string, string> = {
    '{{PropertyAddress}}': addressLabel,
    '{{Suburb}}':          prop?.suburb ?? '',
    "{{Agent's Name}}":    agent.full_name ?? agent.email ?? '',
    '{{ Seller Name | Seller Number | Seller Email }}': [
      [seller.contacts.first_name, seller.contacts.last_name].filter(Boolean).join(' '),
      seller.contacts.phone_number,
      seller.contacts.email_address,
    ].filter(Boolean).join(' | '),

    '{{road_level_position}}': checkLine(ROAD_LEVEL_OPTS, insp.road_level_position ?? ''),
    '{{land_size}}':           checkLine(LAND_SIZE_OPTS, insp.land_size ?? ''),
    '{{gate_fencing_type}}':   checkLine(GATE_FENCING_OPTS, insp.gate_fencing_type ?? ''),

    '{{garages_quantity}}':   String(insp.garages_quantity ?? 0),
    '{{garages_descriptor}}': checkLine(GARAGE_DESC_OPTS, insp.garages_descriptor ?? ''),
    '{{carports_quantity}}':  String(insp.carports_quantity ?? 0),
    '{{parking_capacity}}':   checkLine(PARKING_OPTS, insp.parking_capacity ?? ''),

    '{{garden}}':       `${yesNo(insp.garden_present)}   Size: ${checkLine(SIZE_OPTS, insp.garden_size ?? '')}   Description: ${checkLine(GARDEN_DESC_OPTS, insp.garden_description ?? '')}`,
    '{{tennis_court}}': `${yesNo(insp.tennis_court_present)}   Condition: ${checkLine(GOOD_POOR_OPTS, insp.tennis_court_condition ?? '')}`,
    '{{pool}}':         `${yesNo(insp.pool_present)}   Condition: ${checkLine(GOOD_POOR_OPTS, insp.pool_condition ?? '')}`,
    '{{jacuzzi}}':      `${yesNo(insp.jacuzzi_present)}   Condition: ${checkLine(GOOD_POOR_OPTS, insp.jacuzzi_status ?? '')}`,

    '{{patio_quantity}}':             String(insp.patio_quantity ?? 0),
    '{{views_present}}':              yesNo(insp.views_present),
    '{{domestic_quarters_quantity}}': String(insp.domestic_quarters_quantity ?? 0),
    '{{flatlet_quantity}}':           String(insp.flatlet_quantity ?? 0),

    '{{lounges_quantity}}':     String(insp.lounges_quantity ?? 0),
    '{{dining_room_quantity}}': String(insp.dining_room_quantity ?? 0),
    '{{other_reception}}': `${yesNo(insp.other_reception_present)}   Type: ${checkLine(RECEPTION_TYPE_OPTS, insp.other_reception_type ?? '')}   If Other: ${insp.other_reception_type === 'other' ? (insp.other_reception_type_other || '') : '________________'}`,
    '{{kitchen}}': `Size: ${checkLine(SIZE_OPTS, insp.kitchen_size ?? '')}   Finish: ${checkLine(FINISH_OPTS, insp.kitchen_finish ?? '')}   Position: ${checkLine(KITCHEN_POS_OPTS, insp.kitchen_position ?? '')}`,
    '{{scullery_laundry_present}}': yesNo(insp.scullery_laundry_present),

    '{{bedrooms_quantity}}':  String(insp.bedrooms_quantity ?? 0),
    '{{study_quantity}}':     String(insp.study_quantity ?? 0),
    '{{bathrooms_quantity}}': String(insp.bathrooms_quantity ?? 0),
    '{{guest_loo_quantity}}': String(insp.guest_loo_quantity ?? 0),

    '{{security}}': `${yesNo(insp.security_present)}   ${checkLineStrings(SECURITY_OPTIONS, securityFeatures)}`,
    '{{general_condition}}': CONDITION_ITEMS.map(item => {
      const entry = generalCondition.find(c => c.feature === item)
      const opts: Opt[] = [
        { value: 'good', label: conditionLabel(item, 'good') },
        { value: 'poor', label: conditionLabel(item, 'poor') },
      ]
      return `${item} ${checkLine(opts, entry?.condition ?? '')}`
    }).join('   '),
    '{{additional_features}}': checkLineStrings(ADDITIONAL_OPTS, additionalFeatures),
  }

  for (let i = 0; i < Math.min(actualByPrefix.patio, 2); i++) {
    replacements[`{{patio_${i + 1}}}`] = checkLineStrings(PATIO_OPTIONS, patioSelections[i] ?? [])
  }
  for (let i = 0; i < Math.min(actualByPrefix.flatlet, 2); i++) {
    replacements[`{{flatlet_${i + 1}}}`] = checkLine(FLATLET_BED_OPTS, flatletTypes[i] ?? '')
  }
  for (let i = 0; i < Math.min(actualByPrefix.bedroom, 5); i++) {
    replacements[`{{bedroom_${i + 1}}}`] = checkLine(SIZE_OPTS, bedroomSizes[i] ?? '')
  }
  for (let i = 0; i < Math.min(actualByPrefix.study, 2); i++) {
    replacements[`{{study_${i + 1}}}`] = checkLine(STUDY_TYPE_OPTS, studyTypes[i] ?? '')
  }
  for (let i = 0; i < Math.min(actualByPrefix.bathroom, 4); i++) {
    replacements[`{{bathroom_${i + 1}}}`] = checkLine(FINISH_OPTS, bathroomConditions[i] ?? '')
  }
  for (let i = 0; i < Math.min(actualByPrefix.guest_loo, 2); i++) {
    replacements[`{{guest_loo_${i + 1}}}`] = checkLine(FINISH_OPTS, guestLooConditions[i] ?? '')
  }

  // Sections with 0 units kept slot 1's paragraph (it was never deleted
  // above) -- resolve its placeholder to nothing rather than leaving the
  // literal "{{x_1}}" text showing.
  for (const section of REPEATING_SECTIONS) {
    if (actualByPrefix[section.prefix] === 0) replacements[`{{${section.prefix}_1}}`] = ''
  }

  const fillResult = await replaceTextInDoc(accessToken, copy.id, replacements)
  if (fillResult.error) {
    await deleteDriveFile(accessToken, copy.id)
    return { ok: false, error: fillResult.error.message }
  }

  // 4. Export the filled-in copy to PDF.
  const pdf = await exportDocAsPdf(accessToken, copy.id)
  if (pdf.error || !pdf.bytes) {
    await deleteDriveFile(accessToken, copy.id)
    return { ok: false, error: pdf.error ?? 'Failed to export the inspection form to PDF' }
  }

  // 5. Discard the intermediate Doc copy -- only the PDF sticks around.
  await deleteDriveFile(accessToken, copy.id)

  // 6. Store it exactly like Cover Letter: replace any previous inspection
  // form for this evaluation.
  const { data: existing } = await supabaseAdmin
    .from('evaluation_documents')
    .select('storage_path')
    .eq('evaluation_id', evaluationId)
    .eq('report_type', 'inspection_form')
    .maybeSingle()

  if (existing) {
    await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([existing.storage_path])
  }

  const fileName    = `Inspection Form - ${addressLabel}.pdf`
  const storagePath = `${evaluationId}/inspection_form/${Date.now()}-${fileName}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, pdf.bytes, { contentType: 'application/pdf', upsert: true })

  if (uploadError) return { ok: false, error: uploadError.message }

  const { error: dbError } = await supabaseAdmin.from('evaluation_documents').upsert(
    {
      evaluation_id:       evaluationId,
      report_type:         'inspection_form',
      file_name:           fileName,
      storage_path:        storagePath,
      uploaded_by_user_id: userId,
      uploaded_at:         new Date().toISOString(),
    },
    { onConflict: 'evaluation_id,report_type' },
  )

  if (dbError) return { ok: false, error: dbError.message }

  return { ok: true }
}
