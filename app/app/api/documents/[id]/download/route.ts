import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { DOCUMENTS_BUCKET } from '@/lib/evaluation-documents'

// The bucket is private, so a card's "Download" link points here rather
// than at storage directly -- this mints a short-lived signed URL server-
// side (using the service role, since the client never touches storage
// itself) and redirects straight to it.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: doc } = await supabaseAdmin
    .from('evaluation_documents')
    .select('storage_path, file_name')
    .eq('id', id)
    .single()

  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.file_name })

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create download link' }, { status: 500 })
  }

  return NextResponse.redirect(data.signedUrl)
}
