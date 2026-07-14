'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────
type Property = {
  id: string
  property_type: string | null
  street_name: string | null
  suburb: string | null
  city: string | null
}

type PicklistOption = { id: string; value: string; label: string; allow_free_text?: boolean }

// ── Address helpers ────────────────────────────────────────────
function capitalizeWords(text: string): string {
  return text.replace(/\b\w/g, c => c.toUpperCase())
}

function parseAddressParts(raw: string): { street_name: string; suburb: string | null; city: string | null; postal_code: string | null } {
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean)

  let postal_code: string | null = null
  if (parts.length > 1 && /^\d{4}$/.test(parts[parts.length - 1])) {
    postal_code = parts.pop()!
  }

  if (parts.length >= 3) {
    const city = parts.pop()!
    const suburb = parts.pop()!
    return { street_name: capitalizeWords(parts.join(', ')), suburb: capitalizeWords(suburb), city: capitalizeWords(city), postal_code }
  }
  if (parts.length === 2) {
    const suburb = parts.pop()!
    return { street_name: capitalizeWords(parts.join(', ')), suburb: capitalizeWords(suburb), city: null, postal_code }
  }
  return { street_name: capitalizeWords(parts[0] ?? raw), suburb: null, city: null, postal_code }
}

type ContactSlot = {
  contact_id: string
  contact_name: string
  tag_option_id: string
}

// ── Hardcoded options (from spec) ─────────────────────────────
const LEAD_SOURCES = [
  { value: 'cold_calling',    label: 'Cold Calling' },
  { value: 'current_client',  label: 'Current Client' },
  { value: 'facebook',        label: 'Facebook' },
  { value: 'flyer',           label: 'Flyer' },
  { value: 'for_sale_board',  label: 'For Sale Board' },
  { value: 'instagram',       label: 'Instagram' },
  { value: 'office_phone_in', label: 'Office Phone-In' },
  { value: 'referral',        label: 'Referral' },
  { value: 'website',         label: 'Website' },
  { value: 'other',           label: 'Other' },
]

const MOTIVATIONS = [
  { value: 'upsizing',   label: 'Upsizing' },
  { value: 'downsizing', label: 'Downsizing' },
  { value: 'other',      label: 'Other' },
]

const TIMELINES = [
  { value: 'now',                label: 'Now' },
  { value: 'within_3_6_months',  label: 'Within 3–6 Months' },
  { value: 'within_6_12_months', label: 'Within 6–12 Months' },
  { value: '12_months_plus',     label: '12 Months+' },
  { value: 'unknown',            label: 'Unknown' },
]

const CONTACT_TAGS = ['Seller', 'Attorney', 'Managing Agent', 'Tenant']

// ── Address helper ────────────────────────────────────────────
function displayAddress(p: Property): string {
  return p.street_name || p.suburb || p.city || ''
}

