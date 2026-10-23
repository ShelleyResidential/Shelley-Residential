import { NextRequest, NextResponse } from 'next/server'
import { generateInspectionForm } from '@/lib/inspection-form'

// Same Google Doc round-trips as the filled-in form, so the same headroom.
export const maxDuration = 90

// The paper version of the Inspection Form: nothing ticked, no quantities.
// Returned straight as a PDF download -- it's identical every time for a
// property, so there's nothing to store.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: evaluationId } = await params
  const { userId } = await request.json()

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const result = await generateInspectionForm(evaluationId, userId, { blank: true })
  if (!result.ok || !result.bytes) {
    return NextResponse.json({ error: result.error ?? 'Generation failed' }, { status: 400 })
  }

  return new Response(result.bytes, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${(result.fileName ?? 'Blank Inspection Form.pdf').replace(/"/g, '')}"`,
    },
  })
}
