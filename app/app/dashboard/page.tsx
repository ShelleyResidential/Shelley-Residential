'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { STATUS_ORDER, STATUS_LABELS } from '@/lib/pipeline'
import { formatPhoneDisplay } from '@/lib/phone'
import type { BriefingEvent } from '@/app/api/calendar/today/route'

type Stats = {
  contacts: number
  properties: number
  evaluations: number
  evaluationsByStatus: Record<string, number>
}

export default function DashboardPage() {
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
    <div className="p-10">
      <h1 className="text-2xl font-bold text-[#1a1a1a]">Dashboard</h1>
      <p className="text-sm text-gray-400 mb-8">Good day{firstName ? `, ${firstName}` : ', Agent'}</p>

      {/* ── Today's Briefing — the anchor feature: the agent's own Google
          Calendar for today, turned into a day-at-a-glance view. ── */}
      {userId && <TodaysBriefing userId={userId} />}

      {/* ── Top stat blocks ── */}
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

  const todayLabel = new Date().toLocaleDateString('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg',
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide">Today&apos;s Briefing</p>
          <p className="text-xs text-gray-400 mt-0.5">{todayLabel}</p>
        </div>
        {!loading && connected && (
          <span className="text-sm text-gray-400">
            {events.length} {events.length === 1 ? 'appointment' : 'appointments'}
          </span>
        )}
      </div>

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
    <div className="flex items-start gap-4 py-3 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-400 w-16 flex-shrink-0 pt-0.5">{timeLabel}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-[#1a1a1a] truncate">{event.title}</span>
          {badge && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${badge.className}`}>
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
