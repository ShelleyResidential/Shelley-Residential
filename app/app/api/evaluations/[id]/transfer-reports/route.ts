import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { DOCUMENTS_BUCKET, REPORT_TYPES } from '@/lib/evaluation-documents'

// Zipping a handful of storage downloads is a few sequential round-trips --
// give it more headroom than the platform default.
export const maxDuration = 60

// Bundles all of an evaluation's Transfer Reports into a single zip so the
// browser only has to do one download instead of one per file (Chrome and
// friends silently drop automatic downloads after the first when a page
// triggers several at once). Which reports are required depends on the
// property type -- same split as the Transfer Reports card itself.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: evaluationId } = await params

  const { data: ev } = await supabaseAdmin
    .from('evaluations')
    .select('properties (street_number, street_name, property_type)')
    .eq('id', evaluationId)
    .single()

  if (!ev) {
    return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 })
  }

  const prop = ev.properties as unknown as { street_number: string | null; street_name: string | null; property_type: string | null } | null
  const addressLabel = [prop?.street_number, prop?.street_name].filter(Boolean).join(' ') || 'Property'

  const requiredTypes = prop?.property_type === 'sectional_title'
    ? REPORT_TYPES.map(rt => rt.key)
    : REPORT_TYPES.filter(rt => rt.key !== 'ss_report').map(rt => rt.key)

  const { data: docs } = await supabaseAdmin
    .from('evaluation_documents')
    .select('report_type, file_name, storage_path')
    .eq('evaluation_id', evaluationId)
    .in('report_type', requiredTypes)

  const found   = docs ?? []
  const missing = requiredTypes.filter(rt => !found.some(d => d.report_type === rt))

  if (missing.length > 0) {
    const missingLabels = missing.map(rt => REPORT_TYPES.find(r => r.key === rt)?.label ?? rt)
    return NextResponse.json(
      { error: `These Transfer Reports still need to be uploaded before you can download them: ${missingLabels.join(', ')}` },
      { status: 400 },
    )
  }

  const zip = new JSZip()
  for (const doc of found) {
    const { data: blob, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(doc.storage_path)
    if (error || !blob) {
      return NextResponse.json({ error: `Failed to fetch ${doc.file_name}` }, { status: 500 })
    }
    zip.file(doc.file_name, await blob.arrayBuffer())
  }

  const zipBytes = await zip.generateAsync({ type: 'arraybuffer' })

  return new NextResponse(zipBytes, {
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename="Transfer Reports - ${addressLabel}.zip"`,
    },
  })
}
