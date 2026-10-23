import { supabaseAdmin } from '@/lib/supabase-admin'

// Once an evaluation's appointment or presentation time has gone by, its
// outcome is assumed to be "Completed" unless someone has already recorded
// something else -- so nobody has to come back just to tick it. Anyone can
// still go and change the outcome afterwards (Rescheduled, No Show, ...).
//
// Times are stored as literal Johannesburg wall-clock digits with no
// timezone conversion (see /api/calendar/sync), so "now" has to be compared
// as Johannesburg wall-clock too: UTC+2, no daylight saving.
function nowAsJohannesburgWallClock(): string {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
}

const STATUS_RANK: Record<string, number> = {
  new: 0, scheduled: 1, prepared: 2, inspected: 3, evaluated: 4, presentation_ready: 5, presented: 6, closed: 7,
}

async function completeStep(evaluationId: string, stepKey: string) {
  await supabaseAdmin.from('evaluation_pipeline_steps').update({
    status: 'complete', is_complete: true, completed_at: new Date().toISOString(), completed_by_user_id: null,
  }).eq('evaluation_id', evaluationId).eq('step_key', stepKey).neq('status', 'complete')
}

async function promote(evaluationId: string, current: string, target: string) {
  if ((STATUS_RANK[target] ?? -1) > (STATUS_RANK[current] ?? -1)) {
    await supabaseAdmin.from('evaluations').update({ status: target }).eq('id', evaluationId)
  }
}

// Returns how many evaluations changed. Only evaluations that are still
// open (no Won/Lost/Cancelled outcome recorded) are touched, so old closed
// records are never rewritten. Pass an id to limit it to one evaluation.
export async function autoCompleteOverdueOutcomes(evaluationId?: string): Promise<number> {
  const now = nowAsJohannesburgWallClock()
  let changed = 0

  let query = supabaseAdmin
    .from('evaluations')
    .select(`
      id, status, scheduled_at, presentation_scheduled_at, presentation_outcome,
      sellers_agent_user_id, captured_by_user_id,
      property_inspections (id, appointment_outcome)
    `)
    .is('evaluation_outcome', null)
    .or(`scheduled_at.lt.${now},presentation_scheduled_at.lt.${now}`)
  if (evaluationId) query = query.eq('id', evaluationId)

  const { data: evaluations } = await query

  for (const ev of evaluations ?? []) {
    let status = ev.status as string
    let touched = false

    // The evaluation appointment itself: its Appointment Outcome.
    const inspection = (ev.property_inspections as { id: string; appointment_outcome: string | null }[] | null)?.[0]
    if (ev.scheduled_at && ev.scheduled_at < now && !inspection?.appointment_outcome) {
      if (inspection) {
        await supabaseAdmin.from('property_inspections').update({ appointment_outcome: 'completed' }).eq('id', inspection.id)
      } else {
        const { error } = await supabaseAdmin.from('property_inspections').insert({
          evaluation_id: ev.id,
          captured_by_user_id: ev.sellers_agent_user_id ?? ev.captured_by_user_id,
          appointment_outcome: 'completed',
        })
        if (error) continue
      }
      await completeStep(ev.id, 'property_inspected')
      await promote(ev.id, status, 'inspected')
      status = STATUS_RANK[status] >= STATUS_RANK.inspected ? status : 'inspected'
      touched = true
    }

    // The presentation: its Outcome.
    if (ev.presentation_scheduled_at && ev.presentation_scheduled_at < now && !ev.presentation_outcome) {
      await supabaseAdmin.from('evaluations').update({ presentation_outcome: 'completed' }).eq('id', ev.id)
      await completeStep(ev.id, 'presentation_completed')
      await promote(ev.id, status, 'presented')
      touched = true
    }

    if (touched) changed++
  }

  return changed
}
