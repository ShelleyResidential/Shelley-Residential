'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { card, sectionTitle } from '@/lib/styles'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { STATUS_LABELS, STATUS_ORDER, getNextAction, type PipelineStepRow } from '@/lib/pipeline'
import { useRouter } from 'next/navigation'

type Profile = { id: string; full_name: string | null; email: string | null }

type EvalRow = {
  id: string
  status: string
  date_captured: string
  created_at: string
  evaluation_price: number | null
  marketing_price: number | null
  sellers_agent_user_id: string | null
  lead_source_other_text: string | null
  lead_source_picklist: { label: string } | null
  motivation_for_selling_notes: string | null
  motivation_picklist: { label: string } | null
  evaluation_outcome: string | null
  reason_lost: string | null
  reason_cancelled: string | null
  presentation_outcome: string | null
  cma_approved_at: string | null
  cma_rejected_at: string | null
  original_scheduled_at: string | null
  reschedule_count: number | null
}

type ContactRow = { id: string; status: string | null; date_added: string | null }

type PropertyRow = { id: string; property_type: string | null; suburb: string | null; evaluations: { id: string }[] }

type AuditEventRow = {
  evaluation_id: string
  event_type: string
  description: string
  metadata: { from?: string | null; to?: string | null; outcome?: string | null } | null
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  freehold:        'Freehold',
  sectional_title: 'Sectional Title',
  vacant_land:     'Vacant Land',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function countBy<T>(items: T[], keyFn: (item: T) => string | null): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = keyFn(item)
    if (!key) continue
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function topEntries(counts: Record<string, number>, limit: number): [string, number][] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit)
}

