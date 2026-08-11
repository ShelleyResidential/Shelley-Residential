import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { DOCUMENTS_BUCKET, REPORT_TYPES } from '@/lib/evaluation-documents'

// Uploads (or replaces) the file for one of an evaluation's three Transfer
// Report cards. One file per (evaluation, report type) -- uploading again
// deletes the previous object from storage before storing the new one, so
// nothing orphaned piles up in the bucket.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: evaluationId } = await params
  const formData   = await request.formData()
  const file       = formData.get('file')
  const reportType = formData.get('report_type')
  const userId     = formData.get('user_id')

  if (!(file instanceof File) || typeof reportType !== 'string' || typeof userId !== 'string') {
    return NextResponse.json({ error: 'Missing file, report_type, or user_id' }, { status: 400 })
  }
  if (!REPORT_TYPES.some(r => r.key === reportType)) {
    return NextResponse.json({ error: 'Invalid report type' }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from('evaluation_documents')
    .select('storage_path')
    .eq('evaluation_id', evaluationId)
    .eq('report_type', reportType)
    .maybeSingle()

  if (existing) {
    await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([existing.storage_path])
  }

  const storagePath = `${evaluationId}/${reportType}/${Date.now()}-${file.name}`
  const bytes = await file.arrayBuffer()

  const { error: uploadError } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: file.type || 'application/octet-stream', upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { error: dbError } = await supabaseAdmin.from('evaluation_documents').upsert(
    {
      evaluation_id:       evaluationId,
      report_type:         reportType,
      file_name:           file.name,
      storage_path:        storagePath,
      uploaded_by_user_id: userId,
      uploaded_at:         new Date().toISOString(),
    },
    { onConflict: 'evaluation_id,report_type' },
  )

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
