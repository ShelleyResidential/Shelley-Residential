'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { STATUS_ORDER, STATUS_LABELS } from '@/lib/pipeline'
import { formatPhoneDisplay } from '@/lib/phone'
import { card, sectionTitle } from '@/lib/styles'
import type { BriefingEvent } from '@/app/api/calendar/today/route'

type Stats = {
  contacts: number
  properties: number
  evaluations: number
  evaluationsByStatus: Record<string, number>
}

export function DesktopDashboardPage() {
  const [stats, setStats] = useState<Stats>({
    contacts: 0, properties: 0, evaluations: 0, evaluationsByStatus: {},
  })
  const [loading, setLoading] = useState(true)
  const [firstName, setFirstName] = useState('')
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata ?? {}
      const name = meta.full_name ?? meta.name ?? data.user?.email?.split('@')[0] ?? ''
      setFirstName(name.split(' ')[0])
      setUserId(data.user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    async function load() {
      const [
        { count: contacts },
        { count: properties },
        { data: evData },
      ] = await Promise.all([
        supabase.from('contacts').select('*', { count: 'exact', head: true }),
        supabase.from('properties').select('*', { count: 'exact', head: true }),
        supabase.from('evaluations').select('status'),
      ])

      const evaluationsByStatus: Record<string, number> = {}
      for (const row of evData ?? []) {
        evaluationsByStatus[row.status] = (evaluationsByStatus[row.status] ?? 0) + 1
      }

      setStats({
        contacts:  contacts  ?? 0,
        properties: properties ?? 0,
        evaluations: (evData ?? []).length,
        evaluationsByStatus,
      })
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="p-4 md:p-10">
      <h1 className="text-2xl font-bold text-[#1a1a1a]">Dashboard</h1>
      <p className="text-sm text-gray-400 mb-8">Good day{firstName ? `, ${firstName}` : ', Agent'}</p>

      {/* ── Today's Briefing — the anchor feature: the agent's own Google
          Calendar for today, turned into a day-at-a-glance view. ── */}
      {userId && <TodaysBriefing userId={userId} />}

      {/* ── My Performance — the agent's own evaluations, clients and
          properties, separate from the company-wide numbers below. ── */}
      {userId && <MyPerformance userId={userId} />}

      {/* ── Top stat blocks ── */}
      <p className={sectionTitle}>Company Overview</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatBlock
          label="Total Contacts"
          value={loading ? '—' : stats.contacts}
          href="/dashboard/contacts"
        />
        <StatBlock
          label="Total Properties"
          value={loading ? '—' : stats.properties}
          href="/dashboard/properties"
        />
        <StatBlock
          label="Total Evaluations"
          value={loading ? '—' : stats.evaluations}
          href="/dashboard/evaluations"
        />
      </div>

      {/* ── Evaluations by status ── */}
      {!loading && stats.evaluations > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-5">Evaluations by Status</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {STATUS_ORDER.map(key => {
              const count = stats.evaluationsByStatus[key] ?? 0
              return (
                <Link key={key} href={`/dashboard/evaluations?status=${key}`}
                  className="flex flex-col items-center p-4 rounded-xl border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all">
                  <span className="text-2xl font-bold text-[#1a1a1a]">{count}</span>
                  <span className="text-xs font-medium mt-1 text-gray-400">{STATUS_LABELS[key]}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Agent leaderboard ── */}
      <AgentLeaderboard />
    </div>
  )
}

function StatBlock({ label, value, href }: {
  label: string; value: number | string; href: string
}) {
  return (
    <Link
      href={href}
      className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center justify-between hover:shadow-md hover:border-gray-200 transition-all"
    >
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
        <p className="text-4xl font-bold text-[#1a1a1a]">{value}</p>
      </div>
    </Link>
  )
}

// ── My Performance ──────────────────────────────────────────────
// Scoped to the signed-in agent: evaluations.sellers_agent_user_id and
// contacts.agent_id are the two columns that tie a row to a specific
// agent in this schema (properties have no agent column of their own,
// so "my properties" is derived from the properties behind my
// evaluations instead).
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

type MyEvalRow = {
  id: string
  status: string
  evaluation_outcome: string | null
  evaluation_price: number | null
  property_id: string
}

function MyPerformance({ userId }: { userId: string }) {
  const [loading, setLoading]   = useState(true)
  const [myEvals, setMyEvals]   = useState<MyEvalRow[]>([])
  const [totalContacts, setTotalContacts]   = useState(0)
  const [activeContacts, setActiveContacts] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Counts, not full row fetches, for contacts -- a busy agent's own
      // client list can run into the thousands, well past PostgREST's
      // default 1000-row cap on a plain select.
      const [{ data: evalData }, { count: contactCount }, { count: activeCount }] = await Promise.all([
        supabase.from('evaluations')
          .select('id, status, evaluation_outcome, evaluation_price, property_id')
          .eq('sellers_agent_user_id', userId),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('agent_id', userId),
        supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('agent_id', userId).eq('status', 'Active'),
      ])
      if (cancelled) return
      setMyEvals((evalData ?? []) as MyEvalRow[])
      setTotalContacts(contactCount ?? 0)
      setActiveContacts(activeCount ?? 0)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  if (loading) return null

  const totalEvals = myEvals.length
  const won  = myEvals.filter(e => e.evaluation_outcome === 'won').length
  const lost = myEvals.filter(e => e.evaluation_outcome === 'lost').length
  const winRate = (won + lost) > 0 ? (won / (won + lost)) * 100 : null

  const pricedEvals = myEvals.map(e => e.evaluation_price).filter((v): v is number => v != null)
  const avgPrice = pricedEvals.length ? pricedEvals.reduce((a, b) => a + b, 0) / pricedEvals.length : null

  const totalProperties = new Set(myEvals.map(e => e.property_id)).size

  const statusCounts: Record<string, number> = {}
  for (const e of myEvals) statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1
  const statusEntries = STATUS_ORDER
    .map(s => [s, statusCounts[s] ?? 0] as [string, number])
    .filter(([, count]) => count > 0)

  return (
    <div className="mb-8">
      <p className={sectionTitle}>My Performance</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <MetricCard label="My Evaluations" value={totalEvals} />
        <MetricCard label="Win Rate" value={winRate != null ? `${winRate.toFixed(0)}%` : '—'} sub={winRate != null ? `${won} won · ${lost} lost` : undefined} />
        <MetricCard label="My Clients" value={totalContacts} sub={totalContacts ? `${activeContacts} active` : undefined} />
        <MetricCard label="My Properties" value={totalProperties} sub={avgPrice ? `Avg ${formatCurrency(avgPrice)}` : undefined} />
      </div>

      {statusEntries.length > 0 && (
        <div className={`${card} p-6`}>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-4">My Evaluations by Status</p>
          <div className="space-y-2.5">
            {statusEntries.map(([status, count]) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <span className="text-[#1a1a1a]">{STATUS_LABELS[status] ?? status}</span>
                <span className="text-gray-400">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className={`${card} p-5`}>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-bold text-[#1a1a1a]">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Agent leaderboard ────────────────────────────────────────────
// Company-wide, unlike My Performance above -- ranks every agent by
// evaluation volume and win rate. Same grouping/sort as the "Top Agents"
// card on the Analyse page (sellers_agent_user_id, top 5 by total).
type LeaderboardEvalRow = { sellers_agent_user_id: string | null; evaluation_outcome: string | null }
type Profile = { id: string; full_name: string | null; email: string | null }

function AgentLeaderboard() {
  const [loading, setLoading] = useState(true)
  const [evals, setEvals]     = useState<LeaderboardEvalRow[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: evalData }, { data: profileData }] = await Promise.all([
        supabase.from('evaluations').select('sellers_agent_user_id, evaluation_outcome'),
        supabase.from('profiles').select('id, full_name, email'),
      ])
      if (cancelled) return
      setEvals((evalData ?? []) as LeaderboardEvalRow[])
      const map: Record<string, Profile> = {}
      for (const p of (profileData ?? []) as Profile[]) map[p.id] = p
      setProfiles(map)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) return null

  const agentStats: Record<string, { total: number; won: number }> = {}
  for (const e of evals) {
    if (!e.sellers_agent_user_id) continue
    const s = agentStats[e.sellers_agent_user_id] ?? { total: 0, won: 0 }
    s.total += 1
    if (e.evaluation_outcome === 'won') s.won += 1
    agentStats[e.sellers_agent_user_id] = s
  }
  const topAgents = Object.entries(agentStats).sort((a, b) => b[1].total - a[1].total).slice(0, 5)

  if (topAgents.length === 0) return null

  return (
    <div className={`${card} p-6 mb-6`}>
      <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-5">Agent Leaderboard</p>
      <div className="space-y-3">
        {topAgents.map(([userId, s], i) => {
          const agent = profiles[userId]
          const agentWinRate = s.total > 0 ? (s.won / s.total) * 100 : 0
          return (
            <div key={userId} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-gray-300 font-bold flex-shrink-0">{i + 1}</span>
              <span className="text-[#1a1a1a] font-medium flex-1 truncate">{agent?.full_name ?? agent?.email ?? 'Unknown'}</span>
              <span className="text-gray-400 flex-shrink-0">{s.total} evaluation{s.total !== 1 ? 's' : ''} · {agentWinRate.toFixed(0)}% won</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Today's Briefing ────────────────────────────────────────────
const KIND_BADGE: Record<BriefingEvent['kind'], { label: string; className: string } | null> = {
  evaluation:   { label: 'Evaluation',   className: 'bg-[#E8266F]/10 text-[#E8266F]' },
  presentation: { label: 'Presentation', className: 'bg-purple-50 text-purple-700' },
  other:        null,
}

function TodaysBriefing({ userId }: { userId: string }) {
  const [events, setEvents]     = useState<BriefingEvent[]>([])
  const [connected, setConnected] = useState(true)
  const [loading, setLoading]   = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [unreadCount, setUnreadCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/calendar/today', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        setConnected(data.connected ?? true)
        setEvents(data.events ?? [])
        if (data.error) setErrorMsg(data.error)
      })
      .catch(() => { if (!cancelled) setErrorMsg('Could not load your calendar.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    let cancelled = false
    // Best-effort, separate from the calendar fetch above -- until an agent
    // next logs in and picks up the gmail.readonly scope top-up, this call
    // will fail with an insufficient-scope error, and the count should just
    // stay hidden rather than showing an error in the briefing card.
    fetch('/api/gmail/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
      .then(res => res.json())
      .then(data => { if (!cancelled) setUnreadCount(typeof data.count === 'number' ? data.count : null) })
      .catch(() => { if (!cancelled) setUnreadCount(null) })
    return () => { cancelled = true }
  }, [userId])

  const todayLabel = new Date().toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg',
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-lg font-bold text-[#1a1a1a] uppercase tracking-wide">Today&apos;s Briefing</p>
          <p className="text-sm text-gray-400 mt-0.5">{todayLabel}</p>
        </div>
        {!loading && connected && (
          <div className="text-right">
            <span className="text-base text-gray-400">
              {events.length} {events.length === 1 ? 'appointment' : 'appointments'}
            </span>
            {unreadCount != null && (
              unreadCount > 0 ? (
                <a
                  href="https://mail.google.com/mail/u/0/#inbox"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-400 mt-0.5 hover:underline inline-block"
                >
                  <span className="font-semibold text-[#E8266F]">{unreadCount}</span> unread email{unreadCount === 1 ? '' : 's'}
                </a>
              ) : (
                <p className="text-sm text-gray-400 mt-0.5">
                  {unreadCount} unread emails
                </p>
              )
            )}
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-base text-gray-400">Loading your calendar…</p>
      ) : !connected ? (
        <p className="text-base text-gray-400">
          Your Google Calendar isn&apos;t connected. Try signing out and back in to reconnect it.
        </p>
      ) : errorMsg ? (
        <p className="text-base text-gray-400">{errorMsg}</p>
      ) : events.length === 0 ? (
        <p className="text-base text-gray-400">Nothing on your calendar today.</p>
      ) : (
        <div className="space-y-1">
          {events.map(ev => <BriefingRow key={ev.id} event={ev} />)}
        </div>
      )}
    </div>
  )
}

function BriefingRow({ event }: { event: BriefingEvent }) {
  const badge = KIND_BADGE[event.kind]
  const timeLabel = event.allDay
    ? 'All day'
    : event.startTime
      ? new Date(event.startTime).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })
      : '—'

  const content = (
    <div className="flex items-start gap-4 py-3.5 border-b border-gray-50 last:border-0">
      <span className="text-base text-gray-400 w-20 flex-shrink-0 pt-0.5">{timeLabel}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-medium text-[#1a1a1a] truncate">{event.title}</span>
          {badge && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${badge.className}`}>
              {badge.label}
            </span>
          )}
        </div>
        {event.kind !== 'other' ? (
          <p className="text-sm text-gray-400 mt-0.5 truncate">
            {[event.address, event.sellerName, event.sellerPhone ? formatPhoneDisplay(event.sellerPhone) : null]
              .filter(Boolean).join(' · ')}
          </p>
        ) : event.location ? (
          <p className="text-sm text-gray-400 mt-0.5 truncate">{event.location}</p>
        ) : null}
      </div>
    </div>
  )

  if (event.kind !== 'other' && event.evaluationId) {
    return <Link href={`/dashboard/evaluations/${event.evaluationId}`} className="block hover:bg-gray-50 rounded-lg transition-colors -mx-2 px-2">{content}</Link>
  }
  if (event.htmlLink) {
    return <a href={event.htmlLink} target="_blank" rel="noopener noreferrer" className="block hover:bg-gray-50 rounded-lg transition-colors -mx-2 px-2">{content}</a>
  }
  return content
}
