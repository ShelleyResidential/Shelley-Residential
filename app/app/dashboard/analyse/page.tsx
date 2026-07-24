'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { card, sectionTitle } from '@/lib/styles'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { useRouter } from 'next/navigation'

type Profile = { id: string; full_name: string | null; email: string | null }

type EvalRow = {
  id: string
  status: string
  date_captured: string
  evaluation_price: number | null
  marketing_price: number | null
  sellers_agent_user_id: string | null
  lead_source_other_text: string | null
  lead_source_picklist: { label: string } | null
  motivation_for_selling_notes: string | null
  motivation_picklist: { label: string } | null
}

type ContactRow = { id: string; status: string | null; tags: string[] | null; date_added: string | null }

type PropertyRow = { id: string; property_type: string | null; suburb: string | null; evaluations: { id: string }[] }

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  new:         { label: 'New',            colour: '#3b82f6' },
  scheduled:   { label: 'Scheduled',      colour: '#6366f1' },
  completed:   { label: 'Completed',      colour: '#14b8a6' },
  presented:   { label: 'Presented',      colour: '#a855f7' },
  follow_up:   { label: 'Follow-Up',      colour: '#eab308' },
  won:         { label: 'Won',            colour: '#10b981' },
  lost:        { label: 'Lost',           colour: '#ef4444' },
  cancelled:   { label: 'Cancelled',      colour: '#9ca3af' },
  in_progress: { label: 'In Progress',    colour: '#3b82f6' },
  open:        { label: 'Open Mandate',   colour: '#22c55e' },
  future:      { label: 'Future Mandate', colour: '#eab308' },
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

export default function AnalysePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [evaluations, setEvaluations] = useState<EvalRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/') })

    async function load() {
      setLoading(true)
      const [{ data: evalData }, { data: contactData }, { data: propertyData }, { data: profileData }] = await Promise.all([
        supabase.from('evaluations').select(`
          id, status, date_captured, evaluation_price, marketing_price, sellers_agent_user_id,
          lead_source_other_text, lead_source_picklist:lead_source_option_id (label),
          motivation_for_selling_notes, motivation_picklist:motivation_for_selling_option_id (label)
        `),
        supabase.from('contacts').select('id, status, tags, date_added'),
        supabase.from('properties').select('id, property_type, suburb, evaluations (id)'),
        supabase.from('profiles').select('id, full_name, email'),
      ])

      setEvaluations((evalData ?? []) as unknown as EvalRow[])
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

  // ── Evaluations analytics ──────────────────────────────────
  const totalEvaluations = evaluations.length
  const wonCount  = evaluations.filter(e => e.status === 'won').length
  const lostCount = evaluations.filter(e => e.status === 'lost').length
  const winRate   = (wonCount + lostCount) > 0 ? (wonCount / (wonCount + lostCount)) * 100 : null
  const avgEvalPrice = average(evaluations.map(e => e.evaluation_price).filter((v): v is number => v != null))
  const avgMarketingPrice = average(evaluations.map(e => e.marketing_price).filter((v): v is number => v != null))

  const statusCounts = countBy(evaluations, e => e.status)
  const statusEntries = topEntries(statusCounts, 20)

  const leadSourceCounts = countBy(evaluations, e => e.lead_source_picklist?.label ?? e.lead_source_other_text ?? null)
  const leadSourceEntries = topEntries(leadSourceCounts, 6)

  const motivationCounts = countBy(evaluations, e => e.motivation_picklist?.label ?? e.motivation_for_selling_notes ?? null)
  const motivationEntries = topEntries(motivationCounts, 6)

  // Last 6 months trend
  const monthBuckets: { key: string; label: string }[] = []
  const now = new Date()
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
    if (e.status === 'won') s.won += 1
    agentStats[e.sellers_agent_user_id] = s
  }
  const topAgents = Object.entries(agentStats)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)

  // ── Contacts analytics ─────────────────────────────────────
  const totalContacts = contacts.length
  const activeContacts = contacts.filter(c => c.status === 'Active').length
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const newThisMonth = contacts.filter(c => c.date_added && new Date(c.date_added) >= startOfMonth).length
  const tagCounts = countBy(contacts.flatMap(c => c.tags ?? []).map(t => ({ t })), r => r.t)
  const tagEntries = topEntries(tagCounts, 8)

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Evaluations" value={totalEvaluations} />
        <StatCard label="Win Rate" value={winRate != null ? `${winRate.toFixed(0)}%` : '—'} sub={`${wonCount} won · ${lostCount} lost`} />
        <StatCard label="Avg Evaluation Price" value={avgEvalPrice ? formatCurrency(avgEvalPrice) : '—'} />
        <StatCard label="Avg Marketing Price" value={avgMarketingPrice ? formatCurrency(avgMarketingPrice) : '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">By Status</p>
          {statusEntries.length === 0 ? <EmptyNote /> : (
            <div className="space-y-2.5">
              {statusEntries.map(([status, count]) => (
                <BarRow key={status}
                  label={STATUS_LABELS[status]?.label ?? status}
                  count={count}
                  total={totalEvaluations}
                  colour={STATUS_LABELS[status]?.colour ?? '#9ca3af'}
                />
              ))}
            </div>
          )}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
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
                <BarRow key={source} label={source} count={count} total={totalEvaluations} colour="#E8266F" />
              ))}
            </div>
          )}
        </div>
      </div>

      {motivationEntries.length > 0 && (
        <div className={`${card} p-6 mb-10`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Motivation for Selling</p>
          <div className="space-y-2.5">
            {motivationEntries.map(([motivation, count]) => (
              <BarRow key={motivation} label={motivation} count={count} total={totalEvaluations} colour="#6366f1" />
            ))}
          </div>
        </div>
      )}

      {/* ══ CONTACTS ══ */}
      <h2 className={sectionTitle}>Contacts</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Contacts" value={totalContacts} />
        <StatCard label="Active" value={activeContacts} sub={totalContacts ? `${((activeContacts / totalContacts) * 100).toFixed(0)}% of total` : undefined} />
        <StatCard label="Added This Month" value={newThisMonth} />
      </div>

      <div className={`${card} p-6 mb-10`}>
        <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">By Tag</p>
        {tagEntries.length === 0 ? <EmptyNote /> : (
          <div className="space-y-2.5">
            {tagEntries.map(([tag, count]) => (
              <BarRow key={tag} label={tag} count={count} total={totalContacts} colour="#14b8a6" />
            ))}
          </div>
        )}
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
                <BarRow key={type} label={TYPE_LABELS[type] ?? type} count={count} total={totalProperties} colour="#3b82f6" />
              ))}
            </div>
          )}
        </div>

        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">Top Suburbs</p>
          {suburbEntries.length === 0 ? <EmptyNote /> : (
            <div className="space-y-2.5">
              {suburbEntries.map(([suburb, count]) => (
                <BarRow key={suburb} label={suburb} count={count} total={totalProperties} colour="#a855f7" />
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
