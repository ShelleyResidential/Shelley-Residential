import { supabase } from '@/lib/supabase'

// ── Roles ─────────────────────────────────────────────────────
// Derived from a profile's Designation (see Settings) rather than stored
// separately -- Co-Founders hold both Agent and CMA Approver powers,
// Partners are Agent-only.
export type PipelineRole = 'agent' | 'tc' | 'cma_approver'

export function getPipelineRoles(designation: string | null | undefined) {
  return {
    isAgent:       designation === 'Co-Founder' || designation === 'Partner',
    isTC:          designation === 'Transaction Coordinator' || designation === 'Head Transaction Coordinator',
    isCmaApprover: designation === 'Co-Founder',
  }
}

// Can this designation act on a step/action owned by the given role? A step
// with no owner role (null) has no restriction.
export function canActOnRole(designation: string | null | undefined, role: PipelineRole | null | undefined): boolean {
  if (!role) return true
  const roles = getPipelineRoles(designation)
  if (role === 'agent') return roles.isAgent
  if (role === 'tc') return roles.isTC
  if (role === 'cma_approver') return roles.isCmaApprover
  return true
}

// ── Pipeline steps ────────────────────────────────────────────
// The full task catalogue, in pipeline order. Seeded onto every evaluation
// at creation (see EvaluationForm's handleSubmit) and driven forward by the
// specific action each one represents -- see the mark*/check* helpers below
// for what calls each one.
export const PIPELINE_STEPS: { key: string; label: string; ownerRole: PipelineRole }[] = [
  { key: 'captured',                  label: 'Evaluation Captured',           ownerRole: 'agent' },
  { key: 'scheduled',                 label: 'Evaluation Scheduled',          ownerRole: 'agent' },
  { key: 'evaluation_form_completed', label: 'Evaluation Form Completed',     ownerRole: 'agent' },
  { key: 'lightstone_uploaded',       label: 'Transfer Reports Uploaded',     ownerRole: 'tc' },
  { key: 'evaluation_pack_prepared',  label: 'Evaluation Pack Prepared',      ownerRole: 'tc' },
  { key: 'property_inspected',        label: 'Property Inspection Completed', ownerRole: 'agent' },
  { key: 'cma_approved',              label: 'CMA Approved',                  ownerRole: 'cma_approver' },
  { key: 'mandate_pack_prepared',     label: 'Mandate Pack',                  ownerRole: 'tc' },
  { key: 'presentation_scheduled',    label: 'Presentation Scheduled',        ownerRole: 'agent' },
  { key: 'presentation_completed',    label: 'Presentation Completed',        ownerRole: 'agent' },
  { key: 'evaluation_closed',         label: 'Evaluation Outcome Recorded',   ownerRole: 'agent' },
]

// Legacy step key, seeded by evaluations created before this pipeline
// rebuild -- kept here only so old rows still render a real label instead
// of their raw key.
export const LEGACY_STEP_LABELS: Record<string, string> = {
  description_captured: 'Description Captured (legacy)',
}

export function stepLabel(stepKey: string): string {
  return PIPELINE_STEPS.find(s => s.key === stepKey)?.label ?? LEGACY_STEP_LABELS[stepKey] ?? stepKey
}

export function stepOwnerRole(stepKey: string): PipelineRole | null {
  return PIPELINE_STEPS.find(s => s.key === stepKey)?.ownerRole ?? null
}

// ── Statuses ──────────────────────────────────────────────────
export const STATUS_ORDER = [
  'new', 'scheduled', 'prepared', 'inspected', 'evaluated',
  'presentation_ready', 'presented', 'closed',
]

export const STATUS_LABELS: Record<string, string> = {
  new: 'New', scheduled: 'Scheduled', prepared: 'Prepared', inspected: 'Inspected',
  evaluated: 'Evaluated', presentation_ready: 'Presentation Ready', presented: 'Presented', closed: 'Closed',
  // Legacy statuses (kept for evaluations created before this pipeline rebuild)
  completed: 'Prepared', follow_up: 'Presented', won: 'Closed', lost: 'Closed', cancelled: 'Closed',
  in_progress: 'In Progress (legacy)', open: 'Open Mandate (legacy)', future: 'Future Mandate (legacy)',
}

