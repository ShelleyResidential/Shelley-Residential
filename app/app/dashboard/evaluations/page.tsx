'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input } from '@/lib/styles'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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
  property_status: string | null
  evaluation_price: number | null
  marketing_price: number | null
  sellers_agent_user_id: string | null
  transaction_coordinator_user_id: string | null
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
  return [p.street_number, p.street_name, p.suburb].filter(Boolean).join(' ') || p.city || 'Unknown address'
}

function mapQuery(p: Property): string {
  if (p.latitude != null && p.longitude != null) return `${p.latitude},${p.longitude}`
  return [p.street_number, p.street_name, p.suburb, p.city, p.province, p.postal_code, p.country].filter(Boolean).join(' ')
}

function capitalizeWords(text: string): string {
  return text.replace(/\b\w/g, c => c.toUpperCase())
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

function getSeller(ev: Evaluation): Contact | null {
  const seller = ev.evaluation_contacts?.find(c => c.picklist_options?.label === 'Seller')
    ?? ev.evaluation_contacts?.find(c => c.is_primary)
  return seller?.contacts ?? null
}

function sellerName(ev: Evaluation): string {
  const contact = getSeller(ev)
  return contact ? `${contact.first_name} ${contact.last_name}`.trim() : '—'
}

function fullName(c: Contact): string {
  return [c.title, c.first_name, c.last_name].filter(Boolean).join(' ')
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
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
  on_hold:     { label: 'On Hold',        colour: 'bg-orange-50 text-orange-700' },
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
  { key: 'on_hold',    label: 'On Hold' },
  { key: 'cancelled',  label: 'Cancelled' },
]

export default function EvaluationsPage() {
  const router = useRouter()
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [profiles, setProfiles]       = useState<Record<string, Profile>>({})
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [selectedLead, setSelectedLead] = useState<LeadInfo | null>(null)

  const fetchEvaluations = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('evaluations')
      .select(`
        id, status, date_captured, scheduled_at, property_status,
        evaluation_price, marketing_price,
        sellers_agent_user_id, transaction_coordinator_user_id,
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
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={e => { e.stopPropagation(); if (ev.properties) setSelectedProperty(ev.properties) }}
                        className="font-medium text-[#1a1a1a] hover:text-blue-600 hover:underline transition-colors"
                      >
                        {formatAddress(ev.properties)}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{date}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{agent?.full_name ?? agent?.email ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{tc?.full_name ?? tc?.email ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getSeller(ev) ? (
                        <button
                          onClick={e => { e.stopPropagation(); setSelectedContact(getSeller(ev)) }}
                          className="text-gray-500 hover:text-blue-600 hover:underline transition-colors"
                        >
                          {sellerName(ev)}
                        </button>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedLead(ev) }}
                        className="text-gray-500 hover:text-blue-600 hover:underline transition-colors"
                      >
                        {leadSource}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatCurrency(ev.evaluation_price)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatCurrency(ev.marketing_price)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedProperty && (
        <PropertyDetailsModal
          property={selectedProperty}
          onClose={() => setSelectedProperty(null)}
          onUpdated={fetchEvaluations}
        />
      )}

      {selectedContact && (
        <ContactDetailsModal contact={selectedContact} onClose={() => setSelectedContact(null)} />
      )}

      {selectedLead && (
        <LeadDetailsModal lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
    </div>
  )
}

// ── Property details pop-up ──────────────────────────────────
function PropertyDetailsModal({ property, onClose, onUpdated }: {
  property: Property; onClose: () => void; onUpdated: () => void
}) {
  const [current, setCurrent] = useState(property)
  const [refreshError, setRefreshError] = useState('')

  const address = formatAddress(current)
  const query   = mapQuery(current)
  const mapSrc  = `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`

  const fields: [string, string | null][] = [
    ['Property Type', current.property_type ? current.property_type.replace('_', ' ') : null],
    ['Unit Number', current.unit_number],
    ['Complex / Building', current.complex_or_building_name],
    ['Street Number', current.street_number],
    ['Street Name', current.street_name],
    ['Suburb', current.suburb],
    ['City', current.city],
    ['Province', current.province],
    ['Postal Code', current.postal_code],
    ['Country', current.country],
    ['Coordinates', current.latitude != null && current.longitude != null ? `${current.latitude}, ${current.longitude}` : null],
  ]

  async function refreshFromGoogle() {
    setRefreshError('')

    const raw = [current.street_number, current.street_name, current.suburb, current.city].filter(Boolean).join(' ') || address
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: raw }),
    })

    if (!res.ok) {
      setRefreshError('Could not find this address on Google. Try editing it manually.')
      return
    }

    const geo = await res.json()
    const updates = {
      street_number: geo.street_number,
      street_name:   geo.route ? capitalizeWords(geo.route) : current.street_name,
      suburb:        geo.suburb ? capitalizeWords(geo.suburb) : null,
      city:          geo.city ? capitalizeWords(geo.city) : null,
      province:      geo.province,
      postal_code:   geo.postal_code,
      country:       geo.country ?? current.country,
      latitude:      geo.latitude,
      longitude:     geo.longitude,
      google_place_id: geo.google_place_id,
      google_maps_url: geo.formatted_address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(geo.formatted_address)}`
        : current.google_maps_url,
    }

    const { error } = await supabase.from('properties').update(updates).eq('id', current.id)

    if (error) { setRefreshError(error.message); return }
    setCurrent({ ...current, ...updates })
    onUpdated()
  }

  // Auto-populate missing suburb/city/postal code on open, for properties
  // created before geocoding existed — no manual click needed.
  useEffect(() => {
    if (!current.suburb || !current.city || !current.postal_code) {
      refreshFromGoogle()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
          <h3 className="text-lg font-bold text-[#1a1a1a]">{address}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-[#1a1a1a] text-xl leading-none flex-shrink-0">×</button>
        </div>

        <div className="p-6">
          {refreshError && <p className="text-xs text-red-500 mb-4">{refreshError}</p>}

          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {fields.filter(([, value]) => value).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
                <p className="text-[#1a1a1a] font-medium">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 pb-6">
          <iframe
            src={mapSrc}
            width="100%"
            height="260"
            style={{ border: 0, borderRadius: 12 }}
            loading="lazy"
            title="Property location map"
          />
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btn.primary} w-full mt-3`}
          >
            Get Directions
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Contact details pop-up ───────────────────────────────────
function ContactDetailsModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const fields: [string, string | null][] = [
    ['Title', contact.title],
    ['First Name', contact.first_name],
    ['Surname', contact.last_name],
    ['Status', contact.status],
    ['Tags', contact.tags?.length ? contact.tags.join(', ') : null],
    ['ID Number', contact.id_number],
    ['Date Added', formatDate(contact.date_added)],
    ['Phone', contact.phone_number],
    ['Email', contact.email_address],
    ['Preference', contact.contact_preference],
    ['Address', contact.address],
    ['Marital Status', contact.marital_status],
    ['Birthday', formatDate(contact.birthday)],
    ['Wedding Anniversary', formatDate(contact.wedding_anniversary)],
    ['Home Anniversary', formatDate(contact.home_anniversary)],
    ['Occupation', contact.occupation],
    ['Company', contact.company_name],
    ['Division', contact.division],
    ['Branch', contact.branch],
  ]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
          <h3 className="text-lg font-bold text-[#1a1a1a]">{fullName(contact)}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-[#1a1a1a] text-xl leading-none flex-shrink-0">×</button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {fields.filter(([, value]) => value).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
                <p className="text-[#1a1a1a] font-medium">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 pb-6">
          <Link href={`/dashboard/contacts/${contact.id}`} className={`${btn.primary} w-full block text-center`}>
            View Full Contact →
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Lead details pop-up ───────────────────────────────────────
function LeadDetailsModal({ lead, onClose }: { lead: LeadInfo; onClose: () => void }) {
  const fields: [string, string | null][] = [
    ['Lead Generated By', lead.lead_generated_by ? lead.lead_generated_by.replace('_', ' ') : null],
    ['Lead Source', lead.lead_source_picklist?.label ?? lead.lead_source_other_text],
    ['Referral Type', lead.referral_type ? lead.referral_type.replace('_', ' ') : null],
    ['Referral Notes', lead.lead_referral_notes],
  ]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-6 border-b border-gray-100">
          <h3 className="text-lg font-bold text-[#1a1a1a]">Lead Details</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-[#1a1a1a] text-xl leading-none flex-shrink-0">×</button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {fields.filter(([, value]) => value).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
                <p className="text-[#1a1a1a] font-medium">{value}</p>
              </div>
            ))}
          </div>
          {fields.every(([, value]) => !value) && (
            <p className="text-sm text-gray-400">No lead details captured for this evaluation.</p>
          )}
        </div>

        <div className="px-6 pb-6">
          <Link href={`/dashboard/evaluations/${lead.id}`} className={`${btn.primary} w-full block text-center`}>
            View Evaluation →
          </Link>
        </div>
      </div>
    </div>
  )
}
