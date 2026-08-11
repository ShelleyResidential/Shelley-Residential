import { NextRequest, NextResponse } from 'next/server'
import { generateCoverLetter } from '@/lib/cover-letter'

// Copying/filling/exporting a Google Doc is a handful of sequential
// round-trips to Google -- give it more headroom than the platform default.
export const maxDuration = 60

// Used both by the automatic "generate on evaluation creation" call and the
// Cover Letter card's Generate/Regenerate button.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: evaluationId } = await params
  const { userId } = await request.json()

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const result = await generateCoverLetter(evaluationId, userId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Generation failed' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
