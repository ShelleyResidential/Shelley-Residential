'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select } from '@/lib/styles'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const PAGE_SIZE = 50

type Property = {
  id: string
  property_type: string | null
  unit_number: string | null
  complex_or_building_name: string | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  city: string | null
  province: string | null
  google_maps_url: string | null
  created_at: string
  evaluations: {
    id: string
    status: string
    date_captured: string
  }[]
}

const STATUS_COLOURS: Record<string, string> = {
  // Current statuses
  new:         'bg-blue-50 text-blue-700',
  scheduled:   'bg-indigo-50 text-indigo-700',
  completed:   'bg-teal-50 text-teal-700',
  presented:   'bg-purple-50 text-purple-700',
  follow_up:   'bg-yellow-50 text-yellow-700',
  won:         'bg-emerald-50 text-emerald-700',
  lost:        'bg-red-50 text-red-600',
  cancelled:   'bg-gray-100 text-gray-500',
  // Legacy statuses (kept for evaluations created before this status list changed)
  in_progress: 'bg-blue-50 text-blue-700',
  open:        'bg-green-50 text-green-700',
  future:      'bg-yellow-50 text-yellow-700',
}

const STATUS_LABELS: Record<string, string> = {
  new: 'New', scheduled: 'Scheduled', completed: 'Completed', presented: 'Presented',
  follow_up: 'Follow-Up', won: 'Won', lost: 'Lost', cancelled: 'Cancelled',
  // Legacy statuses (kept for evaluations created before this status list changed)
  in_progress: 'In Progress', open: 'Open Mandate', future: 'Future Mandate',
}

function capitalizeWords(text: string): string {
  return text.replace(/\b\w/g, c => c.toUpperCase())
}

// Heading format: unit + complex + suburb only — the full street address
// is still used for the Maps link (see mapQuery below).
function formatAddress(p: Property): string {
  const street = [p.street_number, p.street_name].filter(Boolean).join(' ')
  if (p.property_type === 'sectional_title' && p.unit_number) {
    const unit = [`Unit ${p.unit_number}`, p.complex_or_building_name ? capitalizeWords(p.complex_or_building_name) : null].filter(Boolean).join(' ')
    return [unit, p.suburb].filter(Boolean).join(', ')
  }
  return [street, p.suburb].filter(Boolean).join(', ') || p.city || 'Unknown address'
}

// The actual navigable street address — used for the Maps link, since a
// unit/complex name alone doesn't reliably geocode.
function mapQuery(p: Property): string {
  return [p.street_number, p.street_name, p.suburb, p.city].filter(Boolean).join(' ')
}

function mapsUrl(p: Property): string | null {
  if (p.google_maps_url) return p.google_maps_url
  const q = mapQuery(p)
  return q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : null
}

// A property can carry multiple evaluations over time — the most recent
// one (by date captured) is what the list surfaces.
function latestEvaluation(p: Property): Property['evaluations'][number] | null {
  const evals = p.evaluations ?? []
  if (evals.length === 0) return null
  return [...evals].sort((a, b) => new Date(b.date_captured).getTime() - new Date(a.date_captured).getTime())[0]
}

