'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input } from '@/lib/styles'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const PAGE_SIZE = 50

type Profile = { id: string; full_name: string | null; email: string | null }

type Property = {
  id: string
  unit_number: string | null
  complex_or_building_name: string | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country: string | null
  property_type: string | null
  latitude: number | null
  longitude: number | null
  google_maps_url: string | null
}

type Contact = {
  id: string
  title: string | null
  first_name: string
  last_name: string
  status: string | null
  phone_number: string | null
  email_address: string | null
  contact_preference: string | null
  tags: string[] | null
  marital_status: string | null
  occupation: string | null
  company_name: string | null
  division: string | null
  branch: string | null
  address: string | null
  birthday: string | null
  wedding_anniversary: string | null
  home_anniversary: string | null
  id_number: string | null
  date_added: string | null
}

type LeadInfo = {
  id: string
  lead_generated_by: string | null
  lead_source_picklist: { label: string } | null
  lead_source_other_text: string | null
  referral_type: string | null
  lead_referral_notes: string | null
}

type Evaluation = LeadInfo & {
  id: string
  status: string
  date_captured: string
  scheduled_at: string | null
  evaluation_price: number | null
  marketing_price: number | null
  sellers_agent_user_id: string | null
  transaction_coordinator_user_id: string | null
  motivation_for_selling_notes: string | null
  motivation_picklist: { label: string } | null
  selling_timeline_notes: string | null
  timeline_picklist: { label: string } | null
  properties: Property | null
  evaluation_contacts: {
    is_primary: boolean
    contacts: Contact | null
    picklist_options: { label: string } | null
  }[]
}

function formatAddress(p: Evaluation['properties']): string {
  if (!p) return 'Unknown address'
  if (p.property_type === 'sectional_title' && p.unit_number) {
    return `Unit ${p.unit_number}${p.complex_or_building_name ? ' ' + p.complex_or_building_name : ''}${p.suburb ? ', ' + p.suburb : ''}`
  }
  const street = [p.street_number, p.street_name].filter(Boolean).join(' ')
  return [street, p.suburb].filter(Boolean).join(', ') || p.city || 'Unknown address'
}

function mapQuery(p: Property): string {
  if (p.latitude != null && p.longitude != null) return `${p.latitude},${p.longitude}`
  return [p.street_number, p.street_name, p.suburb, p.city, p.province, p.postal_code, p.country].filter(Boolean).join(' ')
}

function mapsUrl(p: Evaluation['properties']): string | null {
  if (!p) return null
  if (p.google_maps_url) return p.google_maps_url
  const q = mapQuery(p)
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

function getSellerLink(ev: Evaluation): Evaluation['evaluation_contacts'][number] | null {
  return ev.evaluation_contacts?.find(c => c.picklist_options?.label === 'Seller')
    ?? ev.evaluation_contacts?.find(c => c.is_primary)
    ?? null
}

function getSeller(ev: Evaluation): Contact | null {
  return getSellerLink(ev)?.contacts ?? null
}

function sellerName(ev: Evaluation): string {
  const contact = getSeller(ev)
  return contact ? `${contact.first_name} ${contact.last_name}`.trim() : '—'
}

const STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  // Current statuses
  new:         { label: 'New',            colour: 'bg-blue-50 text-blue-700' },
  scheduled:   { label: 'Scheduled',      colour: 'bg-indigo-50 text-indigo-700' },
  completed:   { label: 'Completed',      colour: 'bg-teal-50 text-teal-700' },
  presented:   { label: 'Presented',      colour: 'bg-purple-50 text-purple-700' },
  follow_up:   { label: 'Follow-Up',      colour: 'bg-yellow-50 text-yellow-700' },
  won:         { label: 'Won',            colour: 'bg-emerald-50 text-emerald-700' },
  lost:        { label: 'Lost',           colour: 'bg-red-50 text-red-600' },
  cancelled:   { label: 'Cancelled',      colour: 'bg-gray-100 text-gray-500' },
  // Legacy statuses (kept for evaluations created before this status list changed)
  in_progress: { label: 'In Progress',    colour: 'bg-blue-50 text-blue-700' },
  open:        { label: 'Open Mandate',   colour: 'bg-green-50 text-green-700' },
  future:      { label: 'Future Mandate', colour: 'bg-yellow-50 text-yellow-700' },
}

