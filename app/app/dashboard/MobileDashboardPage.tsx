'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { STATUS_ORDER, STATUS_LABELS, STATUS_COLOURS } from '@/lib/pipeline'
import { formatPhoneDisplay } from '@/lib/phone'
import { card } from '@/lib/styles'
import type { BriefingEvent } from '@/app/api/calendar/today/route'

// Same data and functions as the desktop dashboard (DesktopDashboardPage.tsx)
// -- Today's Briefing, My Performance, Company Overview, Evaluations by
// Status, Agent Leaderboard -- laid out for touch instead of a mouse:
// horizontally swipeable stat/status strips instead of static grids, an
// agenda-style briefing, and bigger tap targets throughout.

type Stats = {
  contacts: number
  properties: number
  evaluations: number
  evaluationsByStatus: Record<string, number>
}

export function MobileDashboardPage() {
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
    <div className="pb-10">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-bold text-[#1a1a1a]">Good day{firstName ? `, ${firstName}` : ''}</h1>
      </div>

      {userId && <TodaysBriefing userId={userId} />}
      {userId && <MyPerformance userId={userId} />}

      <SectionLabel>Company Overview</SectionLabel>
      <div className="grid grid-cols-2 gap-3 px-4 mb-6">
        <OverviewTile label="Contacts" value={loading ? '—' : stats.contacts} href="/dashboard/contacts" />
        <OverviewTile label="Properties" value={loading ? '—' : stats.properties} href="/dashboard/properties" />
        <OverviewTile label="Evaluations" value={loading ? '—' : stats.evaluations} href="/dashboard/evaluations" fullWidth />
      </div>

      {!loading && stats.evaluations > 0 && (
        <>
          <SectionLabel>Evaluations by Status</SectionLabel>
          {/* No scroll-snap here -- scroll-snap-align on the first card
              makes Chrome anchor its snap area to the scrollport start,
              which visually cancels out that card's own left margin (the
              gap fix below) even though it's still there in the box model. */}
          <div className="flex gap-2 overflow-x-auto pb-2 mb-6 [&>*:first-child]:ml-4 [&>*:last-child]:mr-4">
            {STATUS_ORDER.map(key => {
              const count = stats.evaluationsByStatus[key] ?? 0
              return (
                <Link
                  key={key}
                  href={`/dashboard/evaluations?status=${key}`}
                  className={`flex-shrink-0 flex flex-col items-center justify-center rounded-2xl px-5 py-3 min-w-[92px] ${STATUS_COLOURS[key] ?? 'bg-gray-100 text-gray-500'}`}
                >
                  <span className="text-xl font-bold">{count}</span>
                  <span className="text-xs font-medium mt-0.5 text-center">{STATUS_LABELS[key]}</span>
                </Link>
              )
            })}
          </div>
        </>
      )}

      <AgentLeaderboard />
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-4 text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-2.5 mt-1">{children}</p>
}

function OverviewTile({ label, value, href, fullWidth }: {
  label: string; value: number | string; href: string; fullWidth?: boolean
}) {
  return (
    <Link
      href={href}
      className={`${card} p-4 flex items-center justify-between active:bg-gray-50 transition-colors ${fullWidth ? 'col-span-2' : ''}`}
    >
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <span className="text-2xl font-bold text-[#1a1a1a]">{value}</span>
    </Link>
  )
}

// ── My Performance -- horizontally swipeable stat strip ─────────
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

  return (
    <>
      <SectionLabel>My Performance</SectionLabel>
      {/* Margin on the first/last card, not px-4 on this container -- a
          horizontally-scrolling flex row with overflow-x-auto doesn't
          reliably render its own left/right padding once content overflows,
          so the leading card ends up flush against the screen edge. Also no
          scroll-snap: scroll-snap-align on the first card makes Chrome
          anchor its snap area to the scrollport start, which visually
          cancels out that margin again even though it's still applied. */}
      <div className="flex gap-3 overflow-x-auto pb-2 mb-6 [&>*:first-child]:ml-4 [&>*:last-child]:mr-4">
        <MobileStatCard label="Evaluations" value={totalEvals} />
        <MobileStatCard label="Win Rate" value={winRate != null ? `${winRate.toFixed(0)}%` : '—'} sub={winRate != null ? `${won}W · ${lost}L` : undefined} />
        <MobileStatCard label="Clients" value={totalContacts} sub={totalContacts ? `${activeContacts} active` : undefined} />
        <MobileStatCard label="Properties" value={totalProperties} sub={avgPrice ? `Avg ${formatCurrency(avgPrice)}` : undefined} />
      </div>
    </>
  )
}

function MobileStatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className={`${card} p-4 flex-shrink-0`} style={{ minWidth: 130 }}>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">{label}</p>
      <p className="text-xl font-bold text-[#1a1a1a]">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Agent leaderboard -- ranked list with a numbered badge ───────
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
    <>
      <SectionLabel>Agent Leaderboard</SectionLabel>
      <div className={`${card} mx-4 p-2`}>
        {topAgents.map(([userId, s], i) => {
          const agent = profiles[userId]
          const agentWinRate = s.total > 0 ? (s.won / s.total) * 100 : 0
          const name = agent?.full_name ?? agent?.email ?? 'Unknown'
          return (
            <div key={userId} className="flex items-center gap-3 px-2 py-2.5 border-b border-gray-50 last:border-0">
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                i === 0 ? 'bg-[#E8266F] text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                {i + 1}
              </span>
              <span className="text-[#1a1a1a] font-medium flex-1 truncate text-sm">{name}</span>
              <span className="text-gray-400 text-xs flex-shrink-0 text-right">
                {s.total} eval{s.total !== 1 ? 's' : ''}<br />{agentWinRate.toFixed(0)}% won
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

const GMAIL_WEB_INBOX_URL = 'https://mail.google.com/mail/u/0/#inbox'

// A plain https link to Gmail always just opens another browser tab, even
// on a phone with the Gmail app installed -- there's no way for a normal
// <a> to prefer the native app. Android's `intent:` URI scheme has a
// built-in fallback (browser_fallback_url) that the OS itself handles if
// the app isn't installed, so no timing games needed there. iOS has no
// equivalent -- googlegmail:// either opens the app immediately (in which
// case this tab never gets the chance to navigate again) or silently does
// nothing, so falling back to the web inbox after a short delay is the
// standard workaround. Any other platform (e.g. viewing this on a desktop
// browser) just gets the plain link's default behaviour, since this only
// intercepts the click on Android/iOS.
function openGmail(e: React.MouseEvent) {
  const ua = navigator.userAgent
  const isAndroid = /Android/.test(ua)
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  if (!isAndroid && !isIOS) return

  e.preventDefault()
  if (isAndroid) {
    window.location.href = `intent://mail.google.com/mail/#Intent;scheme=https;package=com.google.android.gm;S.browser_fallback_url=${encodeURIComponent(GMAIL_WEB_INBOX_URL)};end`
  } else {
    window.location.href = 'googlegmail://'
    setTimeout(() => { window.location.href = GMAIL_WEB_INBOX_URL }, 1200)
  }
}

// ── Today's Briefing -- agenda timeline with an unread-email chip ─
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
    <div className="px-4 mb-6">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide">Today&apos;s Briefing</p>
        {unreadCount != null && unreadCount > 0 && (
          <a
            href={GMAIL_WEB_INBOX_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={openGmail}
            className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#E8266F] text-white flex-shrink-0 active:opacity-80"
          >
            {unreadCount} unread
          </a>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">{todayLabel}</p>

      <div className={`${card} p-4`}>
        {loading ? (
          <p className="text-sm text-gray-400">Loading your calendar…</p>
        ) : !connected ? (
          <p className="text-sm text-gray-400">
            Your Google Calendar isn&apos;t connected. Try signing out and back in to reconnect it.
          </p>
        ) : errorMsg ? (
          <p className="text-sm text-gray-400">{errorMsg}</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing on your calendar today.</p>
        ) : (
          <div>
            {events.map((ev, i) => <TimelineRow key={ev.id} event={ev} isLast={i === events.length - 1} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function TimelineRow({ event, isLast }: { event: BriefingEvent; isLast: boolean }) {
  const badge = KIND_BADGE[event.kind]
  const timeLabel = event.allDay
    ? 'All day'
    : event.startTime
      ? new Date(event.startTime).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })
      : '—'

  const body = (
    <div className="flex-1 min-w-0 pb-4">
      <p className="text-xs text-gray-400 mb-0.5">{timeLabel}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-[#1a1a1a] truncate">{event.title}</span>
        {badge && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${badge.className}`}>
            {badge.label}
          </span>
        )}
      </div>
      {event.kind !== 'other' ? (
        <p className="text-xs text-gray-400 mt-0.5 truncate">
          {[event.address, event.sellerName, event.sellerPhone ? formatPhoneDisplay(event.sellerPhone) : null]
            .filter(Boolean).join(' · ')}
        </p>
      ) : event.location ? (
        <p className="text-xs text-gray-400 mt-0.5 truncate">{event.location}</p>
      ) : null}
    </div>
  )

  const row = (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center flex-shrink-0 pt-1">
        <span className="w-2.5 h-2.5 rounded-full bg-[#E8266F]" />
        {!isLast && <span className="w-px flex-1 bg-gray-100 mt-1" style={{ minHeight: 24 }} />}
      </div>
      {body}
    </div>
  )

  if (event.kind !== 'other' && event.evaluationId) {
    return <Link href={`/dashboard/evaluations/${event.evaluationId}`} className="block active:opacity-70">{row}</Link>
  }
  if (event.htmlLink) {
    return <a href={event.htmlLink} target="_blank" rel="noopener noreferrer" className="block active:opacity-70">{row}</a>
  }
  return row
}
