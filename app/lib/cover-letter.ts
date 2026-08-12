import { supabaseAdmin } from '@/lib/supabase-admin'
import { getValidAccessToken } from '@/lib/calendar-tokens'
import { copyDriveFile, replaceTextInDoc, exportDocAsPdf, deleteDriveFile } from '@/lib/google-docs'
import { DOCUMENTS_BUCKET } from '@/lib/evaluation-documents'

const TEMPLATE_DOC_ID = process.env.GOOGLE_COVER_LETTER_TEMPLATE_ID

type Result = { ok: boolean; error?: string }

// Generates (or regenerates) an evaluation's Cover Letter: copies the
// Google Doc template, fills in the seller/agent merge fields, exports the
// copy to PDF, stores that PDF the same way the other Transfer Report
// cards store their uploads, and discards the intermediate Doc copy.
// Called automatically once, right after an evaluation is created with a
// contact attached, and again on demand from the card's Regenerate button.
export async function generateCoverLetter(evaluationId: string, userId: string): Promise<Result> {
  if (!TEMPLATE_DOC_ID) return { ok: false, error: 'Cover letter template is not configured' }

  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) return { ok: false, error: 'Google account not connected' }

  const { data: ev } = await supabaseAdmin
    .from('evaluations')
    .select(`
      sellers_agent_user_id,
      properties (street_number, street_name),
      evaluation_contacts (
        is_primary, sort_order,
        contacts (first_name, last_name),
        picklist_options:tag_option_id (label)
      )
    `)
    .eq('id', evaluationId)
    .single()

  if (!ev) return { ok: false, error: 'Evaluation not found' }

  type ContactRow = {
    is_primary: boolean
    sort_order: number | null
    contacts: { first_name: string; last_name: string } | null
    picklist_options: { label: string } | null
  }
  const contactRows = ((ev.evaluation_contacts as unknown as ContactRow[]) ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const seller = contactRows.find(c => c.picklist_options?.label === 'Seller')
    ?? contactRows.find(c => c.is_primary)
    ?? contactRows[0]

  if (!seller?.contacts) {
    return { ok: false, error: 'Add a contact to this evaluation before generating a cover letter.' }
  }

  if (!ev.sellers_agent_user_id) {
    return { ok: false, error: 'Set an Agent on this evaluation before generating a cover letter.' }
  }
  const { data: agent } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email, phone_number, designation, property_practitioner_status, property_practitioner_qualification, ffc_number')
    .eq('id', ev.sellers_agent_user_id)
    .single()

  if (!agent) return { ok: false, error: 'Set an Agent on this evaluation before generating a cover letter.' }

  const prop = ev.properties as unknown as { street_number: string | null; street_name: string | null } | null
  const addressLabel = [prop?.street_number, prop?.street_name].filter(Boolean).join(' ') || 'Property'

  // 1. Copy the template into a throwaway file the caller owns.
  const copy = await copyDriveFile(accessToken, TEMPLATE_DOC_ID, `Cover Letter - ${addressLabel}`)
  if (copy.error || !copy.id) {
    return { ok: false, error: copy.error?.message ?? 'Failed to copy the cover letter template' }
  }

  // 2. Fill in the merge fields. Note: the template has "PPRE" as fixed text
  // directly before {{property_practitioner_qualification}}, so that value
  // is just "NQF4"/"NQF5" -- no prefix added here.
  const fillResult = await replaceTextInDoc(accessToken, copy.id, {
    '{{seller_names}}':                        seller.contacts.first_name,
    '{{agent_name}}':                          agent.full_name ?? agent.email ?? '',
    '{{designation}}':                         agent.designation ?? '',
    '{{property_practitioner_status}}':        agent.property_practitioner_status ?? '',
    '{{property_practitioner_qualification}}': agent.property_practitioner_qualification ?? '',
    '{{ffc_number}}':                          agent.ffc_number ?? '',
    '{{agent_number}}':                        agent.phone_number ?? '',
    '{{agent_email}}':                         agent.email ?? '',
  })
  if (fillResult.error) {
    await deleteDriveFile(accessToken, copy.id)
    return { ok: false, error: fillResult.error.message }
  }

  // 3. Export the filled-in copy to PDF.
  const pdf = await exportDocAsPdf(accessToken, copy.id)
  if (pdf.error || !pdf.bytes) {
    await deleteDriveFile(accessToken, copy.id)
    return { ok: false, error: pdf.error ?? 'Failed to export the cover letter to PDF' }
  }

  // 4. Discard the intermediate Doc copy -- only the PDF sticks around.
  await deleteDriveFile(accessToken, copy.id)

  // 5. Store it exactly like the other Transfer Report cards: replace any
  // previous cover letter for this evaluation.
  const { data: existing } = await supabaseAdmin
    .from('evaluation_documents')
    .select('storage_path')
    .eq('evaluation_id', evaluationId)
    .eq('report_type', 'cover_letter')
    .maybeSingle()

  if (existing) {
    await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([existing.storage_path])
  }

  const fileName    = `Cover Letter - ${addressLabel}.pdf`
  const storagePath = `${evaluationId}/cover_letter/${Date.now()}-${fileName}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, pdf.bytes, { contentType: 'application/pdf', upsert: true })

  if (uploadError) return { ok: false, error: uploadError.message }

  const { error: dbError } = await supabaseAdmin.from('evaluation_documents').upsert(
    {
      evaluation_id:       evaluationId,
      report_type:         'cover_letter',
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
