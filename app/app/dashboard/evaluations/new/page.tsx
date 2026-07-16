'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { useRouter, useSearchParams } from 'next/navigation'

const DRAFT_STORAGE_KEY = 'evaluationFormDraft'

// ── Types ─────────────────────────────────────────────────────
type Property = {
  id: string
  property_type: string | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  city: string | null
}

type DraftProperty = {
  unit_number: string
  complex_or_building_name: string
  sectional_title_number: string
  street_number: string
  street_name: string
  suburb: string
  city: string
  province: string
  postal_code: string
  country: string
  latitude: number | null
  longitude: number | null
  google_place_id: string | null
  google_maps_url: string | null
}

const EMPTY_DRAFT: DraftProperty = {
  unit_number: '', complex_or_building_name: '', sectional_title_number: '',
  street_number: '', street_name: '', suburb: '', city: '', province: '',
  postal_code: '', country: 'South Africa', latitude: null, longitude: null,
  google_place_id: null, google_maps_url: null,
}

function draftMapQuery(d: DraftProperty): string {
  if (d.latitude != null && d.longitude != null) return `${d.latitude},${d.longitude}`
  return [d.street_number, d.street_name, d.suburb, d.city, d.province, d.postal_code, d.country].filter(Boolean).join(' ')
}

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
  { value: 'google',                 label: 'Google' },
  { value: 'social_media',           label: 'Social Media' },
  { value: 'property_portal',        label: 'Property Portal' },
  { value: 'signage_boards',         label: 'Signage / Boards' },
  { value: 'print_flyer_letter',     label: 'Print Flyer or Letter' },
  { value: 'community_promo_event',  label: 'Community / Promo Event' },
  { value: 'office_phone_in',        label: 'Office Phone-In' },
  { value: 'website',                label: 'Website' },
  { value: 'past_client',            label: 'Past Client' },
  { value: 'referral',               label: 'Referral' },
  { value: 'other',                  label: 'Other (please specify)' },
]

const REFERRAL_TYPES = [
  { value: 'friend',                                  label: 'Friend' },
  { value: 'family_member',                           label: 'Family Member' },
  { value: 'neighbour',                               label: 'Neighbour' },
  { value: 'past_shelley_client',                     label: 'Past Shelley Client' },
  { value: 'estate_agent',                            label: 'Estate Agent' },
  { value: 'attorney',                                label: 'Attorney' },
  { value: 'bond_originator',                         label: 'Bond Originator' },
  { value: 'financial_adviser',                       label: 'Financial Adviser' },
  { value: 'builder_contractor',                       label: 'Builder / Contractor' },
  { value: 'interior_designer',                       label: 'Interior Designer' },
  { value: 'community_group_resident_association',    label: 'Community Group / Resident Association' },
  { value: 'other',                                   label: 'Other (please specify)' },
]

const MOTIVATIONS = [
  { value: 'upsizing',                    label: 'Upsizing' },
  { value: 'downsizing',                  label: 'Downsizing' },
  { value: 'relocating',                  label: 'Relocating' },
  { value: 'emigration',                  label: 'Emigration' },
  { value: 'lifestyle_change',            label: 'Lifestyle Change' },
  { value: 'retirement',                  label: 'Retirement' },
  { value: 'financial_reasons',           label: 'Financial Reasons' },
  { value: 'investment_decision',         label: 'Investment Decision' },
  { value: 'divorce_separation',          label: 'Divorce / Separation' },
  { value: 'deceased_estate',             label: 'Deceased Estate' },
  { value: 'not_selling_evaluation_only', label: 'Not Selling, Evaluation Only' },
  { value: 'other',                       label: 'Other (please specify)' },
]

const TIMELINES = [
  { value: 'ready_now',         label: 'Ready to list now' },
  { value: 'within_30_days',    label: 'Within the next 30 days' },
  { value: 'within_3_months',   label: 'Within the next 3 months' },
  { value: 'within_6_months',   label: 'Within the next 6 months' },
  { value: 'within_12_months',  label: 'Within the next 12 months' },
  { value: 'no_fixed_timeline', label: 'No fixed timeline – planning ahead' },
  { value: 'just_curious',      label: "Just curious about home's value" },
]