export default function NewEvaluationPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)

  // Property
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [showAddProperty, setShowAddProperty]   = useState(false)
  const [newPropertyType, setNewPropertyType]   = useState('')
  const [newPropertyAddress, setNewPropertyAddress] = useState('')
  const [creatingProperty, setCreatingProperty] = useState(false)

  // Contacts
  const [contacts, setContacts] = useState<ContactSlot[]>([])

  // Deal details
  const [status, setStatus]               = useState('in_progress')
  const [propertyStatus, setPropertyStatus] = useState('')

  // Lead info
  const [leadGeneratedBy, setLeadGeneratedBy]     = useState('')
  const [leadSource, setLeadSource]               = useState('')
  const [leadSourceOther, setLeadSourceOther]     = useState('')
  const [referralType, setReferralType]           = useState('')
  const [leadReferralNotes, setLeadReferralNotes] = useState('')

  // Motivation
  const [motivation, setMotivation]           = useState('')
  const [motivationOther, setMotivationOther] = useState('')

  // Timeline
  const [timeline, setTimeline]         = useState('')
  const [timelineNotes, setTimelineNotes] = useState('')

  // Scheduling
  const [schedDate, setSchedDate] = useState('')
  const [schedTime, setSchedTime] = useState('')
  const scheduledAt = schedDate && schedTime ? `${schedDate}T${schedTime}` : ''

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserId(data.user.id)
    })
  }, [router])

  // ── Create property ──────────────────────────────────────
  async function createProperty() {
    if (!newPropertyType) { setError('Please select a property type.'); return }
    if (!newPropertyAddress.trim()) { setError('Please enter an address.'); return }
    setError('')
    setCreatingProperty(true)

    const raw = newPropertyAddress.trim()

    // Try to geocode via Google for accurate suburb/city/postal code/coordinates;
    // fall back to comma-parsing the raw text if geocoding is unavailable/fails.
    let insertPayload: Record<string, unknown>
    const geoRes = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: raw }),
    })

    if (geoRes.ok) {
      const geo = await geoRes.json()
      insertPayload = {
        property_type: newPropertyType,
        street_number: geo.street_number,
        street_name: geo.route ? capitalizeWords(geo.route) : capitalizeWords(raw),
        suburb: geo.suburb ? capitalizeWords(geo.suburb) : null,
        city: geo.city ? capitalizeWords(geo.city) : null,
        province: geo.province,
        postal_code: geo.postal_code,
        country: geo.country ?? 'South Africa',
        latitude: geo.latitude,
        longitude: geo.longitude,
        google_place_id: geo.google_place_id,
        google_maps_url: geo.formatted_address
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(geo.formatted_address)}`
          : null,
        created_by_user_id: userId,
      }
    } else {
      const parsed = parseAddressParts(raw)
      insertPayload = {
        property_type: newPropertyType,
        street_name: parsed.street_name,
        suburb: parsed.suburb,
        city: parsed.city,
        postal_code: parsed.postal_code,
        created_by_user_id: userId,
      }
    }

    const { data, error: err } = await supabase
      .from('properties')
      .insert(insertPayload)
      .select('id, property_type, street_name, suburb, city')
      .single()

    setCreatingProperty(false)
    if (err) { setError(err.message); return }
    setSelectedProperty(data as Property)
    setShowAddProperty(false)
    setNewPropertyType('')
    setNewPropertyAddress('')
  }

  // ── Contacts ─────────────────────────────────────────────
  function addContact(contact_id: string, contact_name: string) {
    setContacts(prev => [...prev, { contact_id, contact_name, tag_option_id: '' }])
  }

  function removeContact(idx: number) {
    setContacts(prev => prev.filter((_, i) => i !== idx))
  }

  function setContactTag(idx: number, tag: string) {
    setContacts(prev => prev.map((c, i) => i === idx ? { ...c, tag_option_id: tag } : c))
  }

  // ── Submit ───────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProperty) { setError('Please select or add a property.'); return }
    if (contacts.length === 0) { setError('Please add at least one contact.'); return }
    if (!userId) return

    setError('')
    setSaving(true)

    const motivationNotes = motivation === 'other' ? motivationOther : null
    const sellingTimelineNotes = timeline === 'unknown' ? timelineNotes : null

    const { data: ev, error: evErr } = await supabase.from('evaluations').insert({
      property_id:                      selectedProperty.id,
      captured_by_user_id:              userId,
      status,
      property_status:                  propertyStatus || null,
      lead_generated_by:                leadGeneratedBy || null,
      lead_source_other_text:           leadSource === 'other' ? leadSourceOther : null,
      lead_referral_notes:              leadReferralNotes || null,
      referral_type:                    referralType || null,
      motivation_for_selling_notes:     motivationNotes,
      selling_timeline_notes:           sellingTimelineNotes,
      scheduled_at:                     scheduledAt || null,
    }).select('id').single()

    if (evErr || !ev) { setError(evErr?.message ?? 'Failed to save.'); setSaving(false); return }

    // Store lead_source and motivation as text in notes columns since they're hardcoded values
    // (picklist option IDs are not used here — values stored directly)
    await supabase.from('evaluations').update({
      lead_source_other_text: leadSource || null,
      motivation_for_selling_notes: motivation === 'other'
        ? `Other: ${motivationOther}`
        : (MOTIVATIONS.find(m => m.value === motivation)?.label ?? null),
      selling_timeline_notes: timeline === 'unknown'
        ? `Unknown: ${timelineNotes}`
        : (TIMELINES.find(t => t.value === timeline)?.label ?? null),
    }).eq('id', ev.id)

    // Insert contacts
    await supabase.from('evaluation_contacts').insert(
      contacts.map((c, i) => ({
        evaluation_id: ev.id,
        contact_id: c.contact_id,
        is_primary: i === 0,
        sort_order: i,
      }))
    )

    // Seed pipeline steps — inspection before lightstone
    await supabase.from('evaluation_pipeline_steps').insert([
      { evaluation_id: ev.id, step_key: 'captured',             sort_order: 0, is_complete: true,  completed_at: new Date().toISOString(), completed_by_user_id: userId },
      { evaluation_id: ev.id, step_key: 'scheduled',            sort_order: 1, is_complete: !!scheduledAt },
      { evaluation_id: ev.id, step_key: 'property_inspected',   sort_order: 2 },
      { evaluation_id: ev.id, step_key: 'description_captured', sort_order: 3 },
      { evaluation_id: ev.id, step_key: 'lightstone_uploaded',  sort_order: 4 },
    ])

    router.push(`/dashboard/evaluations/${ev.id}`)
  }

  const primaryFilled = contacts.length > 0
  const mapsUrl = newPropertyAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(newPropertyAddress)}`
    : null

  return (
    <div className="bg-[#f8f7f4] min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-[#1a1a1a] mb-8">New Evaluation</h1>
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Property ── */}
          <Section title="Property">
            {selectedProperty ? (
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                  <p className="font-medium text-[#1a1a1a] text-sm">{displayAddress(selectedProperty)}</p>
                  <p className="text-xs text-gray-400 mt-0.5 capitalize">
                    {selectedProperty.property_type?.replace('_', ' ')}
                  </p>
                </div>
                <button type="button" onClick={() => setSelectedProperty(null)}
                  className="text-gray-400 hover:text-[#1a1a1a] text-xl transition-colors">×</button>
              </div>
            ) : showAddProperty ? (
              <div className="space-y-4 border border-gray-200 rounded-xl p-4 bg-gray-50">
                <div>
                  <label className={labelCls}>Property Type <span className="text-red-400">*</span></label>
                  <select value={newPropertyType} onChange={e => setNewPropertyType(e.target.value)} className={select}>
                    <option value="">Select type…</option>
                    <option value="freehold">Freehold</option>
                    <option value="sectional_title">Sectional Title</option>
                    <option value="vacant_land">Vacant Land</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Address <span className="text-red-400">*</span></label>
                  <input
                    type="text"
                    value={newPropertyAddress}
                    onChange={e => setNewPropertyAddress(e.target.value)}
                    placeholder="e.g. 27 Audley Road, Hillcrest, KZN"
                    className={input}
                  />
                  {mapsUrl && (
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-1.5 text-xs text-blue-500 hover:text-blue-700 transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                        <circle cx="12" cy="10" r="3"/>
                      </svg>
                      View on Google Maps
                    </a>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => { setShowAddProperty(false); setNewPropertyType(''); setNewPropertyAddress('') }}
                    className={`${btn.secondary} flex-1`}>Cancel</button>
                  <button type="button" onClick={createProperty} disabled={creatingProperty} className={`${btn.primary} flex-1`}>
                    {creatingProperty ? 'Looking up address…' : 'Add Property'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <PropertySearch onSelect={setSelectedProperty} />
                <p className="text-xs text-gray-400 text-center">— or —</p>
                <button type="button" onClick={() => setShowAddProperty(true)} className={`${btn.secondary} w-full`}>
                  + Add New Property
                </button>
              </div>
            )}
          </Section>

          {/* ── Contacts ── */}
          <Section title="Contacts">
            <p className="text-xs text-gray-400 -mt-1 mb-3">
              Primary contact is required. Add secondary contacts once the primary is set.
            </p>

            {contacts.map((c, i) => (
              <div key={i} className="flex items-center gap-3 mb-2">
                <div className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-[#1a1a1a] flex items-center gap-2 flex-wrap">
                  {i === 0 && (
                    <span className="text-xs bg-[#1a1a1a] text-white rounded-full px-2 py-0.5 flex-shrink-0">Primary</span>
                  )}
                  <span className="flex-1 min-w-0 truncate">{c.contact_name}</span>
                  <select value={c.tag_option_id} onChange={e => setContactTag(i, e.target.value)}
                    className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-600 focus:outline-none cursor-pointer flex-shrink-0">
                    <option value="">No tag</option>
                    {CONTACT_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <button type="button" onClick={() => removeContact(i)}
                  className="text-gray-300 hover:text-red-400 text-xl transition-colors flex-shrink-0">×</button>
              </div>
            ))}

            <ContactSearch
              placeholder={contacts.length === 0 ? 'Search for primary contact…' : 'Search to add secondary contact…'}
              onSelect={addContact}
              excludeIds={contacts.map(c => c.contact_id)}
            />
          </Section>

          {/* ── Deal Details ── */}
          <Section title="Deal Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Evaluation Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className={select}>
                  <option value="in_progress">In Progress</option>
                  <option value="open">Open</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                  <option value="future">Future</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Property Status</label>
                <select value={propertyStatus} onChange={e => setPropertyStatus(e.target.value)} className={select}>
                  <option value="">—</option>
                  <option value="off_market">Off Market</option>
                  <option value="on_market">On Market</option>
                  <option value="deceased_estate">Deceased Estate</option>
                </select>
              </div>
            </div>
          </Section>

          {/* ── Lead Information ── */}
          <Section title="Lead Information">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Lead Generated By</label>
                <select value={leadGeneratedBy} onChange={e => setLeadGeneratedBy(e.target.value)} className={select}>
                  <option value="">—</option>
                  <option value="shelley_residential">Shelley Residential</option>
                  <option value="seller_agent_partner">Seller Agent Partner</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Lead Source</label>
                <select value={leadSource} onChange={e => setLeadSource(e.target.value)} className={select}>
                  <option value="">—</option>
                  {LEAD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            {leadSource === 'other' && (
              <div>
                <label className={labelCls}>Other — please specify</label>
                <input value={leadSourceOther} onChange={e => setLeadSourceOther(e.target.value)}
                  placeholder="Describe the lead source" className={input} />
              </div>
            )}

            <div>
              <label className={labelCls}>Referral Type</label>
              <select value={referralType} onChange={e => setReferralType(e.target.value)} className={select}>
                <option value="">—</option>
                <option value="agent_referral">Agent Referral</option>
                <option value="past_client_referral">Past Client Referral</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>Referral Notes</label>
              <textarea value={leadReferralNotes} onChange={e => setLeadReferralNotes(e.target.value)}
                placeholder="Any notes about the lead or referral…"
                rows={3} className={`${input} resize-none`} />
            </div>
          </Section>

          {/* ── Motivation & Timeline ── */}
          <Section title="Motivation & Timeline">
            <div>
              <label className={labelCls}>Motivation for Selling</label>
              <select value={motivation} onChange={e => setMotivation(e.target.value)} className={select}>
                <option value="">—</option>
                {MOTIVATIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            {motivation === 'other' && (
              <div>
                <label className={labelCls}>Please specify reason</label>
                <textarea value={motivationOther} onChange={e => setMotivationOther(e.target.value)}
                  placeholder="Describe the seller's motivation…"
                  rows={3} className={`${input} resize-none`} />
              </div>
            )}

            <div>
              <label className={labelCls}>Selling Timeline</label>
              <select value={timeline} onChange={e => setTimeline(e.target.value)} className={select}>
                <option value="">—</option>
                {TIMELINES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {timeline === 'unknown' && (
              <div>
                <label className={labelCls}>Timeline Notes</label>
                <textarea value={timelineNotes} onChange={e => setTimelineNotes(e.target.value)}
                  placeholder="Any context about the uncertain timeline…"
                  rows={3} className={`${input} resize-none`} />
              </div>
            )}
          </Section>

          {/* ── Scheduling ── */}
          <Section title="Schedule Evaluation">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)}
                  className={input} />
              </div>
              <div>
                <label className={labelCls}>Time</label>
                <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)}
                  className={input} />
              </div>
            </div>
          </Section>

          {error && <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg">{error}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={() => router.push('/dashboard/evaluations')} className={`${btn.secondary} flex-1`}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={`${btn.primary} flex-1 py-4`}>
              {saving ? 'Saving…' : 'Save Evaluation'}
            </button>
          </div>

        </form>
      </main>
    </div>
  )
}

// ── PropertySearch combobox ───────────────────────────────────
function PropertySearch({ onSelect }: { onSelect: (p: Property) => void }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<Property[]>([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef          = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('properties')
        .select('id, property_type, street_name, suburb, city')
        .or(`street_name.ilike.%${query}%,suburb.ilike.%${query}%,city.ilike.%${query}%`)
        .limit(8)
      setResults(data ?? [])
      setOpen(true)
      setLoading(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div ref={containerRef} className="relative">
      <input type="text" value={query} onChange={e => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        placeholder="Search existing properties…"
        className={input} />
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 border-t-0 rounded-b-lg shadow-md max-h-60 overflow-y-auto">
          {loading && <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>}
          {!loading && results.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No properties found</div>}
          {!loading && results.map(p => (
            <button key={p.id} type="button"
              onMouseDown={() => { onSelect(p); setQuery(''); setOpen(false) }}
              className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a1a] hover:bg-[#f8f7f4] border-b border-gray-100 last:border-b-0 transition-colors">
              <span className="font-medium">{p.street_name || p.suburb || p.city}</span>
              {p.property_type && (
                <span className="ml-2 text-xs text-gray-400 capitalize">{p.property_type.replace('_', ' ')}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ContactSearch combobox ────────────────────────────────────
function ContactSearch({ placeholder, onSelect, excludeIds }: {
  placeholder: string
  onSelect: (id: string, name: string) => void
  excludeIds: string[]
}) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<{ id: string; first_name: string; last_name: string; title: string | null }[]>([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef          = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, title')
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
        .order('first_name').limit(8)
      setResults((data ?? []).filter(r => !excludeIds.includes(r.id)))
      setOpen(true)
      setLoading(false)
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div ref={containerRef} className="relative">
      <input type="text" value={query} onChange={e => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        placeholder={placeholder}
        className={input} />
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 border-t-0 rounded-b-lg shadow-md max-h-60 overflow-y-auto">
          {loading && <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>}
          {!loading && results.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No contacts found</div>}
          {!loading && results.map(r => {
            const name = `${r.title ? r.title + ' ' : ''}${r.first_name} ${r.last_name}`.trim()
            return (
              <button key={r.id} type="button"
                onMouseDown={() => { onSelect(r.id, name); setQuery(''); setOpen(false) }}
                className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a1a] hover:bg-[#f8f7f4] border-b border-gray-100 last:border-b-0 transition-colors">
                {name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${card} p-6 space-y-4`}>
      <h3 className={sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}