const STATUS_TABS = [
  { key: '',          label: 'All' },
  { key: 'new',        label: 'New' },
  { key: 'scheduled',  label: 'Scheduled' },
  { key: 'completed',  label: 'Completed' },
  { key: 'presented',  label: 'Presented' },
  { key: 'follow_up',  label: 'Follow-Up' },
  { key: 'won',        label: 'Won' },
  { key: 'lost',       label: 'Lost' },
  { key: 'cancelled',  label: 'Cancelled' },
]

export default function EvaluationsPage() {
  const router = useRouter()
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [profiles, setProfiles]       = useState<Record<string, Profile>>({})
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [myOnly, setMyOnly]           = useState(false)
  const [userId, setUserId]           = useState<string | null>(null)
  const [page, setPage]               = useState(1)
  const [totalCount, setTotalCount]   = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const fetchEvaluations = useCallback(async () => {
    setLoading(true)
    const isSearching = !!search.trim()

    let query = supabase
      .from('evaluations')
      .select(`
        id, status, date_captured, scheduled_at,
        evaluation_price, marketing_price,
        sellers_agent_user_id, transaction_coordinator_user_id,
        motivation_for_selling_notes, selling_timeline_notes,
        motivation_picklist:motivation_for_selling_option_id (label),
        timeline_picklist:selling_timeline_option_id (label),
        properties (id, unit_number, complex_or_building_name, street_number, street_name,
          suburb, city, province, postal_code, country, property_type,
          latitude, longitude, google_maps_url),
        lead_generated_by, referral_type, lead_referral_notes,
        lead_source_picklist:lead_source_option_id (label),
        lead_source_other_text,
        evaluation_contacts (
          is_primary,
          contacts (id, title, first_name, last_name, status, phone_number, email_address,
            contact_preference, tags, marital_status, occupation, company_name, division,
            branch, address, birthday, wedding_anniversary, home_anniversary, id_number, date_added),
          picklist_options:tag_option_id (label)
        )
      `, { count: isSearching ? undefined : 'exact' })
      .order('date_captured', { ascending: false })

    if (filterStatus) query = query.eq('status', filterStatus)
    if (myOnly && userId) query = query.eq('sellers_agent_user_id', userId)

    // Address/seller search spans a joined table PostgREST can't filter on
    // directly, so fetch a bounded batch and filter/paginate it client-side.
    // Otherwise, page the query itself so a database with thousands of
    // records never loads more than one page's worth at a time.
    if (isSearching) {
      query = query.limit(1000)
    } else {
      const from = (page - 1) * PAGE_SIZE
      query = query.range(from, from + PAGE_SIZE - 1)
    }

    const { data, count } = await query
    let results = (data ?? []) as unknown as Evaluation[]

    // If the scheduled time has passed and nobody filled in the inspection
    // (which would already have moved it to Completed), move it to
    // Presented automatically.
    const now = new Date()
    const overdueIds = results
      .filter(e => e.status === 'scheduled' && e.scheduled_at && new Date(e.scheduled_at) < now)
      .map(e => e.id)
    if (overdueIds.length > 0) {
      results = results.map(e => overdueIds.includes(e.id) ? { ...e, status: 'presented' } : e)
      await supabase.from('evaluations').update({ status: 'presented' }).in('id', overdueIds).eq('status', 'scheduled')
    }

    if (isSearching) {
      const q = search.toLowerCase()
      results = results.filter(e => {
        const addr = formatAddress(e.properties).toLowerCase()
        const seller = sellerName(e).toLowerCase()
        return addr.includes(q) || seller.includes(q)
      })
      setTotalCount(results.length)
      const from = (page - 1) * PAGE_SIZE
      results = results.slice(from, from + PAGE_SIZE)
    } else {
      setTotalCount(count ?? 0)
    }

    setEvaluations(results)
    setLoading(false)
  }, [search, filterStatus, myOnly, userId, page])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserId(data.user.id)
    })
    supabase.from('profiles').select('id, full_name, email').then(({ data }) => {
      const map: Record<string, Profile> = {}
      for (const p of (data ?? []) as Profile[]) map[p.id] = p
      setProfiles(map)
    })
  }, [router])

  // Any change to the filters should snap back to page 1.
  useEffect(() => {
    setPage(1)
  }, [search, filterStatus, myOnly])

  useEffect(() => {
    const timer = setTimeout(fetchEvaluations, 300)
    return () => clearTimeout(timer)
  }, [fetchEvaluations])

  function toggleSelected(id: string) {
    setSelectedId(prev => prev === id ? null : id)
  }

  const rowActionControls = selectedId && (
    <RowActionButtons
      onEdit={() => router.push(`/dashboard/evaluations/${selectedId}?edit=1`)}
      onDetails={() => router.push(`/dashboard/evaluations/${selectedId}`)}
    />
  )

  const paginationControls = !loading && evaluations.length > 0 && (
    <div className="flex items-center gap-3 flex-wrap justify-end">
      <p className="text-xs text-gray-400">
        Page {page} of {totalPages} · {PAGE_SIZE} Records
      </p>
      <div className="flex items-center gap-1">
        <button onClick={() => setPage(1)} disabled={page <= 1}
          className="px-2.5 py-1.5 rounded-md text-sm text-[#1a1a1a] border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          «
        </button>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="px-2.5 py-1.5 rounded-md text-sm text-[#1a1a1a] border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          ‹
        </button>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
          className="px-2.5 py-1.5 rounded-md text-sm text-[#1a1a1a] border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          ›
        </button>
        <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
          className="px-2.5 py-1.5 rounded-md text-sm text-[#1a1a1a] border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          »
        </button>
      </div>
    </div>
  )

  return (
    <div className="p-10">
      <Breadcrumbs items={[{ label: 'Analyse' }, { label: 'Evaluations' }]} />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1a1a1a]">Evaluations</h1>
        <Link href="/dashboard/evaluations/new" className={`${btn.primary} fixed top-8 right-10 z-40 shadow-md`}>+ New Evaluation</Link>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterStatus(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex-shrink-0 transition-colors ${
              filterStatus === tab.key ? 'border-[#1a1a1a] text-[#1a1a1a]' : 'border-transparent text-gray-400 hover:text-[#1a1a1a]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className={`${card} p-4 mb-3 flex gap-3 flex-wrap items-center`}>
        <input
          type="text"
          placeholder="Search by Address or Seller Name…"
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

      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <label className="flex items-center gap-2 text-sm text-[#1a1a1a] cursor-pointer select-none w-fit">
          <input
            type="radio"
            name="my-evaluations-only"
            checked={myOnly}
            onClick={() => setMyOnly(o => !o)}
            onChange={() => setMyOnly(true)}
            className="w-4 h-4 border-gray-300 accent-[#E8266F] cursor-pointer"
          />
          My Evaluations Only
        </label>
        {rowActionControls}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        {!loading && (
          <p className="text-sm text-gray-400">
            {totalCount} {totalCount === 1 ? 'Evaluation' : 'Evaluations'}
          </p>
        )}
        {paginationControls}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">Loading evaluations…</div>
      ) : evaluations.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <p className="text-gray-400 text-sm mb-4">No evaluations found.</p>
          <Link href="/dashboard/evaluations/new" className={btn.primary}>Create your first evaluation</Link>
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm table-fixed">
            <thead>
              <TableHeaderRow />
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
                    <td className="px-3 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <input
                        type="radio"
                        name="selected-evaluation"
                        checked={selectedId === ev.id}
                        onClick={() => toggleSelected(ev.id)}
                        onChange={() => setSelectedId(ev.id)}
                        className="w-4 h-4 border-gray-300 accent-[#E8266F] cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3 overflow-hidden">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium truncate inline-block max-w-full align-bottom ${statusMeta.colour}`}>
                        {statusMeta.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 overflow-hidden">
                      {mapsUrl(ev.properties) ? (
                        <a
                          href={mapsUrl(ev.properties)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          title={formatAddress(ev.properties)}
                          className="block truncate font-medium text-[#1a1a1a] underline hover:font-bold transition-all"
                        >
                          {formatAddress(ev.properties)}
                        </a>
                      ) : (
                        <span title={formatAddress(ev.properties)} className="block truncate font-medium text-[#1a1a1a] underline">{formatAddress(ev.properties)}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-500 truncate">{date}</td>
                    <td className="px-3 py-3 text-gray-500 truncate" title={agent?.full_name ?? agent?.email ?? undefined}>{agent?.full_name ?? agent?.email ?? '—'}</td>
                    <td className="px-3 py-3 text-gray-500 truncate" title={tc?.full_name ?? tc?.email ?? undefined}>{tc?.full_name ?? tc?.email ?? '—'}</td>
                    <td className="px-3 py-3 overflow-hidden">
                      {getSeller(ev) ? (
                        <Link
                          href={`/dashboard/contacts/${getSeller(ev)!.id}?from=evaluations`}
                          onClick={e => e.stopPropagation()}
                          title={sellerName(ev)}
                          className="block w-full truncate text-gray-500 underline hover:font-bold hover:text-[#1a1a1a] transition-all"
                        >
                          {sellerName(ev)}
                        </Link>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-500 truncate" title={leadSource}>
                      {leadSource}
                    </td>
                    <td className="px-3 py-3 text-gray-500 truncate">{formatCurrency(ev.evaluation_price)}</td>
                    <td className="px-3 py-3 text-gray-500 truncate">{formatCurrency(ev.marketing_price)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <TableHeaderRow />
            </tfoot>
          </table>
        </div>
      )}

      {paginationControls && <div className="mt-4">{paginationControls}</div>}

      {rowActionControls && <div className="mt-4">{rowActionControls}</div>}
    </div>
  )
}

// ── Table header row, repeated at both the top (thead) and bottom (tfoot)
// of the evaluations table so the column labels stay visible either way.
function TableHeaderRow() {
  return (
    <tr className="border-b border-gray-100 text-left">
      <th className="px-3 py-3 whitespace-nowrap w-[4%]" />
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[8%]">Status</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[16%]">Address</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[9%]">Date</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[12%]">Agent</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[10%]">TC</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[12%]">Contact</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[11%]">Lead Source</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] truncate overflow-hidden text-xs uppercase tracking-wide w-[9%]">E Price</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] truncate overflow-hidden text-xs uppercase tracking-wide w-[9%]">M Price</th>
    </tr>
  )
}

// ── Row action buttons (Edit / Details / Download), shown once a row is
// selected. Rendered independently at both the top and bottom of the
// results, so each instance owns its own download-menu open state.
function RowActionButtons({ onEdit, onDetails }: { onEdit?: () => void; onDetails?: () => void }) {
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const downloadMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target as Node)) {
        setDownloadMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function handleDownload(docName: string) {
    setDownloadMenuOpen(false)
    alert(`"${docName}" isn't set up yet — let us know what this document should contain and we'll wire it up.`)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <button disabled={!onEdit} onClick={onEdit} className={`${btn.secondary} cursor-pointer disabled:cursor-not-allowed`}>
        Edit
      </button>
      <button disabled={!onDetails} onClick={onDetails} className={`${btn.secondary} cursor-pointer disabled:cursor-not-allowed`}>
        Details
      </button>
      <div className="relative" ref={downloadMenuRef}>
        <button onClick={() => setDownloadMenuOpen(o => !o)} className={`${btn.secondary} cursor-pointer`}>
          Download ▾
        </button>
        {downloadMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-md py-1 z-20">
            <button onClick={() => handleDownload('Form')} className="w-full text-left px-4 py-2 text-sm text-[#1a1a1a] hover:bg-gray-50 transition-colors cursor-pointer">
              Form
            </button>
            <button onClick={() => handleDownload('Transfer Reports')} className="w-full text-left px-4 py-2 text-sm text-[#1a1a1a] hover:bg-gray-50 transition-colors cursor-pointer">
              Transfer Reports
            </button>
            <button onClick={() => handleDownload('Market Report')} className="w-full text-left px-4 py-2 text-sm text-[#1a1a1a] hover:bg-gray-50 transition-colors cursor-pointer">
              Market Report
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

