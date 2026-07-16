'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select } from '@/lib/styles'
import { canDelete } from '@/lib/permissions'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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

const TYPE_LABELS: Record<string, string> = {
  freehold:        'Freehold',
  sectional_title: 'Sectional Title',
  vacant_land:     'Vacant Land',
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

function formatAddress(p: Property): string {
  if (p.property_type === 'sectional_title' && p.unit_number) {
    return `Unit ${p.unit_number}${p.complex_or_building_name ? ' ' + p.complex_or_building_name : ''}${p.suburb ? ', ' + p.suburb : ''}`
  }
  return [p.street_number, p.street_name, p.suburb].filter(Boolean).join(' ') || p.city || 'Unknown address'
}

export default function PropertiesPage() {
  const router = useRouter()
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterSuburb, setFilterSuburb] = useState('')
  const [suburbs, setSuburbs]       = useState<string[]>([])
  const [userEmail, setUserEmail]   = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchProperties = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('properties')
      .select(`
        id, property_type, unit_number, complex_or_building_name,
        street_number, street_name, suburb, city, province,
        google_maps_url, created_at,
        evaluations (id, status, date_captured)
      `)
      .order('created_at', { ascending: false })

    if (filterType)   query = query.eq('property_type', filterType)
    if (filterSuburb) query = query.eq('suburb', filterSuburb)

    const { data } = await query
    let results = (data ?? []) as unknown as Property[]

    if (search) {
      const q = search.toLowerCase()
      results = results.filter(p => formatAddress(p).toLowerCase().includes(q))
    }

    setProperties(results)
    setLoading(false)
  }, [search, filterType, filterSuburb])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserEmail(data.user.email ?? null)
    })

    // Load distinct suburbs for the filter dropdown
    supabase.from('properties').select('suburb').not('suburb', 'is', null).then(({ data }) => {
      const unique = [...new Set((data ?? []).map((r: { suburb: string | null }) => r.suburb).filter(Boolean))] as string[]
      setSuburbs(unique.sort())
    })
  }, [router])

  async function deleteProperty(p: Property) {
    if (!confirm(`Delete ${formatAddress(p)}? This cannot be undone.`)) return
    setDeletingId(p.id)
    const { error } = await supabase.from('properties').delete().eq('id', p.id)
    if (error) {
      alert(error.code === '23503'
        ? "This property has evaluations linked to it and can't be deleted. Delete those evaluations first."
        : error.message)
      setDeletingId(null)
      return
    }
    setDeletingId(null)
    fetchProperties()
  }

  useEffect(() => {
    const timer = setTimeout(fetchProperties, 300)
    return () => clearTimeout(timer)
  }, [fetchProperties])

  return (
    <div className="p-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-[#1a1a1a]">Properties</h1>
      </div>

      {/* Filters */}
      <div className={`${card} p-4 mb-6 flex gap-3 flex-wrap items-center`}>
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

      {!loading && (
        <p className="text-sm text-gray-400 mb-4">
          {properties.length} {properties.length === 1 ? 'property' : 'properties'}
        </p>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">Loading properties…</div>
      ) : properties.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <p className="text-gray-400 text-sm">No properties found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {properties.map(p => {
            const address  = formatAddress(p)
            const mapLink  = p.google_maps_url ?? (address !== 'Unknown address' ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null)
            const evals    = p.evaluations ?? []
            const latestEv = evals[0] ?? null

            return (
              <div key={p.id} className={`${card} flex items-center justify-between px-5 py-4 gap-4`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[#1a1a1a]">{address}</span>
                    {p.property_type && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                        {TYPE_LABELS[p.property_type] ?? p.property_type}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 mt-1 text-sm text-gray-400 flex-wrap">
                    {p.suburb && <span>{p.suburb}</span>}
                    {p.city && p.city !== p.suburb && <span>{p.city}</span>}
                    {evals.length > 0 && (
                      <span>{evals.length} evaluation{evals.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0 flex-wrap justify-end">
                  {latestEv && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOURS[latestEv.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_LABELS[latestEv.status] ?? latestEv.status}
                    </span>
                  )}
                  {mapLink && (
                    <a
                      href={mapLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-400 hover:text-[#1a1a1a] transition-colors"
                      onClick={e => e.stopPropagation()}
                    >
                      Maps ↗
                    </a>
                  )}
                  {latestEv && (
                    <Link
                      href={`/dashboard/evaluations/${latestEv.id}`}
                      className="text-xs font-medium text-[#1a1a1a] hover:underline"
                    >
                      View evaluation →
                    </Link>
                  )}
                  {canDelete(userEmail) && (
                    <button
                      onClick={() => deleteProperty(p)}
                      disabled={deletingId === p.id}
                      className="text-xs font-medium text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                    >
                      {deletingId === p.id ? 'Deleting…' : 'Delete'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