const REASONS_LOST = [
  { value: 'evaluation_price',  label: 'Evaluation Price' },
  { value: 'commission',        label: 'Commission' },
  { value: 'mandate_terms',     label: 'Mandate Terms' },
  { value: 'agency_size',       label: 'Agency Size' },
  { value: 'not_mls_member',    label: 'Not an MLS Member' },
  { value: 'another_agency',    label: 'Another Agency' },
  { value: 'not_selling',       label: 'Not Selling' },
  { value: 'other',             label: 'Other (please specify)' },
]

const CONTACT_TAGS = ['Seller', 'Attorney', 'Managing Agent', 'Tenant']

type Profile = { id: string; full_name: string | null; email: string | null; role: string | null }

// ── Address helper ────────────────────────────────────────────
function displayAddress(p: Property): string {
  return [p.street_number, p.street_name].filter(Boolean).join(' ') || p.suburb || p.city || ''
}

// Search across street number/name, suburb and city, requiring every word
// in the query to match at least one of those fields (so "27 audley" finds
// a property whose number and name are stored in separate columns).
function applyAddressSearch<T extends { or(filters: string): T }>(query: T, raw: string): T {
  const words = raw.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[%,_]/g, ''))
  return words.reduce(
    (q, word) => word ? q.or(`street_number.ilike.%${word}%,street_name.ilike.%${word}%,suburb.ilike.%${word}%,city.ilike.%${word}%`) : q,
    query
  )
}

// Snapshot of everything the agent may have already filled in, saved to
// sessionStorage before navigating away to add a new contact, and restored
// on return so the agent never loses progress on the evaluation form.
type EvaluationDraftSnapshot = {
  selectedProperty: Property | null
  showAddProperty: boolean
  newPropertyType: string
  newPropertyAddress: string
  showPropertyReview: boolean
  propertyDraft: DraftProperty
  contacts: ContactSlot[]
  status: string
  propertyStatus: string
  reasonLost: string
  reasonLostOther: string
  agentId: string
  tcId: string
  leadGeneratedBy: string
  leadSource: string
  leadSourceOther: string
  referralType: string
  referralTypeOther: string
  referredByContactId: string
  referredByContactName: string
  leadReferralNotes: string
  motivation: string
  motivationOther: string
  timeline: string
  schedDate: string
  schedTime: string
}

function NewEvaluationForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [userId, setUserId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])

  // Property
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [showAddProperty, setShowAddProperty]   = useState(false)
  const [newPropertyType, setNewPropertyType]   = useState('')
  const [newPropertyAddress, setNewPropertyAddress] = useState('')
  const [addressMatches, setAddressMatches]     = useState<Property[]>([])
  const [checkingMatches, setCheckingMatches]   = useState(false)
  const [lookingUpAddress, setLookingUpAddress] = useState(false)
  const [showPropertyReview, setShowPropertyReview] = useState(false)
  const [propertyDraft, setPropertyDraft]       = useState<DraftProperty>(EMPTY_DRAFT)
  const [savingProperty, setSavingProperty]     = useState(false)

  // Contacts
  const [contacts, setContacts] = useState<ContactSlot[]>([])

  // Deal details
  const [status, setStatus]               = useState('new')
  const [propertyStatus, setPropertyStatus] = useState('')
  const [reasonLost, setReasonLost]         = useState('')
  const [reasonLostOther, setReasonLostOther] = useState('')
  const [agentId, setAgentId]             = useState('')
  const [tcId, setTcId]                   = useState('')

  // Lead info
  const [leadGeneratedBy, setLeadGeneratedBy]     = useState('')
  const [leadSource, setLeadSource]               = useState('')
  const [leadSourceOther, setLeadSourceOther]     = useState('')
  const [referralType, setReferralType]           = useState('')
  const [referralTypeOther, setReferralTypeOther] = useState('')
  const [referredByContactId, setReferredByContactId]     = useState('')
  const [referredByContactName, setReferredByContactName] = useState('')
  const [leadReferralNotes, setLeadReferralNotes] = useState('')

  // Motivation
  const [motivation, setMotivation]           = useState('')
  const [motivationOther, setMotivationOther] = useState('')

  // Timeline
  const [timeline, setTimeline]         = useState('')

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
    supabase.from('profiles').select('id, full_name, email, role').then(({ data }) => {
      setProfiles((data ?? []) as Profile[])
    })
  }, [router])

  function buildDraftSnapshot(): EvaluationDraftSnapshot {
    return {
      selectedProperty, showAddProperty, newPropertyType, newPropertyAddress,
      showPropertyReview, propertyDraft, contacts, status, propertyStatus,
      reasonLost, reasonLostOther, agentId, tcId, leadGeneratedBy, leadSource,
      leadSourceOther, referralType, referralTypeOther, referredByContactId,
      referredByContactName, leadReferralNotes, motivation, motivationOther,
      timeline, schedDate, schedTime,
    }
  }

  function applyDraftSnapshot(d: EvaluationDraftSnapshot) {
    setSelectedProperty(d.selectedProperty)
    setShowAddProperty(d.showAddProperty)
    setNewPropertyType(d.newPropertyType)
    setNewPropertyAddress(d.newPropertyAddress)
    setShowPropertyReview(d.showPropertyReview)
    setPropertyDraft(d.propertyDraft)
    setContacts(d.contacts)
    setStatus(d.status)
    setPropertyStatus(d.propertyStatus)
    setReasonLost(d.reasonLost)
    setReasonLostOther(d.reasonLostOther)
    setAgentId(d.agentId)
    setTcId(d.tcId)
    setLeadGeneratedBy(d.leadGeneratedBy)
    setLeadSource(d.leadSource)
    setLeadSourceOther(d.leadSourceOther)
    setReferralType(d.referralType)
    setReferralTypeOther(d.referralTypeOther)
    setReferredByContactId(d.referredByContactId)
    setReferredByContactName(d.referredByContactName)
    setLeadReferralNotes(d.leadReferralNotes)
    setMotivation(d.motivation)
    setMotivationOther(d.motivationOther)
    setTimeline(d.timeline)
    setSchedDate(d.schedDate)
    setSchedTime(d.schedTime)
  }

  // ── Navigate to Add New Contact, saving current progress first so it can
  // be restored when we come back with the newly created contact.
  function goToAddContact(kind: 'contact' | 'referred_by') {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(buildDraftSnapshot()))
    router.push(`/dashboard/contacts/new?returnTo=${encodeURIComponent('/dashboard/evaluations/new')}&for=${kind}`)
  }

  // ── Restore progress + apply the newly created contact after returning
  // from the Add New Contact page.
  useEffect(() => {
    const newContactId = searchParams.get('newContactId')
    const newContactName = searchParams.get('newContactName')
    if (!newContactId || !newContactName) return

    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (raw) {
      try { applyDraftSnapshot(JSON.parse(raw)) } catch { /* ignore corrupt snapshot */ }
      sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    }

    if (searchParams.get('for') === 'referred_by') {
      setReferredByContactId(newContactId)
      setReferredByContactName(newContactName)
    } else {
      setContacts(prev => [...prev, { contact_id: newContactId, contact_name: newContactName, tag_option_id: '' }])
    }

    router.replace('/dashboard/evaluations/new')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Check for existing properties matching the typed address, so agents
  // don't accidentally create a duplicate property record.
  useEffect(() => {
    if (!newPropertyAddress.trim()) { setAddressMatches([]); return }
    const timer = setTimeout(async () => {
      setCheckingMatches(true)
      const query = applyAddressSearch(
        supabase.from('properties').select('id, property_type, street_number, street_name, suburb, city'),
        newPropertyAddress
      )
      const { data } = await query.limit(8)
      setAddressMatches(data ?? [])
      setCheckingMatches(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [newPropertyAddress])

  function selectExistingProperty(p: Property) {
    setSelectedProperty(p)
    resetAddPropertyForm()
  }

  // ── Add property: look up address, then review/edit fields before saving ──
  async function lookupAddress() {
    if (!newPropertyType) { setError('Please select a property type.'); return }
    if (!newPropertyAddress.trim()) { setError('Please enter an address.'); return }
    setError('')
    setLookingUpAddress(true)

    const raw = newPropertyAddress.trim()

    // Try to geocode via Google for accurate suburb/city/postal code/coordinates;
    // fall back to comma-parsing the raw text if geocoding is unavailable/fails.
    const geoRes = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: raw }),
    })

    if (geoRes.ok) {
      const geo = await geoRes.json()
      setPropertyDraft({
        ...EMPTY_DRAFT,
        street_number: geo.street_number ?? '',
        street_name:   geo.route ? capitalizeWords(geo.route) : capitalizeWords(raw),
        suburb:        geo.suburb ? capitalizeWords(geo.suburb) : '',
        city:          geo.city ? capitalizeWords(geo.city) : '',
        province:      geo.province ?? '',
        postal_code:   geo.postal_code ?? '',
        country:       geo.country ?? 'South Africa',
        latitude:      geo.latitude ?? null,
        longitude:     geo.longitude ?? null,
        google_place_id: geo.google_place_id ?? null,
        google_maps_url: geo.formatted_address
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(geo.formatted_address)}`
          : null,
      })
    } else {
      const parsed = parseAddressParts(raw)
      setPropertyDraft({
        ...EMPTY_DRAFT,
        street_name: parsed.street_name,
        suburb:      parsed.suburb ?? '',
        city:        parsed.city ?? '',
        postal_code: parsed.postal_code ?? '',
      })
    }

    setLookingUpAddress(false)
    setShowPropertyReview(true)
  }

  function updateDraft(field: keyof DraftProperty, value: string) {
    setPropertyDraft(d => ({ ...d, [field]: value }))
  }

  function resetAddPropertyForm() {
    setShowAddProperty(false)
    setShowPropertyReview(false)
    setNewPropertyType('')
    setNewPropertyAddress('')
    setAddressMatches([])
    setPropertyDraft(EMPTY_DRAFT)
  }

  async function saveProperty() {
    setSavingProperty(true)
    setError('')

    const { data, error: err } = await supabase
      .from('properties')
      .insert({
        property_type:            newPropertyType,
        unit_number:              propertyDraft.unit_number || null,
        complex_or_building_name: propertyDraft.complex_or_building_name || null,
        sectional_title_number:   newPropertyType === 'sectional_title' ? (propertyDraft.sectional_title_number || null) : null,
        street_number:            propertyDraft.street_number || null,
        street_name:              propertyDraft.street_name || null,
        suburb:                   propertyDraft.suburb || null,
        city:                     propertyDraft.city || null,
        province:                 propertyDraft.province || null,
        postal_code:              propertyDraft.postal_code || null,
        country:                  propertyDraft.country || null,
        latitude:                 propertyDraft.latitude,
        longitude:                propertyDraft.longitude,
        google_place_id:          propertyDraft.google_place_id,
        google_maps_url:          propertyDraft.google_maps_url,
        created_by_user_id:       userId,
      })
      .select('id, property_type, street_number, street_name, suburb, city')
      .single()

    setSavingProperty(false)
    if (err) { setError(err.message); return }
    setSelectedProperty(data as Property)
    resetAddPropertyForm()
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

    // Hardcoded dropdowns aren't backed by picklist_options rows, so the
    // resolved label is stored directly as text.
    const motivationNotes   = motivation === 'other'
      ? `Other: ${motivationOther}`
      : (MOTIVATIONS.find(m => m.value === motivation)?.label ?? null)
    const leadSourceLabel   = leadSource === 'other'
      ? `Other: ${leadSourceOther}`
      : (LEAD_SOURCES.find(s => s.value === leadSource)?.label ?? null)
    const referralTypeLabel = referralType === 'other'
      ? `Other: ${referralTypeOther}`
      : (REFERRAL_TYPES.find(r => r.value === referralType)?.label ?? null)
    const timelineLabel     = TIMELINES.find(t => t.value === timeline)?.label ?? null
    const reasonLostLabel   = status === 'lost'
      ? (reasonLost === 'other' ? `Other: ${reasonLostOther}` : (REASONS_LOST.find(r => r.value === reasonLost)?.label ?? null))
      : null

    const { data: ev, error: evErr } = await supabase.from('evaluations').insert({
      property_id:                      selectedProperty.id,
      captured_by_user_id:              userId,
      status,
      reason_lost:                      reasonLostLabel,
      sellers_agent_user_id:            agentId || null,
      transaction_coordinator_user_id:  tcId || null,
      property_status:                  propertyStatus || null,
      lead_generated_by:                leadGeneratedBy || null,
      lead_source_other_text:           leadSourceLabel,
      lead_referral_notes:              leadReferralNotes || null,
      referral_type:                    referralTypeLabel,
      referral_contact_id:              referredByContactId || null,
      motivation_for_selling_notes:     motivationNotes,
      selling_timeline_notes:           timelineLabel,
      scheduled_at:                     scheduledAt || null,
    }).select('id').single()

    if (evErr || !ev) { setError(evErr?.message ?? 'Failed to save.'); setSaving(false); return }

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

  return (
    <div className="bg-[#f8f7f4] min-h-screen">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-[#1a1a1a] mb-8">New Evaluation</h1>
        <form onSubmit={handleSubmit} className="space-y-6">

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
          </Section>

          {/* ── Deal Details ── */}
          <Section title="Property Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className={labelCls}>Date &amp; Time Captured</span>
                <p className="text-sm text-[#1a1a1a] py-2.5">
                  {new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                </p>
              </div>
              <div>
                <span className={labelCls}>Captured By</span>
                <p className="text-sm text-[#1a1a1a] py-2.5">
                  {profiles.find(p => p.id === userId)?.full_name
                    ?? profiles.find(p => p.id === userId)?.email
                    ?? '—'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Evaluation Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className={select}>
                  <option value="new">New</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="presented">Presented</option>
                  <option value="follow_up">Follow-Up</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                  <option value="on_hold">On Hold</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Property Status</label>
                <select value={propertyStatus} onChange={e => setPropertyStatus(e.target.value)} className={select}>
                  <option value="">—</option>
                  <option value="off_market">Off Market</option>
                  <option value="on_market">On Market</option>
                </select>
              </div>
            </div>

            {status === 'lost' && (
              <div>
                <label className={labelCls}>Reason Lost</label>
                <select value={reasonLost} onChange={e => setReasonLost(e.target.value)} className={select}>
                  <option value="">—</option>
                  {REASONS_LOST.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {reasonLost === 'other' && (
                  <input value={reasonLostOther} onChange={e => setReasonLostOther(e.target.value)}
                    placeholder="Describe the reason" className={`${input} mt-2`} />
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Agent</label>
                <select value={agentId} onChange={e => setAgentId(e.target.value)} className={select}>
                  <option value="">—</option>
                  {profiles.filter(p => p.role === 'agent').map(p => (
                    <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Transaction Coordinator</label>
                <select value={tcId} onChange={e => setTcId(e.target.value)} className={select}>
                  <option value="">—</option>
                  {profiles.filter(p => p.role === 'transaction_coordinator').map(p => (
                    <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
                  ))}
                </select>
              </div>
            </div>
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
            <p className="text-xs text-gray-400 text-center mt-3">— or —</p>
            <button type="button" onClick={() => goToAddContact('contact')}
              className={`${btn.primary} w-full mt-3`}>
              + Add New Contact
            </button>
          </Section>

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
            ) : showAddProperty && showPropertyReview ? (
              <div className="space-y-4 border border-gray-200 rounded-xl p-4 bg-gray-50">
                {newPropertyType === 'sectional_title' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Unit Number</label>
                        <input value={propertyDraft.unit_number} onChange={e => updateDraft('unit_number', e.target.value)} className={input} />
                      </div>
                      <div>
                        <label className={labelCls}>Complex Name</label>
                        <input value={propertyDraft.complex_or_building_name} onChange={e => updateDraft('complex_or_building_name', e.target.value)} className={input} />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Sectional Title Number</label>
                      <input value={propertyDraft.sectional_title_number} onChange={e => updateDraft('sectional_title_number', e.target.value)} className={input} />
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Street Number</label>
                    <input value={propertyDraft.street_number} onChange={e => updateDraft('street_number', e.target.value)} className={input} />
                  </div>
                  <div>
                    <label className={labelCls}>Street Name</label>
                    <input value={propertyDraft.street_name} onChange={e => updateDraft('street_name', e.target.value)} className={input} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Suburb</label>
                    <input value={propertyDraft.suburb} onChange={e => updateDraft('suburb', e.target.value)} className={input} />
                  </div>
                  <div>
                    <label className={labelCls}>City</label>
                    <input value={propertyDraft.city} onChange={e => updateDraft('city', e.target.value)} className={input} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Province</label>
                    <input value={propertyDraft.province} onChange={e => updateDraft('province', e.target.value)} className={input} />
                  </div>
                  <div>
                    <label className={labelCls}>Postal Code</label>
                    <input value={propertyDraft.postal_code} onChange={e => updateDraft('postal_code', e.target.value)} className={input} />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Country</label>
                  <input value={propertyDraft.country} onChange={e => updateDraft('country', e.target.value)} className={input} />
                </div>

                {propertyDraft.latitude != null && propertyDraft.longitude != null && (
                  <div>
                    <span className={labelCls}>Co-ordinates</span>
                    <p className="text-sm text-[#1a1a1a]">{propertyDraft.latitude}, {propertyDraft.longitude}</p>
                  </div>
                )}

                <div>
                  <iframe
                    src={`https://www.google.com/maps?q=${encodeURIComponent(draftMapQuery(propertyDraft))}&output=embed`}
                    width="100%"
                    height="220"
                    style={{ border: 0, borderRadius: 12 }}
                    loading="lazy"
                    title="Property location map"
                  />
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(draftMapQuery(propertyDraft))}`}
                    target="_blank" rel="noopener noreferrer"
                    className={`${btn.secondary} w-full mt-2 block text-center`}
                  >
                    Get Directions
                  </a>
                </div>

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setShowPropertyReview(false)}
                    className={`${btn.secondary} flex-1`}>Back</button>
                  <button type="button" onClick={saveProperty} disabled={savingProperty} className={`${btn.primary} flex-1`}>
                    {savingProperty ? 'Saving…' : 'Save Property'}
                  </button>
                </div>
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
                </div>

                {checkingMatches && (
                  <p className="text-xs text-gray-400">Checking for existing properties…</p>
                )}
                {!checkingMatches && addressMatches.length > 0 && (
                  <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
                    <p className="text-xs font-medium text-amber-700">
                      This address may already exist — select it instead of creating a duplicate:
                    </p>
                    {addressMatches.map(p => (
                      <button key={p.id} type="button" onClick={() => selectExistingProperty(p)}
                        className="w-full text-left px-3 py-2 rounded-md bg-white border border-amber-200 hover:border-amber-400 text-sm text-[#1a1a1a] transition-colors">
                        <span className="font-medium">{displayAddress(p)}</span>
                        {p.suburb && <span className="ml-2 text-xs text-gray-400">{p.suburb}</span>}
                        {p.property_type && (
                          <span className="ml-2 text-xs text-gray-400 capitalize">{p.property_type.replace('_', ' ')}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={resetAddPropertyForm}
                    className={`${btn.secondary} flex-1`}>Cancel</button>
                  <button type="button" onClick={lookupAddress} disabled={lookingUpAddress} className={`${btn.primary} flex-1`}>
                    {lookingUpAddress ? 'Looking up address…' : 'Look Up Address'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <PropertySearch onSelect={setSelectedProperty} />
                <p className="text-xs text-gray-400 text-center">— or —</p>
                <button type="button" onClick={() => setShowAddProperty(true)} className={`${btn.primary} w-full`}>
                  + Add New Property
                </button>
              </div>
            )}
          </Section>

          {/* ── Lead Information ── */}
          <Section title="Lead Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Lead Generated By</label>
                <select value={leadGeneratedBy} onChange={e => setLeadGeneratedBy(e.target.value)} className={select}>
                  <option value="">—</option>
                  <option value="seller_agent_partner">Agent</option>
                  <option value="shelley_residential">Shelley Residential</option>
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

            {leadSource === 'referral' && (
              <>
                <div>
                  <label className={labelCls}>Referral Type</label>
                  <select value={referralType} onChange={e => setReferralType(e.target.value)} className={select}>
                    <option value="">—</option>
                    {REFERRAL_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>

                {referralType === 'other' && (
                  <div>
                    <label className={labelCls}>Other — please specify</label>
                    <input value={referralTypeOther} onChange={e => setReferralTypeOther(e.target.value)}
                      placeholder="Describe the referral type" className={input} />
                  </div>
                )}

                <div>
                  <label className={labelCls}>Referred By</label>
                  {referredByContactId ? (
                    <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-lg border border-gray-200">
                      <span className="text-sm text-[#1a1a1a]">{referredByContactName}</span>
                      <button type="button" onClick={() => { setReferredByContactId(''); setReferredByContactName('') }}
                        className="text-gray-400 hover:text-[#1a1a1a] text-lg leading-none transition-colors">×</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <ContactSearch
                        placeholder="Search contacts…"
                        onSelect={(id, name) => { setReferredByContactId(id); setReferredByContactName(name) }}
                        excludeIds={[]}
                      />
                      <button type="button" onClick={() => goToAddContact('referred_by')}
                        className={`${btn.primary} w-full`}>
                        + Add New Contact
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {(leadSource === 'referral' || leadSource === 'other') && (
              <div>
                <label className={labelCls}>Lead / Referral Notes</label>
                <textarea value={leadReferralNotes} onChange={e => setLeadReferralNotes(e.target.value)}
                  placeholder="Any notes about the lead or referral…"
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

export default function NewEvaluationPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f8f7f4]" />}>
      <NewEvaluationForm />
    </Suspense>
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
      const q = applyAddressSearch(
        supabase.from('properties').select('id, property_type, street_number, street_name, suburb, city'),
        query
      )
      const { data } = await q.limit(8)
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
        placeholder="Search Property…"
        className={input} />
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 border-t-0 rounded-b-lg shadow-md max-h-60 overflow-y-auto">
          {loading && <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>}
          {!loading && results.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No properties found</div>}
          {!loading && results.map(p => (
            <button key={p.id} type="button"
              onMouseDown={() => { onSelect(p); setQuery(''); setOpen(false) }}
              className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a1a] hover:bg-[#f8f7f4] border-b border-gray-100 last:border-b-0 transition-colors">
              <span className="font-medium">{displayAddress(p)}</span>
              {p.suburb && <span className="ml-2 text-xs text-gray-400">{p.suburb}</span>}
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
  const [results, setResults] = useState<{ id: string; first_name: string; last_name: string }[]>([])
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
        .select('id, first_name, last_name')
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
            const name = `${r.first_name} ${r.last_name}`.trim()
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