// "12h" under a day, "3.2d" otherwise -- these SLA turnarounds are measured
// in hours per the brief (CMA Turnaround target: 24h, CMA Approval target:
// 4 working hours), so hours-first reads more naturally than "0.5 days".
function formatDuration(hours: number): string {
  if (hours < 24) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

export default function AnalysePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [evaluations, setEvaluations] = useState<EvalRow[]>([])
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStepRow[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditEventRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/') })

    async function load() {
      setLoading(true)
      const [{ data: evalData }, { data: stepData }, { data: auditData }, { data: contactData }, { data: propertyData }, { data: profileData }] = await Promise.all([
        supabase.from('evaluations').select(`
          id, status, date_captured, created_at, evaluation_price, marketing_price, sellers_agent_user_id,
          lead_source_other_text, lead_source_picklist:lead_source_option_id (label),
          motivation_for_selling_notes, motivation_picklist:motivation_for_selling_option_id (label),
          evaluation_outcome, reason_lost, reason_cancelled, presentation_outcome,
          cma_approved_at, cma_rejected_at, original_scheduled_at, reschedule_count
        `),
        supabase.from('evaluation_pipeline_steps')
          .select('evaluation_id, step_key, status, is_complete, owner_role, owner_user_id, due_date, sort_order, completed_at'),
        // status_changed + follow_up_logged feed Average Time in Status and
        // Presentation Follow-up turnaround below -- everything else on this
        // page reads straight off evaluations/pipeline_steps columns, which
        // already carry the single timestamp each of those needs.
        supabase.from('evaluation_audit_events')
          .select('evaluation_id, event_type, description, metadata, created_at')
          .in('event_type', ['status_changed', 'follow_up_logged', 'presentation_outcome_recorded'])
          .order('created_at', { ascending: true }),
        supabase.from('contacts').select('id, status, date_added'),
        supabase.from('properties').select('id, property_type, suburb, evaluations (id)'),
        supabase.from('profiles').select('id, full_name, email'),
      ])

      setEvaluations((evalData ?? []) as unknown as EvalRow[])
      setPipelineSteps((stepData ?? []) as unknown as PipelineStepRow[])
      setAuditEvents((auditData ?? []) as unknown as AuditEventRow[])
      setContacts(contactData ?? [])
      setProperties((propertyData ?? []) as unknown as PropertyRow[])
      const map: Record<string, Profile> = {}
      for (const p of (profileData ?? []) as Profile[]) map[p.id] = p
      setProfiles(map)
      setLoading(false)
    }
    load()
  }, [router])

  if (loading) {
    return <div className="p-10 text-center text-gray-400 text-sm">Loading analytics…</div>
  }

  const now = new Date()

  // ── Evaluations analytics ──────────────────────────────────
  const totalEvaluations = evaluations.length
  const wonCount  = evaluations.filter(e => e.evaluation_outcome === 'won').length
  const lostCount = evaluations.filter(e => e.evaluation_outcome === 'lost').length
  const winRate   = (wonCount + lostCount) > 0 ? (wonCount / (wonCount + lostCount)) * 100 : null
  const avgEvalPrice = average(evaluations.map(e => e.evaluation_price).filter((v): v is number => v != null))
  const avgMarketingPrice = average(evaluations.map(e => e.marketing_price).filter((v): v is number => v != null))

  const statusCounts = countBy(evaluations, e => e.status)
  // Fixed order matching the real 8-stage pipeline (STATUS_ORDER from
  // lib/pipeline), not a "top N by count" list -- this table used to use
  // its own separate, stale status list that predated statuses like
  // Prepared/Inspected/Presentation Ready entirely.
  const statusEntries: [string, number][] = STATUS_ORDER
    .map(s => [s, statusCounts[s] ?? 0] as [string, number])
    .filter(([, count]) => count > 0)

  const leadSourceCounts = countBy(evaluations, e => e.lead_source_picklist?.label ?? e.lead_source_other_text ?? null)
  const leadSourceEntries = topEntries(leadSourceCounts, 6)

  const motivationCounts = countBy(evaluations, e => e.motivation_picklist?.label ?? e.motivation_for_selling_notes ?? null)
  const motivationEntries = topEntries(motivationCounts, 6)

  const lostReasonCounts = countBy(evaluations.filter(e => e.evaluation_outcome === 'lost'), e => e.reason_lost)
  const lostReasonEntries = topEntries(lostReasonCounts, 8)
  const lostReasonTotal = evaluations.filter(e => e.evaluation_outcome === 'lost').length

  const cancelledReasonCounts = countBy(evaluations.filter(e => e.evaluation_outcome === 'cancelled'), e => e.reason_cancelled)
  const cancelledReasonEntries = topEntries(cancelledReasonCounts, 8)
  const cancelledReasonTotal = evaluations.filter(e => e.evaluation_outcome === 'cancelled').length

  // Last 6 months trend
  const monthBuckets: { key: string; label: string }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthBuckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-ZA', { month: 'short' }) })
  }
  const monthCounts: Record<string, number> = {}
  for (const e of evaluations) {
    const d = new Date(e.date_captured)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    monthCounts[key] = (monthCounts[key] ?? 0) + 1
  }
  const maxMonthCount = Math.max(1, ...monthBuckets.map(b => monthCounts[b.key] ?? 0))

  // Agent leaderboard
  const agentStats: Record<string, { total: number; won: number }> = {}
  for (const e of evaluations) {
    if (!e.sellers_agent_user_id) continue
    const s = agentStats[e.sellers_agent_user_id] ?? { total: 0, won: 0 }
    s.total += 1
    if (e.evaluation_outcome === 'won') s.won += 1
    agentStats[e.sellers_agent_user_id] = s
  }
  const topAgents = Object.entries(agentStats)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)

  // ── Pipeline & SLA ──────────────────────────────────────────
  const stepsByEvaluation: Record<string, PipelineStepRow[]> = {}
  for (const s of pipelineSteps) {
    if (!stepsByEvaluation[s.evaluation_id!]) stepsByEvaluation[s.evaluation_id!] = []
    stepsByEvaluation[s.evaluation_id!].push(s)
  }

  // Overdue Next Actions -- Rule R7/BR-03's Next Action, reused from the
  // evaluations list/detail pages, just counted here instead of shown per row.
  const overdueNextActions = evaluations.filter(e => e.status !== 'closed').filter(e => {
    const na = getNextAction(stepsByEvaluation[e.id] ?? [])
    return !!na?.due_date && new Date(na.due_date) < now
  }).length

  // CMA Turnaround (Property Inspected -> CMA Conducted) and CMA Approval
  // Turnaround (CMA Conducted -> Approved/Rejected) -- both read straight
  // off existing completed_at/cma_approved_at/cma_rejected_at timestamps,
  // no audit log needed for these two specifically.
  const cmaTurnaroundHours: number[] = []
  const cmaApprovalTurnaroundHours: number[] = []
  for (const e of evaluations) {
    const steps = stepsByEvaluation[e.id] ?? []
    const inspectedStep  = steps.find(s => s.step_key === 'property_inspected')
    const conductedStep  = steps.find(s => s.step_key === 'cma_conducted')
    if (inspectedStep?.completed_at && conductedStep?.completed_at) {
      cmaTurnaroundHours.push((new Date(conductedStep.completed_at).getTime() - new Date(inspectedStep.completed_at).getTime()) / 3_600_000)
    }
    const decidedAt = e.cma_approved_at ?? e.cma_rejected_at
    if (conductedStep?.completed_at && decidedAt) {
      cmaApprovalTurnaroundHours.push((new Date(decidedAt).getTime() - new Date(conductedStep.completed_at).getTime()) / 3_600_000)
    }
  }

  // Reschedule Rate -- reuses reschedule_count directly; "ever scheduled"
  // is anything with an original_scheduled_at, immutable once first set.
  const everScheduled = evaluations.filter(e => e.original_scheduled_at)
  const rescheduleRate = everScheduled.length > 0
    ? (everScheduled.filter(e => (e.reschedule_count ?? 0) > 0).length / everScheduled.length) * 100
    : null

  // Presentation Follow-up turnaround -- the one metric that genuinely
  // needs the audit log's event history: presentation_outcome_recorded
  // only captures the CURRENT value, and last_followed_up_at only tracks
  // the MOST RECENT follow-up, neither tells you the time to the FIRST
  // follow-up after presenting.
  const presentedEvents = auditEvents.filter(ev => ev.event_type === 'presentation_outcome_recorded' && ev.metadata?.outcome === 'completed')
  const followUpEvents  = auditEvents.filter(ev => ev.event_type === 'follow_up_logged')
  const followUpTurnaroundHours: number[] = []
  for (const e of evaluations) {
    const presentedAt = presentedEvents.find(ev => ev.evaluation_id === e.id)?.created_at
    if (!presentedAt) continue
    const firstFollowUp = followUpEvents
      .filter(ev => ev.evaluation_id === e.id && ev.created_at > presentedAt)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
    if (firstFollowUp) {
      followUpTurnaroundHours.push((new Date(firstFollowUp.created_at).getTime() - new Date(presentedAt).getTime()) / 3_600_000)
    }
  }

  // Average Time in Status -- reconstructed from status_changed events
  // (evaluations.status is a single current value with no history on its
  // own). Only COMPLETED segments count -- an evaluation currently
  // sitting in a stage right now hasn't finished that stage yet, so its
  // still-open segment is excluded rather than dragging the average down.
  const statusChangedByEval: Record<string, AuditEventRow[]> = {}
  for (const ev of auditEvents) {
    if (ev.event_type !== 'status_changed') continue
    if (!statusChangedByEval[ev.evaluation_id]) statusChangedByEval[ev.evaluation_id] = []
    statusChangedByEval[ev.evaluation_id].push(ev)
  }
  const statusDurationsMs: Record<string, number[]> = {}
  for (const e of evaluations) {
    const events = statusChangedByEval[e.id] ?? []
    let prevTs = new Date(e.created_at).getTime()
    for (const ev of events) {
      const status = ev.metadata?.from ?? 'new'
      const ts = new Date(ev.created_at).getTime()
      if (!statusDurationsMs[status]) statusDurationsMs[status] = []
      statusDurationsMs[status].push(ts - prevTs)
      prevTs = ts
    }
  }
  const avgTimeInStatus: [string, number][] = STATUS_ORDER
    .filter(s => statusDurationsMs[s]?.length)
    .map(s => [s, average(statusDurationsMs[s]) / 86_400_000] as [string, number])

  // Conversion funnel -- "ever presented" reads presentation_outcome
  // directly (it's what actually drives the presentation_completed
  // pipeline step in the app, so it's just as reliable and one join
  // simpler) rather than the CURRENT status, since a since-Closed
  // evaluation no longer shows "Presented" as its current status.
  const everPresentedCount = evaluations.filter(e => e.presentation_outcome === 'completed').length
  const evalToPresentedRate = totalEvaluations > 0 ? (everPresentedCount / totalEvaluations) * 100 : null
  const presentedToWonRate  = everPresentedCount > 0 ? (wonCount / everPresentedCount) * 100 : null
  const newToWonRate        = totalEvaluations > 0 ? (wonCount / totalEvaluations) * 100 : null

  // ── Contacts analytics ─────────────────────────────────────
  const totalContacts = contacts.length
  const activeContacts = contacts.filter(c => c.status === 'Active').length
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const newThisMonth = contacts.filter(c => c.date_added && new Date(c.date_added) >= startOfMonth).length

  // ── Properties analytics ───────────────────────────────────
  const totalProperties = properties.length
  const withEvaluation = properties.filter(p => (p.evaluations ?? []).length > 0).length
  const typeCounts = countBy(properties, p => p.property_type)
  const typeEntries = topEntries(typeCounts, 10)
  const suburbCounts = countBy(properties, p => p.suburb)
  const suburbEntries = topEntries(suburbCounts, 5)

  return (
    <div className="p-10">
      <Breadcrumbs items={[{ label: 'Analyse' }]} />
      <h1 className="text-2xl font-bold text-[#1a1a1a] mb-8">Analyse</h1>

      {/* ══ EVALUATIONS ══ */}
      <h2 className={sectionTitle}>Evaluations</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <StatCard label="Total Evaluations" value={totalEvaluations} />
        <StatCard label="Win Rate" value={winRate != null ? `${winRate.toFixed(0)}%` : '—'} sub={`${wonCount} won · ${lostCount} lost`} />
        <StatCard label="Avg Evaluation Price" value={avgEvalPrice ? formatCurrency(avgEvalPrice) : '—'} />
        <StatCard label="Avg Marketing Price" value={avgMarketingPrice ? formatCurrency(avgMarketingPrice) : '—'} />
      </div>

      {/* ── Pipeline & SLA ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <StatCard label="Overdue Next Actions" value={overdueNextActions} sub={overdueNextActions === 0 ? 'None ideal' : undefined} />
        <StatCard label="Reschedule Rate" value={rescheduleRate != null ? `${rescheduleRate.toFixed(0)}%` : '—'} />
        <StatCard label="CMA Turnaround" value={cmaTurnaroundHours.length ? formatDuration(average(cmaTurnaroundHours)) : '—'} sub="Target ≤ 24h" />
        <StatCard label="CMA Approval Turnaround" value={cmaApprovalTurnaroundHours.length ? formatDuration(average(cmaApprovalTurnaroundHours)) : '—'} sub="Target ≤ 4h" />
        <StatCard label="Presentation Follow-up" value={followUpTurnaroundHours.length ? formatDuration(average(followUpTurnaroundHours)) : '—'} sub="Target ≤ 24h" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">By Status</p>
          {statusEntries.length === 0 ? <EmptyNote /> : (
            <div className="space-y-2.5">
              {statusEntries.map(([status, count]) => (
                <BarRow key={status}
                  label={STATUS_LABELS[status] ?? status}
                  count={count}
                  total={totalEvaluations}
                  colour="#E8266F"
                />
              ))}
            </div>
          )}
        </div>

        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Average Time in Status</p>
          {avgTimeInStatus.length === 0 ? (
            <p className="text-sm text-gray-400">No completed stage transitions yet.</p>
          ) : (
            <div className="space-y-2.5">
              {avgTimeInStatus.map(([status, days]) => (
                <div key={status} className="flex items-center justify-between text-sm">
                  <span className="text-[#1a1a1a]">{STATUS_LABELS[status] ?? status}</span>
                  <span className="text-gray-400">{days < 1 ? `${(days * 24).toFixed(1)}h` : `${days.toFixed(1)}d`} avg</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Conversion Funnel</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#1a1a1a]">Evaluation → Presented</span>
              <span className="text-gray-400">{evalToPresentedRate != null ? `${evalToPresentedRate.toFixed(0)}%` : '—'} ({everPresentedCount}/{totalEvaluations})</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#1a1a1a]">Presented → Won</span>
              <span className="text-gray-400">{presentedToWonRate != null ? `${presentedToWonRate.toFixed(0)}%` : '—'} ({wonCount}/{everPresentedCount})</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#1a1a1a]">Evaluation → Won</span>
              <span className="text-gray-400">{newToWonRate != null ? `${newToWonRate.toFixed(0)}%` : '—'} ({wonCount}/{totalEvaluations})</span>
            </div>
          </div>
        </div>

        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Captured Per Month</p>
          {totalEvaluations === 0 ? <EmptyNote /> : (
            <div className="flex items-end gap-3 h-32">
              {monthBuckets.map(b => {
                const count = monthCounts[b.key] ?? 0
                const heightPct = (count / maxMonthCount) * 100
                return (
                  <div key={b.key} className="flex-1 flex flex-col items-center justify-end h-full">
                    <span className="text-xs text-gray-400 mb-1">{count}</span>
                    <div className="w-full rounded-t-md bg-[#E8266F]" style={{ height: `${Math.max(heightPct, count > 0 ? 4 : 0)}%` }} />
                    <span className="text-xs text-gray-400 mt-1.5">{b.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Top Agents</p>
          {topAgents.length === 0 ? <EmptyNote /> : (
            <div className="space-y-3">
              {topAgents.map(([userId, stats]) => {
                const agent = profiles[userId]
                const agentWinRate = stats.total > 0 ? (stats.won / stats.total) * 100 : 0
                return (
                  <div key={userId} className="flex items-center justify-between text-sm">
                    <span className="text-[#1a1a1a] font-medium">{agent?.full_name ?? agent?.email ?? 'Unknown'}</span>
                    <span className="text-gray-400">{stats.total} evaluation{stats.total !== 1 ? 's' : ''} · {agentWinRate.toFixed(0)}% won</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Lead Source</p>
          {leadSourceEntries.length === 0 ? <EmptyNote /> : (
            <div className="space-y-2.5">
              {leadSourceEntries.map(([source, count]) => (
                <BarRow key={source} label={source} count={count} total={totalEvaluations} colour="#1a1a1a" />
              ))}
            </div>
          )}
        </div>
      </div>

      {motivationEntries.length > 0 && (
        <div className={`${card} p-6 mb-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Motivation for Selling</p>
          <div className="space-y-2.5">
            {motivationEntries.map(([motivation, count]) => (
              <BarRow key={motivation} label={motivation} count={count} total={totalEvaluations} colour="#1a1a1a" />
            ))}
          </div>
        </div>
      )}

      {(lostReasonEntries.length > 0 || cancelledReasonEntries.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
          {lostReasonEntries.length > 0 && (
            <div className={`${card} p-6`}>
              <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Lost Reason Mix</p>
              <div className="space-y-2.5">
                {lostReasonEntries.map(([reason, count]) => (
                  <BarRow key={reason} label={reason} count={count} total={lostReasonTotal} colour="#ef4444" />
                ))}
              </div>
            </div>
          )}
          {cancelledReasonEntries.length > 0 && (
            <div className={`${card} p-6`}>
              <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Cancelled Reason Mix</p>
              <div className="space-y-2.5">
                {cancelledReasonEntries.map(([reason, count]) => (
                  <BarRow key={reason} label={reason} count={count} total={cancelledReasonTotal} colour="#6b7280" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ CONTACTS ══ */}
      <h2 className={sectionTitle}>Contacts</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Contacts" value={totalContacts} />
        <StatCard label="Active" value={activeContacts} sub={totalContacts ? `${((activeContacts / totalContacts) * 100).toFixed(0)}% of total` : undefined} />
        <StatCard label="Added This Month" value={newThisMonth} />
      </div>

      {/* ══ PROPERTIES ══ */}
      <h2 className={sectionTitle}>Properties</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Properties" value={totalProperties} />
        <StatCard label="With Evaluation" value={withEvaluation} sub={totalProperties ? `${((withEvaluation / totalProperties) * 100).toFixed(0)}% of total` : undefined} />
        <StatCard label="Without Evaluation" value={totalProperties - withEvaluation} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">By Type</p>
          {typeEntries.length === 0 ? <EmptyNote /> : (
            <div className="space-y-2.5">
              {typeEntries.map(([type, count]) => (
                <BarRow key={type} label={TYPE_LABELS[type] ?? type} count={count} total={totalProperties} colour="#1a1a1a" />
              ))}
            </div>
          )}
        </div>

        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Top Suburbs</p>
          {suburbEntries.length === 0 ? <EmptyNote /> : (
            <div className="space-y-2.5">
              {suburbEntries.map(([suburb, count]) => (
                <BarRow key={suburb} label={suburb} count={count} total={totalProperties} colour="#1a1a1a" />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared presentational pieces ──────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className={`${card} p-5`}>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-bold text-[#1a1a1a]">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function BarRow({ label, count, total, colour }: { label: string; count: number; total: number; colour: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-[#1a1a1a] capitalize truncate pr-2">{label}</span>
        <span className="text-gray-400 flex-shrink-0">{count} · {pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: colour }} />
      </div>
    </div>
  )
}

function EmptyNote() {
  return <p className="text-sm text-gray-400">No data yet.</p>
}
