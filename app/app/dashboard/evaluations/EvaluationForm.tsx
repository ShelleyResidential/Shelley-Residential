'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { WarningIcon } from '@/lib/icons'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LEAD_SOURCES, REFERRAL_TYPES, MOTIVATIONS, TIMELINES, REASONS_LOST, CONTACT_TAGS } from '@/lib/evaluationOptions'

const DRAFT_STORAGE_KEY = 'evaluationFormDraft'

const STATUS_DISPLAY: Record<string, string> = {
  new: 'New', scheduled: 'Scheduled', completed: 'Completed', presented: 'Presented',
  follow_up: 'Follow-Up', won: 'Won', lost: 'Lost', cancelled: 'Cancelled',
  in_progress: 'In Progress (legacy)', open: 'Open Mandate (legacy)', future: 'Future Mandate (legacy)',
}

function formatZAR(value: string): string {
  const n = Number(value)
  if (!value || Number.isNaN(n)) return value
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)
}

// ── Field: same label-above-content layout either way — plain text (no
// box) in read-only mode, the actual editable control once Edit is clicked.
function Field({ label, readOnly, value, children }: { label: string; readOnly: boolean; value?: React.ReactNode; children: React.ReactNode }) {
  if (readOnly) {
    return (
      <div>
        <span className={labelCls}>{label}</span>
        <p className="text-sm text-[#1a1a1a] py-2.5">{value ?? '—'}</p>
      </div>
    )
  }
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────
type Property = {
  id: string
  property_type: string | null
  unit_number: string | null
  complex_or_building_name: string | null
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
  phone_number: string | null
  email_address: string | null
}

type Profile = { id: string; full_name: string | null; email: string | null; role: string | null }

// ── Address helper ────────────────────────────────────────────
function displayAddress(p: Property): string {
  const street = [p.street_number, p.street_name].filter(Boolean).join(' ')
  if (p.property_type === 'sectional_title' && p.unit_number) {
    const unit = [`Unit ${p.unit_number}`, p.complex_or_building_name ? capitalizeWords(p.complex_or_building_name) : null].filter(Boolean).join(' ')
    return [unit, street, p.suburb].filter(Boolean).join(', ')
  }
  return [street, p.suburb].filter(Boolean).join(', ') || p.city || ''
}

// View Maps should always navigate to the actual street address, never the
// unit/complex name — a complex name alone doesn't reliably geocode.
function propertyMapQuery(p: Property): string {
  return [p.street_number, p.street_name, p.suburb, p.city].filter(Boolean).join(' ')
}

// Common street-type abbreviations Google's autocomplete/geocoder may hand
// back (e.g. "Rd") that won't ILIKE-match the full word we store (e.g.
// "Road", via capitalizeWords(geo.route)) -- expand them before matching.
const STREET_TYPE_EXPANSIONS: Record<string, string> = {
  rd: 'road', st: 'street', ave: 'avenue', dr: 'drive', cr: 'crescent', cres: 'crescent',
  blvd: 'boulevard', ln: 'lane', pl: 'place', cl: 'close', ct: 'court', hwy: 'highway',
  sq: 'square', ter: 'terrace', pk: 'park', gr: 'grove',
}

// A full Google-style address ends in a country name our schema doesn't
// index for this search (street_number/street_name/suburb/city only) --
// strip it so it can't zero out the match below.
const COUNTRY_SUFFIX = /,?\s*south africa\s*$/i

// Search across street number/name, suburb and city. Works equally for a
// bare fragment ("26") or a full address pasted/selected from Google's
// autocomplete ("26 Audley Rd, Grayleigh, Westville, South Africa").
//
// Two strategies, depending on whether the query has a house number:
// - With one: anchor on an EXACT street_number match (the one field two
//   different addresses on the same street never share), then require just
//   ONE more word to appear anywhere in street_name/suburb/city. That "one
//   of" is deliberately loose -- Google's autocomplete predictions and its
//   geocoder (used when the existing property was first saved) don't always
//   split suburb vs. city the same way for the same real address, so
//   requiring every trailing word to match would silently miss real
//   duplicates again.
// - Without one (e.g. searching by suburb alone): fall back to requiring
//   every word to match somewhere, so a single short/common word doesn't
//   match half the database.
function applyAddressSearch<T extends { or(filters: string): T }>(query: T, raw: string): T {
  const cleaned = raw.trim().replace(COUNTRY_SUFFIX, '')
  const words = cleaned.split(/[\s,]+/).filter(Boolean).map(w => w.replace(/[%_]/g, ''))
  if (words.length === 0) return query

  const [first, ...rest] = words
  const hasHouseNumber = /^\d+[a-zA-Z]?$/.test(first)

  if (hasHouseNumber && rest.length > 0) {
    const terms = rest.map(w => STREET_TYPE_EXPANSIONS[w.toLowerCase()] ?? w)
    const orClause = terms.flatMap(t => [`street_name.ilike.%${t}%`, `suburb.ilike.%${t}%`, `city.ilike.%${t}%`]).join(',')
    // Cast around Supabase's query-builder generics here -- constraining T
    // to include .eq() as well as .or() blows up TS's type instantiation
    // depth (TS2589) on the real PostgrestFilterBuilder type.
    const withNumber = (query as unknown as { eq(column: string, value: string): T }).eq('street_number', first)
    return withNumber.or(orClause)
  }

  return words.reduce((q, word) => {
    const term = STREET_TYPE_EXPANSIONS[word.toLowerCase()] ?? word
    return q.or(`street_number.ilike.%${term}%,street_name.ilike.%${term}%,suburb.ilike.%${term}%,city.ilike.%${term}%`)
  }, query)
}

// Hardcoded dropdown values resolve to a stored LABEL, not the slug — an
// "other" pick is stored as "Other: <text>". This reverses that so an
// existing record's stored text can re-select the right dropdown option.
function reverseResolve(options: { value: string; label: string }[], stored: string | null): { slug: string; other: string } {
  if (!stored) return { slug: '', other: '' }
  if (stored.startsWith('Other: ')) return { slug: 'other', other: stored.slice(7) }
  const match = options.find(o => o.label === stored)
  if (match) return { slug: match.value, other: '' }
  return { slug: 'other', other: stored }
}

// Snapshot of everything the agent may have already filled in, saved to
// sessionStorage before navigating away to add a new contact, and restored
// on return so progress on the form is never lost.
type EvaluationDraftSnapshot = {
  selectedProperty: Property | null
  newPropertyType: string
  newPropertyAddress: string
  showPropertyReview: boolean
  propertyDraft: DraftProperty
  contacts: ContactSlot[]
  status: string
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
  evaluationPrice: string
  marketingPrice: string
}

type RawEvaluationRow = {
  id: string
  status: string
  reason_lost: string | null
  lead_generated_by: string | null
  lead_source_other_text: string | null
  lead_referral_notes: string | null
  referral_type: string | null
  referral_contact_id: string | null
  referral_contact: { id: string; first_name: string; last_name: string } | { id: string; first_name: string; last_name: string }[] | null
  motivation_for_selling_notes: string | null
  selling_timeline_notes: string | null
  scheduled_at: string | null
  sellers_agent_user_id: string | null
  transaction_coordinator_user_id: string | null
  evaluation_price: number | null
  marketing_price: number | null
  date_captured: string
  captured_by_user_id: string | null
  properties: Property | null
  evaluation_contacts: {
    contact_id: string
    is_primary: boolean
    sort_order: number
    contacts: { id: string; first_name: string; last_name: string; phone_number: string | null; email_address: string | null } | null
    picklist_options: { label: string } | null
  }[]
}

export function EvaluationForm({ evaluationId, readOnly = false, calendarEventLink, onSaved, onCancel }: {
  evaluationId?: string
  readOnly?: boolean
  calendarEventLink?: string | null
  onSaved?: () => void
  onCancel?: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const addressSuggestionsRef = useRef<HTMLDivElement>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])

  const [initialLoading, setInitialLoading] = useState(!!evaluationId)
  const [fetchedRow, setFetchedRow] = useState<RawEvaluationRow | null>(null)
  const [dateCaptured, setDateCaptured] = useState<string | null>(null)
  const [capturedByUserId, setCapturedByUserId] = useState<string | null>(null)

  // Property
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [newPropertyType, setNewPropertyType]   = useState('')
  const [newPropertyAddress, setNewPropertyAddress] = useState('')
  const [addressMatches, setAddressMatches]     = useState<Property[]>([])
  const [checkingMatches, setCheckingMatches]   = useState(false)
  const [addressSuggestions, setAddressSuggestions] = useState<{ place_id: string; description: string }[]>([])
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false)
  const [lookingUpAddress, setLookingUpAddress] = useState(false)
  const [showPropertyReview, setShowPropertyReview] = useState(false)
  const [propertyDraft, setPropertyDraft]       = useState<DraftProperty>(EMPTY_DRAFT)
  const [savingProperty, setSavingProperty]     = useState(false)

  // Contacts
  const [contacts, setContacts] = useState<ContactSlot[]>([])

  // Deal details
  const [status, setStatus]               = useState('new')
  const [reasonLost, setReasonLost]         = useState('')
  const [reasonLostOther, setReasonLostOther] = useState('')
  const [agentId, setAgentId]             = useState('')
  const [tcId, setTcId]                   = useState('')
  const [evaluationPrice, setEvaluationPrice] = useState('')
  const [marketingPrice, setMarketingPrice]   = useState('')

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

  const returnPath = evaluationId ? `/dashboard/evaluations/${evaluationId}` : '/dashboard/evaluations/new'

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null)
    })
    supabase.from('profiles').select('id, full_name, email, role').then(({ data }) => {
      const rows = (data ?? []) as Profile[]
      rows.sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''))
      setProfiles(rows)
    })
  }, [])

  const populateFromRow = useCallback((row: RawEvaluationRow) => {
    const referralContact = Array.isArray(row.referral_contact) ? row.referral_contact[0] : row.referral_contact

    setSelectedProperty(row.properties)
    setDateCaptured(row.date_captured)
    setCapturedByUserId(row.captured_by_user_id)
    setStatus(row.status)

    const reasonResolved = reverseResolve(REASONS_LOST, row.reason_lost)
    setReasonLost(reasonResolved.slug)
    setReasonLostOther(reasonResolved.other)

    setAgentId(row.sellers_agent_user_id ?? '')
    setTcId(row.transaction_coordinator_user_id ?? '')
    setEvaluationPrice(row.evaluation_price != null ? String(row.evaluation_price) : '')
    setMarketingPrice(row.marketing_price != null ? String(row.marketing_price) : '')

    setLeadGeneratedBy(row.lead_generated_by ?? '')
    const leadResolved = reverseResolve(LEAD_SOURCES, row.lead_source_other_text)
    setLeadSource(leadResolved.slug)
    setLeadSourceOther(leadResolved.other)

    const referralResolved = reverseResolve(REFERRAL_TYPES, row.referral_type)
    setReferralType(referralResolved.slug)
    setReferralTypeOther(referralResolved.other)
    setReferredByContactId(row.referral_contact_id ?? '')
    setReferredByContactName(referralContact ? `${referralContact.first_name} ${referralContact.last_name}`.trim() : '')
    setLeadReferralNotes(row.lead_referral_notes ?? '')

    const motivationResolved = reverseResolve(MOTIVATIONS, row.motivation_for_selling_notes)
    setMotivation(motivationResolved.slug)
    setMotivationOther(motivationResolved.other)

    setTimeline(TIMELINES.find(t => t.label === row.selling_timeline_notes)?.value ?? '')

    const schedIso = row.scheduled_at ? row.scheduled_at.slice(0, 16) : ''
    setSchedDate(schedIso ? schedIso.slice(0, 10) : '')
    setSchedTime(schedIso ? schedIso.slice(11, 16) : '')

    const sortedContacts = [...(row.evaluation_contacts ?? [])].sort((a, b) => a.sort_order - b.sort_order)
    setContacts(sortedContacts.filter(ec => ec.contacts).map(ec => ({
      contact_id: ec.contact_id,
      contact_name: [ec.contacts!.first_name, ec.contacts!.last_name].filter(Boolean).join(' '),
      tag_option_id: ec.picklist_options?.label ?? '',
      phone_number: ec.contacts!.phone_number ?? null,
      email_address: ec.contacts!.email_address ?? null,
    })))
  }, [])

  const fetchEvaluation = useCallback(async () => {
    if (!evaluationId) return
    const { data } = await supabase
      .from('evaluations')
      .select(`
        id, status, reason_lost, lead_generated_by, lead_source_other_text, lead_referral_notes,
        referral_type, referral_contact_id, referral_contact:referral_contact_id (id, first_name, last_name),
        motivation_for_selling_notes, selling_timeline_notes, scheduled_at,
        sellers_agent_user_id, transaction_coordinator_user_id, evaluation_price, marketing_price,
        date_captured, captured_by_user_id,
        properties (id, property_type, unit_number, complex_or_building_name, street_number, street_name, suburb, city),
        evaluation_contacts (
          contact_id, is_primary, sort_order,
          contacts (id, first_name, last_name, phone_number, email_address),
          picklist_options:tag_option_id (label)
        )
      `)
      .eq('id', evaluationId)
      .single()

    if (data) {
      const row = data as unknown as RawEvaluationRow
      setFetchedRow(row)
      populateFromRow(row)
    }
    setInitialLoading(false)
  }, [evaluationId, populateFromRow])

  // Skip the DB fetch when returning from the Add New Contact page — the
  // sessionStorage draft already holds a fresher, in-progress snapshot.
  useEffect(() => {
    if (evaluationId && !searchParams.get('newContactId') && searchParams.get('resume') !== '1') {
      fetchEvaluation()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluationId])

  function buildDraftSnapshot(): EvaluationDraftSnapshot {
    return {
      selectedProperty, newPropertyType, newPropertyAddress,
      showPropertyReview, propertyDraft, contacts, status,
      reasonLost, reasonLostOther, agentId, tcId, leadGeneratedBy, leadSource,
      leadSourceOther, referralType, referralTypeOther, referredByContactId,
      referredByContactName, leadReferralNotes, motivation, motivationOther,
      timeline, schedDate, schedTime, evaluationPrice, marketingPrice,
    }
  }

  function applyDraftSnapshot(d: EvaluationDraftSnapshot) {
    setSelectedProperty(d.selectedProperty)
    setNewPropertyType(d.newPropertyType)
    setNewPropertyAddress(d.newPropertyAddress)
    setShowPropertyReview(d.showPropertyReview)
    setPropertyDraft(d.propertyDraft)
    setContacts(d.contacts)
    setStatus(d.status)
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
    setEvaluationPrice(d.evaluationPrice)
    setMarketingPrice(d.marketingPrice)
  }

  // ── Navigate to Add New Contact, saving current progress first so it can
  // be restored when we come back with the newly created contact.
  function goToAddContact(kind: 'contact' | 'referred_by') {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(buildDraftSnapshot()))
    router.push(`/dashboard/contacts/new?returnTo=${encodeURIComponent(returnPath)}&for=${kind}`)
  }

  // ── Restore progress after returning from the Add New Contact page —
  // either with a newly created contact to apply, or (via the "Back to
  // Evaluation" breadcrumb) with nothing, if the agent bailed out without
  // creating one.
  useEffect(() => {
    const newContactId = searchParams.get('newContactId')
    const newContactName = searchParams.get('newContactName')
    const resuming = searchParams.get('resume') === '1'
    if (!newContactId && !resuming) return

    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (raw) {
      try { applyDraftSnapshot(JSON.parse(raw)) } catch { /* ignore corrupt snapshot */ }
      sessionStorage.removeItem(DRAFT_STORAGE_KEY)
    }
    setInitialLoading(false)

    if (newContactId && newContactName) {
      if (searchParams.get('for') === 'referred_by') {
        setReferredByContactId(newContactId)
        setReferredByContactName(newContactName)
      } else {
        setContacts(prev => [...prev, {
          contact_id: newContactId, contact_name: newContactName, tag_option_id: '',
          phone_number: searchParams.get('phone') || null, email_address: searchParams.get('email') || null,
        }])
      }
    }

    router.replace(returnPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Check for existing properties matching the typed address, so agents
  // don't accidentally create a duplicate property record.
  useEffect(() => {
    if (!newPropertyAddress.trim()) { setAddressMatches([]); return }
    const timer = setTimeout(async () => {
      setCheckingMatches(true)
      const query = applyAddressSearch(
        supabase.from('properties').select('id, property_type, unit_number, complex_or_building_name, street_number, street_name, suburb, city'),
        newPropertyAddress
      )
      const { data } = await query.limit(8)
      setAddressMatches(data ?? [])
      setCheckingMatches(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [newPropertyAddress])

  // ── Google Maps address suggestions, so agents can search for the
  // property instead of typing the full address from scratch.
  useEffect(() => {
    if (!newPropertyAddress.trim()) { setAddressSuggestions([]); setShowAddressSuggestions(false); return }
    const timer = setTimeout(async () => {
      const res = await fetch('/api/places-autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: newPropertyAddress }),
      })
      const json = await res.json()
      setAddressSuggestions(json.predictions ?? [])
      setShowAddressSuggestions(true)
    }, 300)
    return () => clearTimeout(timer)
  }, [newPropertyAddress])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (addressSuggestionsRef.current && !addressSuggestionsRef.current.contains(e.target as Node)) {
        setShowAddressSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectAddressSuggestion(description: string) {
    setNewPropertyAddress(description)
    setShowAddressSuggestions(false)
  }

  function selectExistingProperty(p: Property) {
    setSelectedProperty(p)
    resetAddPropertyForm()
  }

  // ── Add property: look up address, then review/edit fields before saving.
  // Duplicate prevention is two-layered: (1) refuse to proceed at all while
  // the live fuzzy address match above is showing a possible existing
  // property, forcing an explicit pick instead, and (2) after geocoding,
  // check for an exact Google Place ID match -- the authoritative signal
  // that this is a place we already have on file -- and if found, silently
  // switch to that record instead of ever offering to create a new one.
  async function lookupAddress() {
    if (!newPropertyType) { setError('Please select a property type.'); return }
    if (!newPropertyAddress.trim()) { setError('Please enter an address.'); return }
    if (addressMatches.length > 0) {
      setError('This address matches an existing property — select it above instead of adding a new one.')
      return
    }
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

      // Authoritative duplicate check: the exact same Google Place already
      // has a property record, so use it instead of creating a second one.
      if (geo.google_place_id) {
        const { data: existing } = await supabase
          .from('properties')
          .select('id, property_type, unit_number, complex_or_building_name, street_number, street_name, suburb, city')
          .eq('google_place_id', geo.google_place_id)
          .maybeSingle()
        if (existing) {
          selectExistingProperty(existing as Property)
          setLookingUpAddress(false)
          return
        }
      }

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
    setShowPropertyReview(false)
    setNewPropertyType('')
    setNewPropertyAddress('')
    setAddressMatches([])
    setPropertyDraft(EMPTY_DRAFT)
  }

  async function saveProperty() {
    setSavingProperty(true)
    setError('')

    // Final guard against a race between two agents adding the same address
    // at once -- never insert a second row for a Place we already have.
    if (propertyDraft.google_place_id) {
      const { data: existing } = await supabase
        .from('properties')
        .select('id, property_type, unit_number, complex_or_building_name, street_number, street_name, suburb, city')
        .eq('google_place_id', propertyDraft.google_place_id)
        .maybeSingle()
      if (existing) {
        selectExistingProperty(existing as Property)
        setSavingProperty(false)
        return
      }
    }

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
      .select('id, property_type, unit_number, complex_or_building_name, street_number, street_name, suburb, city')
      .single()

    setSavingProperty(false)
    if (err) { setError(err.message); return }
    setSelectedProperty(data as Property)
    resetAddPropertyForm()
  }

  // ── Contacts ─────────────────────────────────────────────
  function addContact(contact_id: string, contact_name: string, phone_number: string | null, email_address: string | null) {
    setContacts(prev => [...prev, { contact_id, contact_name, tag_option_id: '', phone_number, email_address }])
  }

  function removeContact(idx: number) {
    setContacts(prev => prev.filter((_, i) => i !== idx))
  }

  function setContactTag(idx: number, tag: string) {
    setContacts(prev => prev.map((c, i) => i === idx ? { ...c, tag_option_id: tag } : c))
  }

  function handleCancel() {
    if (evaluationId) {
      if (fetchedRow) populateFromRow(fetchedRow)
      setError('')
      onCancel?.()
    } else {
      router.push('/dashboard/evaluations')
    }
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
    const payload = {
      property_id:                      selectedProperty.id,
      status,
      reason_lost:                      reasonLostLabel,
      sellers_agent_user_id:            agentId || null,
      transaction_coordinator_user_id:  tcId || null,
      lead_generated_by:                leadGeneratedBy || null,
      lead_source_other_text:           leadSourceLabel,
      lead_referral_notes:              leadReferralNotes || null,
      referral_type:                    referralTypeLabel,
      referral_contact_id:              referredByContactId || null,
      motivation_for_selling_notes:     motivationNotes,
      selling_timeline_notes:           timelineLabel,
      scheduled_at:                     scheduledAt || null,
      evaluation_price:                 evaluationPrice ? Number(evaluationPrice) : null,
      marketing_price:                  marketingPrice ? Number(marketingPrice) : null,
    }

    const { data: tagOptions } = await supabase.from('picklist_options').select('id, label').eq('list_name', 'contact_tag')
    const resolveTagId = (label: string) => tagOptions?.find(t => t.label === label)?.id ?? null

    if (evaluationId) {
      const { error: evErr } = await supabase.from('evaluations').update(payload).eq('id', evaluationId)
      if (evErr) { setError(evErr.message); setSaving(false); return }

      await supabase.from('evaluation_contacts').delete().eq('evaluation_id', evaluationId)
      await supabase.from('evaluation_contacts').insert(
        contacts.map((c, i) => ({
          evaluation_id: evaluationId,
          contact_id: c.contact_id,
          is_primary: i === 0,
          sort_order: i,
          tag_option_id: c.tag_option_id ? resolveTagId(c.tag_option_id) : null,
        }))
      )

      // An Evaluation Date and Time captured on save automatically creates/
      // updates the Google Calendar event; the evaluation only advances to
      // "Scheduled" once that event is actually sent (handled server-side).
      if (scheduledAt) {
        await fetch('/api/calendar/sync', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ evaluationId, userId }),
        })
      }

      setSaving(false)
      await fetchEvaluation()
      onSaved?.()
      return
    }

    const { data: ev, error: evErr } = await supabase.from('evaluations').insert({
      ...payload,
      captured_by_user_id: userId,
    }).select('id').single()

    if (evErr || !ev) { setError(evErr?.message ?? 'Failed to save.'); setSaving(false); return }

    await supabase.from('evaluation_contacts').insert(
      contacts.map((c, i) => ({
        evaluation_id: ev.id,
        contact_id: c.contact_id,
        is_primary: i === 0,
        sort_order: i,
        tag_option_id: c.tag_option_id ? resolveTagId(c.tag_option_id) : null,
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

    // An Evaluation Date and Time captured on save automatically creates the
    // Google Calendar event; the evaluation only advances to "Scheduled"
    // once that event is actually sent (handled server-side).
    if (scheduledAt) {
      await fetch('/api/calendar/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ evaluationId: ev.id, userId }),
      })
    }

    router.push(`/dashboard/evaluations/${ev.id}`)
  }

  const capturedDateDisplay = evaluationId
    ? (dateCaptured ? new Date(dateCaptured).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
    : new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
  const capturedByProfile = evaluationId
    ? profiles.find(p => p.id === capturedByUserId)
    : profiles.find(p => p.id === userId)

  if (initialLoading) {
    return <div className="p-10 text-gray-400 text-sm">Loading…</div>
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Motivation & Timeline ── */}
      <Section title="Motivation & Timeline">
        <Field label="Motivation for Selling" readOnly={readOnly}
          value={motivation === 'other' ? (motivationOther || 'Other') : MOTIVATIONS.find(m => m.value === motivation)?.label}>
          <select value={motivation} onChange={e => setMotivation(e.target.value)} className={select}>
            <option value="">—</option>
            {MOTIVATIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Field>

        {!readOnly && motivation === 'other' && (
          <div>
            <label className={labelCls}>Please specify reason</label>
            <textarea value={motivationOther} onChange={e => setMotivationOther(e.target.value)}
              placeholder="Describe the seller's motivation…"
              rows={3} className={`${input} resize-none`} />
          </div>
        )}

        <Field label="Selling Timeline" readOnly={readOnly} value={TIMELINES.find(t => t.value === timeline)?.label}>
          <select value={timeline} onChange={e => setTimeline(e.target.value)} className={select}>
            <option value="">—</option>
            {TIMELINES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
      </Section>

      {/* ── Lead Details ── */}
      <Section title="Lead Details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Lead Generated By" readOnly={readOnly}
            value={leadGeneratedBy === 'seller_agent_partner' ? 'Agent' : leadGeneratedBy === 'shelley_residential' ? 'Shelley Residential' : undefined}>
            <select value={leadGeneratedBy} onChange={e => setLeadGeneratedBy(e.target.value)} className={select}>
              <option value="">—</option>
              <option value="seller_agent_partner">Agent</option>
              <option value="shelley_residential">Shelley Residential</option>
            </select>
          </Field>
          <Field label="Lead Source" readOnly={readOnly}
            value={leadSource === 'other' ? (leadSourceOther || 'Other') : LEAD_SOURCES.find(s => s.value === leadSource)?.label}>
            <select value={leadSource} onChange={e => setLeadSource(e.target.value)} className={select}>
              <option value="">—</option>
              {LEAD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        </div>

        {!readOnly && leadSource === 'other' && (
          <div>
            <label className={labelCls}>Other — please specify</label>
            <input value={leadSourceOther} onChange={e => setLeadSourceOther(e.target.value)}
              placeholder="Describe the lead source" className={input} />
          </div>
        )}

        {leadSource === 'referral' && (
          <>
            <Field label="Referral Type" readOnly={readOnly}
              value={referralType === 'other' ? (referralTypeOther || 'Other') : REFERRAL_TYPES.find(r => r.value === referralType)?.label}>
              <select value={referralType} onChange={e => setReferralType(e.target.value)} className={select}>
                <option value="">—</option>
                {REFERRAL_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>

            {!readOnly && referralType === 'other' && (
              <div>
                <label className={labelCls}>Other — please specify</label>
                <input value={referralTypeOther} onChange={e => setReferralTypeOther(e.target.value)}
                  placeholder="Describe the referral type" className={input} />
              </div>
            )}

            <Field label="Referred By" readOnly={readOnly} value={referredByContactName || undefined}>
              {referredByContactId ? (
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-sm text-[#1a1a1a]">{referredByContactName}</span>
                  <button type="button" onClick={() => { setReferredByContactId(''); setReferredByContactName('') }}
                    className="text-gray-400 hover:text-[#1a1a1a] text-lg leading-none transition-colors cursor-pointer">×</button>
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
            </Field>
          </>
        )}

        {(leadSource === 'referral' || leadSource === 'other') && (
          <Field label="Lead / Referral Notes" readOnly={readOnly} value={leadReferralNotes || undefined}>
            <textarea value={leadReferralNotes} onChange={e => setLeadReferralNotes(e.target.value)}
              placeholder="Any notes about the lead or referral…"
              rows={3} className={`${input} resize-none`} />
          </Field>
        )}
      </Section>

      {/* ── Contacts ── */}
      <Section title="Contact Details">
        {!readOnly && (
          <p className="text-xs text-gray-400 -mt-1 mb-3">
            Primary contact is required. Add secondary contacts once the primary is set.
          </p>
        )}

        {contacts.length === 0 && readOnly && (
          <p className="text-sm text-gray-400">No contacts linked.</p>
        )}

        {contacts.map((c, i) => readOnly ? (
          <div key={i} className={`flex items-center justify-between gap-3 ${i > 0 ? 'mt-3' : ''}`}>
            <div>
              <div className="flex items-center gap-2 flex-wrap text-sm text-[#1a1a1a]">
                {i === 0 && (
                  <span className="text-xs bg-[#1a1a1a] text-white rounded-full px-2 py-0.5 flex-shrink-0">Primary</span>
                )}
                <span className="font-medium">{c.contact_name}</span>
                {c.tag_option_id && (
                  <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 flex-shrink-0">{c.tag_option_id}</span>
                )}
              </div>
              {(c.phone_number || c.email_address) && (
                <p className="text-xs text-gray-400 mt-2">{[c.phone_number, c.email_address].filter(Boolean).join(' | ')}</p>
              )}
            </div>
            <Link href={`/dashboard/contacts/${c.contact_id}`} className={`${btn.primary} flex-shrink-0`}>
              Details
            </Link>
          </div>
        ) : (
          <div key={i} className="flex items-center gap-3 mb-2">
            <div className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 bg-gray-50 text-sm text-[#1a1a1a] flex items-center gap-2 flex-wrap">
              {i === 0 && (
                <span className="text-xs bg-[#1a1a1a] text-white rounded-full px-2 py-0.5 flex-shrink-0">Primary</span>
              )}
              <span className="flex-1 min-w-0 truncate">{c.contact_name}</span>
              <select value={c.tag_option_id} onChange={e => setContactTag(i, e.target.value)}
                className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:outline-none cursor-pointer flex-shrink-0 text-gray-600">
                <option value="">No tag</option>
                {CONTACT_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => removeContact(i)}
              className="text-gray-300 hover:text-red-400 text-xl transition-colors flex-shrink-0 cursor-pointer">×</button>
          </div>
        ))}

        {!readOnly && (
          <>
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
          </>
        )}
      </Section>

      {/* ── Property Details ── */}
      <Section title="Property Details">
        {selectedProperty && readOnly ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-[#1a1a1a] text-sm">{displayAddress(selectedProperty)}</p>
              <p className="text-xs text-gray-400 mt-0.5 capitalize">
                {selectedProperty.property_type?.replace('_', ' ')}
              </p>
            </div>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(propertyMapQuery(selectedProperty))}`}
              target="_blank" rel="noopener noreferrer"
              className={`${btn.primary} flex-shrink-0`}
            >
              Map
            </a>
          </div>
        ) : selectedProperty ? (
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <p className="font-medium text-[#1a1a1a] text-sm">{displayAddress(selectedProperty)}</p>
              <p className="text-xs text-gray-400 mt-0.5 capitalize">
                {selectedProperty.property_type?.replace('_', ' ')}
              </p>
            </div>
            <button type="button" onClick={() => setSelectedProperty(null)}
              className="text-gray-400 hover:text-[#1a1a1a] text-xl transition-colors cursor-pointer">×</button>
          </div>
        ) : readOnly ? (
          <p className="text-sm text-gray-400">No property linked.</p>
        ) : showPropertyReview ? (
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
        ) : (
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
            <div ref={addressSuggestionsRef} className="relative">
              <label className={labelCls}>Address <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={newPropertyAddress}
                onChange={e => setNewPropertyAddress(e.target.value)}
                onFocus={() => { if (addressSuggestions.length > 0) setShowAddressSuggestions(true) }}
                placeholder="Search for the property on Google Maps…"
                className={input}
              />
              {showAddressSuggestions && addressSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-md mt-1 max-h-60 overflow-y-auto">
                  {addressSuggestions.map(s => (
                    <button key={s.place_id} type="button"
                      onMouseDown={() => selectAddressSuggestion(s.description)}
                      className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a1a] hover:bg-[#f8f7f4] border-b border-gray-100 last:border-b-0 transition-colors">
                      {s.description}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {checkingMatches && (
              <p className="text-xs text-gray-400">Checking for existing properties…</p>
            )}
            {!checkingMatches && addressMatches.length > 0 && (
              <div className="bg-[#1a1a1a] rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <WarningIcon className="w-4 h-4 text-white flex-shrink-0" />
                  <p className="text-xs font-medium text-white">
                    This address may already exist — select it instead of creating a duplicate:
                  </p>
                </div>
                {addressMatches.map(p => (
                  <button key={p.id} type="button" onClick={() => selectExistingProperty(p)}
                    className="w-full text-left px-3 py-2 rounded-md bg-white border border-transparent hover:border-[#E8266F] text-sm text-[#1a1a1a] transition-colors">
                    <span className="font-medium">{displayAddress(p)}</span>
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
              <button type="button" onClick={lookupAddress} disabled={lookingUpAddress || addressMatches.length > 0} className={`${btn.primary} flex-1`}>
                {lookingUpAddress ? 'Looking up address…' : 'Look Up Address'}
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* ── Evaluation Details ── */}
      <Section title="Evaluation Details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className={labelCls}>Date &amp; Time Captured</span>
            <p className="text-sm text-[#1a1a1a] py-2.5">{capturedDateDisplay}</p>
          </div>
          <div>
            <span className={labelCls}>Captured By</span>
            <p className="text-sm text-[#1a1a1a] py-2.5">
              {capturedByProfile?.full_name ?? capturedByProfile?.email ?? '—'}
            </p>
          </div>
        </div>

        <Field label="Evaluation Status" readOnly={readOnly} value={STATUS_DISPLAY[status] ?? status}>
          <select value={status} onChange={e => setStatus(e.target.value)} className={select}>
            <option value="new">New</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="presented">Presented</option>
            <option value="follow_up">Follow-Up</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>

        {status === 'lost' && (
          <Field label="Reason Lost" readOnly={readOnly}
            value={reasonLost === 'other' ? (reasonLostOther || 'Other') : REASONS_LOST.find(r => r.value === reasonLost)?.label}>
            <select value={reasonLost} onChange={e => setReasonLost(e.target.value)} className={select}>
              <option value="">—</option>
              {REASONS_LOST.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {reasonLost === 'other' && (
              <input value={reasonLostOther} onChange={e => setReasonLostOther(e.target.value)}
                placeholder="Describe the reason" className={`${input} mt-2`} />
            )}
          </Field>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Agent" readOnly={readOnly} value={profiles.find(p => p.id === agentId)?.full_name ?? profiles.find(p => p.id === agentId)?.email}>
            <select value={agentId} onChange={e => setAgentId(e.target.value)} className={select}>
              <option value="">—</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
              ))}
            </select>
          </Field>
          <Field label="Transaction Coordinator" readOnly={readOnly} value={profiles.find(p => p.id === tcId)?.full_name ?? profiles.find(p => p.id === tcId)?.email}>
            <select value={tcId} onChange={e => setTcId(e.target.value)} className={select}>
              <option value="">—</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Evaluation Date and Time" readOnly={readOnly}
          value={schedDate ? (
            <span className="flex items-center gap-2 flex-wrap">
              {`${new Date(schedDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}${schedTime ? ' at ' + schedTime : ''}`}
              {calendarEventLink && (
                <a href={calendarEventLink} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">
                  View Event ↗
                </a>
              )}
            </span>
          ) : undefined}>
          <div className="grid grid-cols-2 gap-4 mt-1">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Date</label>
              <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} className={input} />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Time</label>
              <input type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} className={input} />
            </div>
          </div>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Evaluation Price" readOnly={readOnly} value={evaluationPrice ? formatZAR(evaluationPrice) : undefined}>
            <input type="number" value={evaluationPrice} onChange={e => setEvaluationPrice(e.target.value)}
              className={input} placeholder="0" />
          </Field>
          <Field label="Marketing Price" readOnly={readOnly} value={marketingPrice ? formatZAR(marketingPrice) : undefined}>
            <input type="number" value={marketingPrice} onChange={e => setMarketingPrice(e.target.value)}
              className={input} placeholder="0" />
          </Field>
        </div>
      </Section>

      {error && <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg">{error}</p>}

      {!readOnly && (
        <div className="flex gap-3">
          <button type="submit" disabled={saving} className={`${btn.primary} flex-1 py-4`}>
            {saving ? 'Saving…' : evaluationId ? 'Save Changes' : 'Save Evaluation'}
          </button>
          <button type="button" onClick={handleCancel} className={`${btn.secondary} flex-1`}>
            Cancel
          </button>
        </div>
      )}

    </form>
  )
}

// ── ContactSearch combobox ────────────────────────────────────
function ContactSearch({ placeholder, onSelect, excludeIds }: {
  placeholder: string
  onSelect: (id: string, name: string, phone_number: string | null, email_address: string | null) => void
  excludeIds: string[]
}) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<{ id: string; first_name: string; last_name: string; phone_number: string | null; email_address: string | null }[]>([])
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
        .select('id, first_name, last_name, phone_number, email_address')
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
                onMouseDown={() => { onSelect(r.id, name, r.phone_number, r.email_address); setQuery(''); setOpen(false) }}
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
