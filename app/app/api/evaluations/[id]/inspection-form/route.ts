import { NextRequest, NextResponse } from 'next/server'
import { generateInspectionForm } from '@/lib/inspection-form'

// Copying/restructuring/filling/exporting a Google Doc is several sequential
// round-trips to Google (more than Cover Letter -- this also reads the doc
// structure and deletes unused repeating-section lines) -- give it more
// headroom than the platform default.
export const maxDuration = 90

// Only ever called from the Inspection Form card's Generate/Regenerate
// button -- unlike Cover Letter, this never auto-generates, since there's
// nothing to fill in until the agent has saved an inspection.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: evaluationId } = await params
  const { userId } = await request.json()

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const result = await generateInspectionForm(evaluationId, userId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Generation failed' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
