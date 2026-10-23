import { NextRequest, NextResponse } from 'next/server'
import { autoCompleteOverdueOutcomes } from '@/lib/auto-outcomes'

// Called when an evaluation or the evaluations list is opened, so outcomes
// are up to date the moment someone looks. Safe to call repeatedly: it only
// ever fills in outcomes that are still empty on open evaluations.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const changed = await autoCompleteOverdueOutcomes(typeof body.evaluationId === 'string' ? body.evaluationId : undefined)
  return NextResponse.json({ changed })
}
