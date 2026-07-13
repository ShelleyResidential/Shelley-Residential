'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select } from '@/lib/styles'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Evaluation = {
  id: string
  status: string
  date_captured: string
  scheduled_at: string | null
  property_status: string | null
  properties: {
    unit_number: string | null
    complex_or_building_name: string | null
    street_number: string | null
    street_name: string | null
    suburb: string | null
    city: string | null
    property_type: string | null
  } | null
  evaluation_contacts: {
    is_primary: boolean
    contacts: { first_name: string; last_name: string } | null
  }[]
}

function formatAddress(p: Evaluation['properties']): string {
  if (!p) return 'Unknown address'
  if (p.property_type === 'sectional_title' && p.unit_number) {
    return `Unit ${p.unit_number}${p.complex_or_building_name ? ' ' + p.complex_or_building_name : ''}${p.suburb ? ', ' + p.suburb : ''}`
  }
  return [p.street_number, p.street_name, p.suburb].filter(Boolean).join(' ') || p.city || 'Unknown address'
}

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  in_progress: { label: 'In Progress', colour: 'bg-blue-50 text-blue-700' },
  open:        { label: 'Open',        colour: 'bg-green-50 text-green-700' },
  won:         { label: 'Won',         colour: 'bg-emerald-50 text-emerald-700' },
  lost:        { label: 'Lost',        colour: 'bg-red-50 text-red-600' },
  future:      { label: 'Future',      colour: 'bg-yellow-50 text-yellow-700' },
}

export default function EvaluationsPage() {
  const router = useRouter()
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const fetchEvaluations = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('evaluations')
      .select(`
        id, status, date_captured, scheduled_at, property_status,
        properties (unit_number, complex_or_building_name, street_number, street_name, suburb, city, property_type),
        evaluation_contacts (is_primary, contacts (first_name, last_name))
      `)
      .order('date_captured', { ascending: false })

    if (filterStatus) query = query.eq('status', filterStatus)

    const { data } = await query
    let results = (data ?? []) as unknown as Evaluation[]

    if (search) {
      const q = search.toLowerCase()
      results = results.filter(e => {
        const addr = formatAddress(e.properties).toLowerCase()
        const primaryContact = e.evaluation_contacts?.find(c => c.is_primary)
        const name = primaryContact?.contacts
          ? `${primaryContact.contacts.first_name} ${primaryContact.contacts.last_name}`.toLowerCase()
          : ''
        return addr.includes(q) || name.includes(q)
      })
    }

    setEvaluations(results)
    setLoading(false)
  }, [search, filterStatus])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/') })
  }, [router])

  useEffect(() => {
    const timer = setTimeout(fetchEvaluations, 300)
    return () => clearTimeout(timer)
  }, [fetchEvaluations])

  return (
    <div className="p-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-[#1a1a1a]">Evaluations</h1>
        <Link href="/dashboard/evaluations/new" className={btn.primary}>+ New Evaluation</Link>
      </div>

      {/* Filters */}
      <div className={`${card} p-4 mb-6 flex gap-3 flex-wrap items-center`}>
        <input
          type="text"
          placeholder="Search by address or contact…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`${input} flex-1 min-w-[200px]`}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${select} w-auto`}>
          <option value="">All statuses</option>
          <option value="in_progress">In Progress</option>
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="future">Future</option>
        </select>
        {(search || filterStatus) && (
          <button onClick={() => { setSearch(''); setFilterStatus('') }} className={btn.secondary}>
            Clear
          </button>
        )}
      </div>

      {!loading && (
        <p className="text-sm text-gray-400 mb-4">
          {evaluations.length} {evaluations.length === 1 ? 'evaluation' : 'evaluations'}
        </p>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">Loading evaluations…</div>
      ) : evaluations.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <p className="text-gray-400 text-sm mb-4">No evaluations found.</p>
          <Link href="/dashboard/evaluations/new" className={btn.primary}>Create your first evaluation</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {evaluations.map(ev => {
            const statusMeta = STATUS_LABELS[ev.status] ?? { label: ev.status, colour: 'bg-gray-100 text-gray-500' }
            const primaryContact = ev.evaluation_contacts?.find(c => c.is_primary)
            const contactName = primaryContact?.contacts
              ? `${primaryContact.contacts.first_name} ${primaryContact.contacts.last_name}`.trim()
              : null
            const address = formatAddress(ev.properties)
            const scheduled = ev.scheduled_at
              ? new Date(ev.scheduled_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : null

            return (
              <Link
                key={ev.id}
                href={`/dashboard/evaluations/${ev.id}`}
                className={`${card} flex items-center justify-between px-5 py-4 hover:shadow-md hover:border-gray-200 transition-all`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[#1a1a1a]">{address}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMeta.colour}`}>
                      {statusMeta.label}
                    </span>
                  </div>
                  <div className="flex gap-4 mt-1 text-sm text-[#1a1a1a] flex-wrap">
                    {contactName && <span>{contactName}</span>}
                    {scheduled && <span className="text-gray-400">📅 {scheduled}</span>}
                  </div>
                </div>
                <span className="text-gray-300 text-lg flex-shrink-0 ml-4">›</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