export default function PropertiesPage() {
  const router = useRouter()
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterSuburb, setFilterSuburb] = useState('')
  const [suburbs, setSuburbs]       = useState<string[]>([])
  const [page, setPage]             = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const fetchProperties = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('properties')
      .select(`
        id, property_type, unit_number, complex_or_building_name,
        street_number, street_name, suburb, city, province,
        google_maps_url, created_at,
        evaluations (id, status, date_captured)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })

    if (filterType)   query = query.eq('property_type', filterType)
    if (filterSuburb) query = query.eq('suburb', filterSuburb)
    if (search) {
      const q = search.trim()
      query = query.or(`street_name.ilike.%${q}%,suburb.ilike.%${q}%,city.ilike.%${q}%,complex_or_building_name.ilike.%${q}%`)
    }

    const from = (page - 1) * PAGE_SIZE
    query = query.range(from, from + PAGE_SIZE - 1)

    const { data, count } = await query
    setProperties((data ?? []) as unknown as Property[])
    setTotalCount(count ?? 0)
    setLoading(false)
  }, [search, filterType, filterSuburb, page])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/')
    })

    // Load distinct suburbs for the filter dropdown
    supabase.from('properties').select('suburb').not('suburb', 'is', null).then(({ data }) => {
      const unique = [...new Set((data ?? []).map((r: { suburb: string | null }) => r.suburb).filter(Boolean))] as string[]
      setSuburbs(unique.sort())
    })
  }, [router])

  // Any change to the filters should snap back to page 1.
  useEffect(() => {
    setPage(1)
  }, [search, filterType, filterSuburb])

  useEffect(() => {
    const timer = setTimeout(fetchProperties, 300)
    return () => clearTimeout(timer)
  }, [fetchProperties])

  function toggleSelected(id: string) {
    setSelectedId(prev => prev === id ? null : id)
  }

  const rowActionControls = selectedId && (
    <RowActionButtons
      onEdit={() => router.push(`/dashboard/properties/${selectedId}?edit=1`)}
      onDetails={() => router.push(`/dashboard/properties/${selectedId}`)}
    />
  )

  const paginationControls = !loading && properties.length > 0 && (
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
      <Breadcrumbs items={[{ label: 'Analyse' }, { label: 'Properties' }]} />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1a1a1a]">Properties</h1>
      </div>

      {/* Filters */}
      <div className={`${card} p-4 mb-3 flex gap-3 flex-wrap items-center`}>
        <input
          type="text"
          placeholder="Search by address…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`${input} flex-1 min-w-[200px]`}
        />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className={`${select} w-auto`}>
          <option value="">All types</option>
          <option value="freehold">Freehold</option>
          <option value="sectional_title">Sectional Title</option>
          <option value="vacant_land">Vacant Land</option>
        </select>
        <select value={filterSuburb} onChange={e => setFilterSuburb(e.target.value)} className={`${select} w-auto`}>
          <option value="">All suburbs</option>
          {suburbs.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(search || filterType || filterSuburb) && (
          <button onClick={() => { setSearch(''); setFilterType(''); setFilterSuburb('') }} className={btn.secondary}>
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center justify-end flex-wrap gap-3 mb-6">
        {rowActionControls}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        {!loading && (
          <p className="text-sm text-gray-400">
            {totalCount} {totalCount === 1 ? 'Property' : 'Properties'}
          </p>
        )}
        {paginationControls}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">Loading properties…</div>
      ) : properties.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <p className="text-gray-400 text-sm">No properties found.</p>
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm table-fixed">
            <thead>
              <TableHeaderRow />
            </thead>
            <tbody>
              {properties.map((p, i) => {
                const address = formatAddress(p)
                const link    = mapsUrl(p)
                const latest  = latestEvaluation(p)
                const area    = [p.suburb, p.city].filter(Boolean).join(', ')

                return (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/dashboard/properties/${p.id}`)}
                    className={`cursor-pointer hover:bg-gray-100 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    <td className="px-3 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <input
                        type="radio"
                        name="selected-property"
                        checked={selectedId === p.id}
                        onClick={() => toggleSelected(p.id)}
                        onChange={() => setSelectedId(p.id)}
                        className="w-4 h-4 border-gray-300 accent-[#E8266F] cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3 text-[#1a1a1a] font-medium truncate" title={address}>{address}</td>
                    <td className="px-3 py-3 text-gray-500 truncate" title={area || undefined}>{area || '—'}</td>
                    <td className="px-3 py-3 overflow-hidden">
                      {latest ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium truncate inline-block max-w-full align-bottom ${STATUS_COLOURS[latest.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_LABELS[latest.status] ?? latest.status}
                        </span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 overflow-hidden" onClick={e => e.stopPropagation()}>
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-[#1a1a1a] transition-colors">
                          Maps ↗
                        </a>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 overflow-hidden" onClick={e => e.stopPropagation()}>
                      {latest ? (
                        <Link href={`/dashboard/evaluations/${latest.id}`} className="font-medium text-[#1a1a1a] hover:underline">
                          View evaluation →
                        </Link>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
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
// of the properties table so the column labels stay visible either way.
function TableHeaderRow() {
  return (
    <tr className="border-b border-gray-100 text-left">
      <th className="px-3 py-3 whitespace-nowrap w-[4%]" />
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[24%]">Address</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[20%]">Suburb Area</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[16%]">Evaluation Status</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[16%]">Maps</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[20%]">View Evaluation</th>
    </tr>
  )
}

// ── Row action buttons (Edit / Details), shown once a row is selected.
function RowActionButtons({ onEdit, onDetails }: { onEdit?: () => void; onDetails?: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <button disabled={!onEdit} onClick={onEdit} className={`${btn.secondary} cursor-pointer disabled:cursor-not-allowed`}>
        Edit
      </button>
      <button disabled={!onDetails} onClick={onDetails} className={`${btn.secondary} cursor-pointer disabled:cursor-not-allowed`}>
        Details
      </button>
    </div>
  )
}
