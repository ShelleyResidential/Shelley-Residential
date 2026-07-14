'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input } from '@/lib/styles'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Profile = { id: string; full_name: string | null; email: string | null }

type Evaluation = {
  id: string
  status: string
  date_captured: string
  scheduled_at: string | null
  property_status: string | null
  evaluation_price: number | null
  marketing_price: number | null
  sellers_agent_user_id: string | null
  transaction_coordinator_user_id: string | null
  properties: {
    unit_number: string | null
    complex_or_building_name: string | null
    street_number: string | null
    street_name: string | null
    suburb: string | null
    city: string | null
    property_type: string | null
  } | null
  lead_source_picklist: { label: string } | null
  lead_source_other_text: string | null
  evaluation_contacts: {
    is_primary: boolean
    contacts: { first_name: string; last_name: string } | null
    picklist_options: { label: string } | null
  }[]
}

function formatAddress(p: Evaluation['properties']): string {
  if (!p) return 'Unknown address'
  if (p.property_type === 'sectional_title' && p.unit_number) {
    return `Unit ${p.unit_number}${p.complex_or_building_name ? ' ' + p.complex_or_building_name : ''}${p.suburb ? ', ' + p.suburb : ''}`
  }
  return [p.street_number, p.street_name, p.suburb].filter(Boolean).join(' ') || p.city || 'Unknown address'
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

function sellerName(ev: Evaluation): string {
  const seller = ev.evaluation_contacts?.find(c => c.picklist_options?.label === 'Seller')
    ?? ev.evaluation_contacts?.find(c => c.is_primary)
  return seller?.contacts ? `${seller.contacts.first_name} ${seller.contacts.last_name}`.trim() : '—'
}

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  in_progress: { label: 'In Progress', colour: 'bg-blue-50 text-blue-700' },
  open:        { label: 'Open',        colour: 'bg-green-50 text-green-700' },
  won:         { label: 'Won',         colour: 'bg-emerald-50 text-emerald-700' },
  lost:        { label: 'Lost',        colour: 'bg-red-50 text-red-600' },
  future:      { label: 'Future',      colour: 'bg-yellow-50 text-yellow-700' },
}

const STATUS_TABS = [
  { key: '',           label: 'All' },
  { key: 'future',     label: 'Future' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'lost',       label: 'Lost' },
  { key: 'open',       label: 'Open Mandate' },
  { key: 'won',        label: 'Won' },
]

export default function EvaluationsPage() {
  const router = useRouter()
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [profiles, setProfiles]       = useState<Record<string, Profile>>({})
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const fetchEvaluations = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('evaluations')
      .select(`
        id, status, date_captured, scheduled_at, property_status,
        evaluation_price, marketing_price,
        sellers_agent_user_id, transaction_coordinator_user_id,
        properties (unit_number, complex_or_building_name, street_number, street_name, suburb, city, property_type),
        lead_source_picklist:lead_source_option_id (label),
        lead_source_other_text,
        evaluation_contacts (is_primary, contacts (first_name, last_name), picklist_options:tag_option_id (label))
      `)
      .order('date_captured', { ascending: false })

    if (filterStatus) query = query.eq('status', filterStatus)

    const { data } = await query
    let results = (data ?? []) as unknown as Evaluation[]

    if (search) {
      const q = search.toLowerCase()
      results = results.filter(e => {
        const addr = formatAddress(e.properties).toLowerCase()
        const seller = sellerName(e).toLowerCase()
        return addr.includes(q) || seller.includes(q)
      })
    }

    setEvaluations(results)
    setLoading(false)
  }, [search, filterStatus])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/') })
    supabase.from('profiles').select('id, full_name, email').then(({ data }) => {
      const map: Record<string, Profile> = {}
      for (const p of (data ?? []) as Profile[]) map[p.id] = p
      setProfiles(map)
    })
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

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterStatus(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              filterStatus === tab.key ? 'border-[#1a1a1a] text-[#1a1a1a]' : 'border-transparent text-gray-400 hover:text-[#1a1a1a]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className={`${card} p-4 mb-6 flex gap-3 flex-wrap items-center`}>
        <input
          type="text"
          placeholder="Search by address or seller…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`${input} flex-1 min-w-[200px]`}
        />
        {search && (
          <button onClick={() => setSearch('')} className={btn.secondary}>
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
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-4 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap">Address</th>
                <th className="px-4 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap">Date</th>
                <th className="px-4 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap">Agent</th>
                <th className="px-4 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap">TC</th>
                <th className="px-4 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap">Seller</th>
                <th className="px-4 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap">Lead Source</th>
                <th className="px-4 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap">Evaluation Price</th>
                <th className="px-4 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap">Marketing Price</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((ev, i) => {
                const statusMeta = STATUS_LABELS[ev.status] ?? { label: ev.status, colour: 'bg-gray-100 text-gray-500' }
                const date = new Date(ev.date_captured).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                const leadSource = ev.lead_source_picklist?.label ?? ev.lead_source_other_text ?? '—'
                const agent = ev.sellers_agent_user_id ? profiles[ev.sellers_agent_user_id] : null
                const tc = ev.transaction_coordinator_user_id ? profiles[ev.transaction_coordinator_user_id] : null

                return (
                  <tr
                    key={ev.id}
                    onClick={() => router.push(`/dashboard/evaluations/${ev.id}`)}
                    className={`cursor-pointer hover:bg-gray-100 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusMeta.colour}`}>
                        {statusMeta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-[#1a1a1a] whitespace-nowrap">{formatAddress(ev.properties)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{date}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{agent?.full_name ?? agent?.email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{tc?.full_name ?? tc?.email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{sellerName(ev)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{leadSource}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatCurrency(ev.evaluation_price)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatCurrency(ev.marketing_price)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