export const STATUS_COLOURS: Record<string, string> = {
  new:                 'bg-blue-50 text-blue-700',
  scheduled:           'bg-indigo-50 text-indigo-700',
  prepared:            'bg-teal-50 text-teal-700',
  inspected:           'bg-cyan-50 text-cyan-700',
  evaluated:           'bg-amber-50 text-amber-700',
  presentation_ready:  'bg-orange-50 text-orange-700',
  presented:           'bg-purple-50 text-purple-700',
  closed:              'bg-gray-100 text-gray-500',
  // Legacy
  completed: 'bg-teal-50 text-teal-700', follow_up: 'bg-yellow-50 text-yellow-700',
  won: 'bg-emerald-50 text-emerald-700', lost: 'bg-red-50 text-red-600', cancelled: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-blue-50 text-blue-700', open: 'bg-green-50 text-green-700', future: 'bg-yellow-50 text-yellow-700',
}

const STATUS_RANK: Record<string, number> = Object.fromEntries(STATUS_ORDER.map((s, i) => [s, i]))

// ── Gate logic ────────────────────────────────────────────────
// Every status transition below is a promotion, never a demotion -- an
// evaluation that's already moved further along (or been set manually)
// never gets pulled backward by a gate re-check.
async function promoteStatus(evaluationId: string, targetStatus: string) {
  const { data: ev } = await supabase.from('evaluations').select('status').eq('id', evaluationId).single()
  if (!ev) return
  const currentRank = STATUS_RANK[ev.status] ?? -1
  const targetRank  = STATUS_RANK[targetStatus] ?? -1
  if (targetRank > currentRank) {
    await supabase.from('evaluations').update({ status: targetStatus }).eq('id', evaluationId)
  }
}

export async function markStepComplete(evaluationId: string, stepKey: string, userId: string) {
  await supabase.from('evaluation_pipeline_steps').update({
    status: 'complete', is_complete: true,
    completed_at: new Date().toISOString(), completed_by_user_id: userId,
  }).eq('evaluation_id', evaluationId).eq('step_key', stepKey)
}

async function isStepComplete(evaluationId: string, stepKey: string): Promise<boolean> {
  const { data } = await supabase.from('evaluation_pipeline_steps')
    .select('status').eq('evaluation_id', evaluationId).eq('step_key', stepKey).maybeSingle()
  return data?.status === 'complete'
}

// Status 3 "Prepared" -- Evaluation Form + Transfer Reports + Evaluation
// Pack all complete. Called after any one of the three changes.
const PREPARED_GATE_KEYS = ['evaluation_form_completed', 'lightstone_uploaded', 'evaluation_pack_prepared']

export async function checkPreparedGate(evaluationId: string) {
  const { data: steps } = await supabase.from('evaluation_pipeline_steps')
    .select('step_key, status').eq('evaluation_id', evaluationId).in('step_key', PREPARED_GATE_KEYS)
  const allComplete = PREPARED_GATE_KEYS.every(k => (steps ?? []).find(s => s.step_key === k)?.status === 'complete')
  if (allComplete) await promoteStatus(evaluationId, 'prepared')
}

// Status 6 "Presentation Ready" -- Mandate Pack + Presentation Date/Time
// (with calendar event) both complete.
const PRESENTATION_READY_GATE_KEYS = ['mandate_pack_prepared', 'presentation_scheduled']

export async function checkPresentationReadyGate(evaluationId: string) {
  const { data: steps } = await supabase.from('evaluation_pipeline_steps')
    .select('step_key, status').eq('evaluation_id', evaluationId).in('step_key', PRESENTATION_READY_GATE_KEYS)
  const allComplete = PRESENTATION_READY_GATE_KEYS.every(k => (steps ?? []).find(s => s.step_key === k)?.status === 'complete')
  if (allComplete) await promoteStatus(evaluationId, 'presentation_ready')
}

// Checks whether the Evaluation Form's EV-03 required-field set (everything
// except Evaluation Price / Marketing Price) is complete, marks the step,
// and re-checks the Prepared gate.
export async function checkEvaluationFormGate(evaluationId: string, userId: string, complete: boolean) {
  if (!complete) return
  await markStepComplete(evaluationId, 'evaluation_form_completed', userId)
  await checkPreparedGate(evaluationId)
}

export { isStepComplete, promoteStatus }
