'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────
type Property = {
  id: string; property_type: string | null
  unit_number: string | null; complex_or_building_name: string | null
  street_number: string | null; street_name: string | null
  suburb: string | null; city: string | null; province: string | null
  postal_code: string | null; google_maps_url: string | null
  latitude: number | null; longitude: number | null
}

type EvalContact = {
  id: string; is_primary: boolean; sort_order: number
  tag_option_id: string | null
  contacts: { id: string; first_name: string; last_name: string; title: string | null; phone_number: string | null; email_address: string | null } | null
  picklist_options: { label: string } | null
}

type PipelineStep = {
  id: string; step_key: string; is_complete: boolean
  completed_at: string | null; sort_order: number
}

type Profile = { id: string; full_name: string | null; email: string | null; role: string | null }

type Evaluation = {
  id: string; status: string; date_captured: string
  reason_lost: string | null
  property_status: string | null
  lead_generated_by: string | null
  lead_source_other_text: string | null; lead_referral_notes: string | null
  referral_type: string | null
  motivation_for_selling_notes: string | null; selling_timeline_notes: string | null
  scheduled_at: string | null; calendar_event_link: string | null
  sellers_agent_user_id: string | null
  transaction_coordinator_user_id: string | null
  evaluation_price: number | null
  marketing_price: number | null
  properties: Property | null
  lead_source_picklist: { label: string } | null
  motivation_picklist: { label: string } | null
  timeline_picklist: { label: string } | null
  evaluation_contacts: EvalContact[]
  evaluation_pipeline_steps: PipelineStep[]
}

// ── Helpers ───────────────────────────────────────────────────
function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
}

function formatAddress(p: Property | null): string {
  if (!p) return 'Unknown address'
  if (p.property_type === 'sectional_title' && p.unit_number) {
    return `Unit ${p.unit_number}${p.complex_or_building_name ? ' ' + p.complex_or_building_name : ''}${p.suburb ? ', ' + p.suburb : ''}`
  }
  return [p.street_number, p.street_name, p.suburb].filter(Boolean).join(' ') || p.city || 'Unknown address'
}

function mapsUrl(p: Property | null): string | null {
  if (!p) return null
  if (p.google_maps_url) return p.google_maps_url
  const addr = formatAddress(p)
  if (addr && addr !== 'Unknown address') return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`
  return null
}

const STEP_LABELS: Record<string, string> = {
  captured:             'Evaluation Captured',
  scheduled:            'Evaluation Scheduled',
  lightstone_uploaded:  'Lightstone Reports Uploaded',
  property_inspected:   'Property Inspected',
  description_captured: 'Description Captured',
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
  on_hold:     'bg-orange-50 text-orange-700',
  cancelled:   'bg-gray-100 text-gray-500',
  // Legacy statuses (kept for evaluations created before this status list changed)
  in_progress: 'bg-blue-50 text-blue-700',
  open:        'bg-green-50 text-green-700',
  future:      'bg-yellow-50 text-yellow-700',
}

const STATUS_LABELS: Record<string, string> = {
  new: 'New', scheduled: 'Scheduled', completed: 'Completed', presented: 'Presented',
  follow_up: 'Follow-Up', won: 'Won', lost: 'Lost', on_hold: 'On Hold', cancelled: 'Cancelled',
  // Legacy statuses (kept for evaluations created before this status list changed)
  in_progress: 'In Progress', open: 'Open Mandate', future: 'Future Mandate',
}

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

// ── Page ──────────────────────────────────────────────────────
export default function EvaluationDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState<'details' | 'inspection' | 'pipeline'>('details')
  const [userId, setUserId]         = useState<string | null>(null)
  const [editing, setEditing]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [syncing, setSyncing]       = useState(false)
  const [syncError, setSyncError]   = useState('')
  const [profiles, setProfiles]     = useState<Profile[]>([])

  // Edit form state
  const [editStatus, setEditStatus]             = useState('')
  const [editReasonLost, setEditReasonLost]     = useState('')
  const [editPropertyStatus, setEditPropertyStatus] = useState('')
  const [editSchedDate, setEditSchedDate] = useState('')
  const [editSchedTime, setEditSchedTime] = useState('')
  const editScheduledAt = editSchedDate && editSchedTime ? `${editSchedDate}T${editSchedTime}` : ''
  const [editMotivationNotes, setEditMotivationNotes] = useState('')
  const [editTimelineNotes, setEditTimelineNotes] = useState('')
  const [editLeadReferralNotes, setEditLeadReferralNotes] = useState('')
  const [editAgentId, setEditAgentId]           = useState('')
  const [editTcId, setEditTcId]                 = useState('')
  const [editEvaluationPrice, setEditEvaluationPrice] = useState('')
  const [editMarketingPrice, setEditMarketingPrice]   = useState('')

  const fetchEvaluation = useCallback(async () => {
    const { data } = await supabase
      .from('evaluations')
      .select(`
        id, status, date_captured, reason_lost, property_status, lead_generated_by,
        lead_source_other_text, lead_referral_notes, referral_type,
        motivation_for_selling_notes, selling_timeline_notes,
        scheduled_at, calendar_event_link,
        sellers_agent_user_id, transaction_coordinator_user_id,
        evaluation_price, marketing_price,
        properties (id, property_type, unit_number, complex_or_building_name,
          street_number, street_name, suburb, city, province, postal_code,
          google_maps_url, latitude, longitude),
        lead_source_picklist:lead_source_option_id (label),
        motivation_picklist:motivation_for_selling_option_id (label),
        timeline_picklist:selling_timeline_option_id (label),
        evaluation_contacts (
          id, is_primary, sort_order, tag_option_id,
          contacts (id, first_name, last_name, title, phone_number, email_address),
          picklist_options:tag_option_id (label)
        ),
        evaluation_pipeline_steps (id, step_key, is_complete, completed_at, sort_order)
      `)
      .eq('id', id)
      .single()

    if (data) {
      const ev = data as unknown as Evaluation
      setEvaluation(ev)
      setEditStatus(ev.status)
      setEditReasonLost(ev.reason_lost ?? '')
      setEditPropertyStatus(ev.property_status ?? '')
      const schedIso = ev.scheduled_at ? ev.scheduled_at.slice(0, 16) : ''
      setEditSchedDate(schedIso ? schedIso.slice(0, 10) : '')
      setEditSchedTime(schedIso ? schedIso.slice(11, 16) : '')
      setEditMotivationNotes(ev.motivation_for_selling_notes ?? '')
      setEditTimelineNotes(ev.selling_timeline_notes ?? '')
      setEditLeadReferralNotes(ev.lead_referral_notes ?? '')
      setEditAgentId(ev.sellers_agent_user_id ?? '')
      setEditTcId(ev.transaction_coordinator_user_id ?? '')
      setEditEvaluationPrice(ev.evaluation_price != null ? String(ev.evaluation_price) : '')
      setEditMarketingPrice(ev.marketing_price != null ? String(ev.marketing_price) : '')
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/')
      else setUserId(data.user.id)
    })
    supabase.from('profiles').select('id, full_name, email, role').then(({ data }) => {
      setProfiles((data ?? []) as Profile[])
    })
    fetchEvaluation()
  }, [router, fetchEvaluation])

  async function saveEdit() {
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('evaluations').update({
      status:                   editStatus,
      reason_lost:              editStatus === 'lost' ? (editReasonLost || null) : null,
      property_status:          editPropertyStatus || null,
      scheduled_at:             editScheduledAt || null,
      motivation_for_selling_notes: editMotivationNotes || null,
      selling_timeline_notes:   editTimelineNotes || null,
      lead_referral_notes:      editLeadReferralNotes || null,
      sellers_agent_user_id:    editAgentId || null,
      transaction_coordinator_user_id: editTcId || null,
      evaluation_price:         editEvaluationPrice ? Number(editEvaluationPrice) : null,
      marketing_price:          editMarketingPrice ? Number(editMarketingPrice) : null,
    }).eq('id', id)

    if (err) { setError(err.message); setSaving(false); return }
    await fetchEvaluation()
    setEditing(false)
    setSaving(false)
  }

  async function syncToCalendar() {
    if (!userId) return
    setSyncing(true)
    setSyncError('')
    const res = await fetch('/api/calendar/sync', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ evaluationId: id, userId }),
    })
    const json = await res.json()
    if (!res.ok) {
      setSyncError(json.error ?? 'Failed to sync to Google Calendar.')
    } else {
      await fetchEvaluation()
    }
    setSyncing(false)
  }

  async function togglePipelineStep(stepId: string, currentValue: boolean) {
    await supabase.from('evaluation_pipeline_steps').update({
      is_complete: !currentValue,
      completed_at: !currentValue ? new Date().toISOString() : null,
    }).eq('id', stepId)
    fetchEvaluation()
  }

  if (loading) return <div className="p-10 text-gray-400 text-sm">Loading…</div>
  if (!evaluation) return <div className="p-10 text-gray-400 text-sm">Evaluation not found.</div>

  const ev = evaluation
  const address = formatAddress(ev.properties)
  const mapLink = mapsUrl(ev.properties)
  const sortedContacts = [...(ev.evaluation_contacts ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  const sortedSteps    = [...(ev.evaluation_pipeline_steps ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  const stepsComplete  = sortedSteps.filter(s => s.is_complete).length
  const dateStr = new Date(ev.date_captured).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
  const agentProfile = profiles.find(p => p.id === ev.sellers_agent_user_id) ?? null
  const tcProfile     = profiles.find(p => p.id === ev.transaction_coordinator_user_id) ?? null

  return (
    <div className="p-10 max-w-4xl">

      {/* ── Header ── */}
      <div className="mb-8">
        <Link href="/dashboard/evaluations" className="text-sm text-gray-400 hover:text-[#1a1a1a] mb-3 inline-block transition-colors">
          ← Evaluations
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a1a]">{address}</h1>
            <p className="text-sm text-gray-400 mt-1">Captured {dateStr}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm px-3 py-1 rounded-full font-medium ${STATUS_COLOURS[ev.status] ?? 'bg-gray-100 text-gray-500'}`}>
              {STATUS_LABELS[ev.status] ?? ev.status}
            </span>
            {!editing && (
              <button onClick={() => setEditing(true)} className={btn.secondary}>Edit</button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { key: 'details',    label: 'Details' },
          { key: 'inspection', label: 'Inspection' },
          { key: 'pipeline',   label: 'Pipeline' },
        ] as const).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key ? 'border-[#1a1a1a] text-[#1a1a1a]' : 'border-transparent text-gray-400 hover:text-[#1a1a1a]'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Details tab ── */}
      {activeTab === 'details' && (
        <div className="space-y-6">

          {/* Property */}
          <div className={`${card} p-6`}>
            <h3 className={sectionTitle}>Property</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <InfoRow label="Type" value={ev.properties?.property_type?.replace('_', ' ') ?? '—'} />
              {ev.properties?.unit_number && <InfoRow label="Unit" value={ev.properties.unit_number} />}
              {ev.properties?.complex_or_building_name && <InfoRow label="Building" value={ev.properties.complex_or_building_name} />}
              <InfoRow label="Address"
                value={mapLink
                  ? <a href={mapLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{address}</a>
                  : address}
              />
              {ev.properties?.suburb && <InfoRow label="Suburb" value={ev.properties.suburb} />}
              {ev.properties?.city && <InfoRow label="City" value={ev.properties.city} />}
              {ev.properties?.province && <InfoRow label="Province" value={ev.properties.province} />}
            </div>
          </div>

          {/* Contacts */}
          <div className={`${card} p-6`}>
            <h3 className={sectionTitle}>Contacts</h3>
            {sortedContacts.length === 0 ? (
              <p className="text-sm text-gray-400">No contacts linked.</p>
            ) : (
              <div className="space-y-3">
                {sortedContacts.map(ec => (
                  ec.contacts && (
                    <div key={ec.id} className="flex items-start justify-between gap-4 py-3 border-b border-gray-50 last:border-0">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/dashboard/contacts/${ec.contacts.id}`}
                            className="font-medium text-[#1a1a1a] text-sm hover:underline">
                            {[ec.contacts.first_name, ec.contacts.last_name].filter(Boolean).join(' ')}
                          </Link>
                          {ec.is_primary && (
                            <span className="text-xs bg-[#1a1a1a] text-white rounded-full px-2 py-0.5">Primary</span>
                          )}
                          {ec.picklist_options && (
                            <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{ec.picklist_options.label}</span>
                          )}
                        </div>
                        <div className="flex gap-4 mt-1 text-xs text-gray-500">
                          {ec.contacts.phone_number && <span>{ec.contacts.phone_number}</span>}
                          {ec.contacts.email_address && <span>{ec.contacts.email_address}</span>}
                        </div>
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
          </div>

          {/* Deal Details */}
          <div className={`${card} p-6`}>
            <h3 className={sectionTitle}>Deal Details</h3>
            {editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Status</label>
                    <select value={editStatus} onChange={e => setEditStatus(e.target.value)} className={select}>
                      <option value="new">New</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="completed">Completed</option>
                      <option value="presented">Presented</option>
                      <option value="follow_up">Follow-Up</option>
                      <option value="won">Won</option>
                      <option value="lost">Lost</option>
                      <option value="on_hold">On Hold</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="in_progress">In Progress (legacy)</option>
                      <option value="open">Open Mandate (legacy)</option>
                      <option value="future">Future Mandate (legacy)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Property Status</label>
                    <select value={editPropertyStatus} onChange={e => setEditPropertyStatus(e.target.value)} className={select}>
                      <option value="">—</option>
                      <option value="off_market">Off Market</option>
                      <option value="on_market">On Market</option>
                    </select>
                  </div>
                </div>
                {editStatus === 'lost' && (
                  <div>
                    <label className={labelCls}>Reason Lost</label>
                    <select value={editReasonLost} onChange={e => setEditReasonLost(e.target.value)} className={select}>
                      <option value="">—</option>
                      {REASONS_LOST.map(r => <option key={r.value} value={r.label}>{r.label}</option>)}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Scheduled Date</label>
                    <input type="date" value={editSchedDate} onChange={e => setEditSchedDate(e.target.value)} className={input} />
                  </div>
                  <div>
                    <label className={labelCls}>Scheduled Time</label>
                    <input type="time" value={editSchedTime} onChange={e => setEditSchedTime(e.target.value)} className={input} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Agent</label>
                    <select value={editAgentId} onChange={e => setEditAgentId(e.target.value)} className={select}>
                      <option value="">—</option>
                      {profiles.filter(p => p.role === 'agent').map(p => (
                        <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>TC</label>
                    <select value={editTcId} onChange={e => setEditTcId(e.target.value)} className={select}>
                      <option value="">—</option>
                      {profiles.filter(p => p.role === 'transaction_coordinator').map(p => (
                        <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Evaluation Price</label>
                    <input type="number" value={editEvaluationPrice} onChange={e => setEditEvaluationPrice(e.target.value)} className={input} placeholder="0" />
                  </div>
                  <div>
                    <label className={labelCls}>Marketing Price</label>
                    <input type="number" value={editMarketingPrice} onChange={e => setEditMarketingPrice(e.target.value)} className={input} placeholder="0" />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  <InfoRow label="Status" value={STATUS_LABELS[ev.status] ?? ev.status} />
                  {ev.status === 'lost' && ev.reason_lost && <InfoRow label="Reason Lost" value={ev.reason_lost} />}
                  <InfoRow label="Property Status" value={ev.property_status?.replace('_', ' ') ?? '—'} />
                  <InfoRow label="Scheduled"
                    value={ev.scheduled_at
                      ? new Date(ev.scheduled_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
                      : '—'}
                  />
                  {ev.calendar_event_link && (
                    <InfoRow label="Calendar" value={<a href={ev.calendar_event_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View event ↗</a>} />
                  )}
                  <InfoRow label="Agent" value={agentProfile?.full_name ?? agentProfile?.email ?? '—'} />
                  <InfoRow label="TC" value={tcProfile?.full_name ?? tcProfile?.email ?? '—'} />
                  <InfoRow label="Evaluation Price" value={formatCurrency(ev.evaluation_price)} />
                  <InfoRow label="Marketing Price" value={formatCurrency(ev.marketing_price)} />
                </div>
                {ev.scheduled_at && (
                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    <button onClick={syncToCalendar} disabled={syncing} className={btn.secondary}>
                      {syncing ? 'Syncing…' : ev.calendar_event_link ? '↻ Update Google Calendar' : '+ Add to Google Calendar'}
                    </button>
                    {syncError && <p className="text-xs text-red-500">{syncError}</p>}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Lead Information */}
          <div className={`${card} p-6`}>
            <h3 className={sectionTitle}>Lead Information</h3>
            {editing ? (
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Referral Notes</label>
                  <textarea value={editLeadReferralNotes} onChange={e => setEditLeadReferralNotes(e.target.value)}
                    rows={3} className={`${input} resize-none`} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <InfoRow label="Lead Generated By" value={ev.lead_generated_by?.replace('_', ' ') ?? '—'} />
                <InfoRow label="Lead Source" value={ev.lead_source_picklist?.label ?? (ev.lead_source_other_text ?? '—')} />
                {ev.referral_type && <InfoRow label="Referral Type" value={ev.referral_type.replace('_', ' ')} />}
                {ev.lead_referral_notes && <InfoRow label="Referral Notes" value={ev.lead_referral_notes} fullWidth />}
              </div>
            )}
          </div>

          {/* Motivation & Timeline */}
          <div className={`${card} p-6`}>
            <h3 className={sectionTitle}>Motivation & Timeline</h3>
            {editing ? (
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Motivation Notes</label>
                  <textarea value={editMotivationNotes} onChange={e => setEditMotivationNotes(e.target.value)}
                    rows={2} className={`${input} resize-none`} />
                </div>
                <div>
                  <label className={labelCls}>Timeline Notes</label>
                  <textarea value={editTimelineNotes} onChange={e => setEditTimelineNotes(e.target.value)}
                    rows={2} className={`${input} resize-none`} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                <InfoRow label="Motivation" value={ev.motivation_picklist?.label ?? '—'} />
                <InfoRow label="Timeline" value={ev.timeline_picklist?.label ?? '—'} />
                {ev.motivation_for_selling_notes && <InfoRow label="Motivation Notes" value={ev.motivation_for_selling_notes} fullWidth />}
                {ev.selling_timeline_notes && <InfoRow label="Timeline Notes" value={ev.selling_timeline_notes} fullWidth />}
              </div>
            )}
          </div>

          {/* Edit controls */}
          {editing && (
            <div className="space-y-3">
              {error && <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg">{error}</p>}
              <div className="flex gap-3">
                <button onClick={() => setEditing(false)} className={`${btn.secondary} flex-1`}>Cancel</button>
                <button onClick={saveEdit} disabled={saving} className={`${btn.primary} flex-1`}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Inspection tab ── */}
      {activeTab === 'inspection' && (
        <InspectionTab evaluationId={id} onSaved={fetchEvaluation} />
      )}

      {/* ── Pipeline tab ── */}
      {activeTab === 'pipeline' && (
        <div className={`${card} p-6`}>
          <div className="flex items-center justify-between mb-6">
            <h3 className={sectionTitle}>Progress</h3>
            <span className="text-sm text-gray-400">{stepsComplete} / {sortedSteps.length} complete</span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-gray-100 rounded-full h-2 mb-8">
            <div
              className="bg-[#1a1a1a] h-2 rounded-full transition-all"
              style={{ width: `${sortedSteps.length > 0 ? (stepsComplete / sortedSteps.length) * 100 : 0}%` }}
            />
          </div>

          <div className="space-y-3">
            {sortedSteps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
                <button
                  onClick={() => togglePipelineStep(step.id, step.is_complete)}
                  className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                    step.is_complete
                      ? 'bg-[#1a1a1a] border-[#1a1a1a] text-white'
                      : 'border-gray-300 hover:border-gray-500'
                  }`}
                >
                  {step.is_complete && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>

                <div className="flex-1">
                  <p className={`text-sm font-medium ${step.is_complete ? 'text-[#1a1a1a]' : 'text-gray-400'}`}>
                    {i + 1}. {STEP_LABELS[step.step_key] ?? step.step_key}
                  </p>
                  {step.completed_at && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(step.completed_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── InfoRow helper ────────────────────────────────────────────
function InfoRow({ label, value, fullWidth }: { label: string; value: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-[#1a1a1a] capitalize">{value ?? '—'}</p>
    </div>
  )
}

// ── InspectionTab ─────────────────────────────────────────────
const GARDEN_OPTIONS    = ['Level', 'Slope / Terrace', 'Large', 'Medium', 'Small']
const PATIO_OPTIONS     = ['Covered', 'Open', 'Sundeck', 'Fully Enclosed']
const SECURITY_OPTIONS  = ['Standard', 'CCTV', 'Electric Fencing']
const CONDITION_ITEMS   = ['Flooring', 'Windows / Doors', 'Architecture']
const ADDITIONAL_OPTS   = ['Jungle Gym', 'Jojo Tank', 'Storeroom', 'Solar Panels', 'Inverter', 'Batteries']

type ConditionItem = { feature: string; condition: string }

type InspectionForm = {
  // Exterior
  land_size: string
  gate_type: string
  fencing_type: string
  views_present: boolean | null
  garages_quantity: number
  garages_descriptor: string
  carports_quantity: number
  garden_present: boolean | null
  garden_selections: string[]
  patio_quantity: number
  patio_selections: string[]
  pool_present: boolean | null
  pool_condition: string
  jacuzzi_present: boolean | null
  jacuzzi_status: string
  tennis_court_present: boolean | null
  // Interior
  bedrooms_quantity: number
  bedroom_sizes: string[]
  bathrooms_quantity: number
  bathroom_conditions: string[]
  kitchen_quantity: number
  lounges_quantity: number
  dining_room_quantity: number
  other_reception_quantity: number
  study_quantity: number
  study_types: string[]
  domestic_quarters_quantity: number
  domestic_quarters_toilet_only: boolean
  flatlet_quantity: number
  flatlet_bedroom_types: string[]
  flatlet_notes: string
  scullery_laundry_present: boolean | null
  scullery_laundry_type: string
  security_present: boolean | null
  security_features: string[]
  general_condition: ConditionItem[]
  // Other
  additional_features: string[]
}

const EMPTY_INSPECTION: InspectionForm = {
  land_size: '', gate_type: '', fencing_type: '', views_present: null,
  garages_quantity: 0, garages_descriptor: '', carports_quantity: 0,
  garden_present: null, garden_selections: [],
  patio_quantity: 0, patio_selections: [],
  pool_present: null, pool_condition: '',
  jacuzzi_present: null, jacuzzi_status: '',
  tennis_court_present: null,
  bedrooms_quantity: 0, bedroom_sizes: [],
  bathrooms_quantity: 0, bathroom_conditions: [],
  kitchen_quantity: 0, lounges_quantity: 0, dining_room_quantity: 0, other_reception_quantity: 0,
  study_quantity: 0, study_types: [],
  domestic_quarters_quantity: 0, domestic_quarters_toilet_only: false,
  flatlet_quantity: 0, flatlet_bedroom_types: [], flatlet_notes: '',
  scullery_laundry_present: null, scullery_laundry_type: '',
  security_present: null, security_features: [],
  general_condition: [],
  additional_features: [],
}

function InspectionTab({ evaluationId, onSaved }: { evaluationId: string; onSaved: () => void }) {
  const [form, setForm]                 = useState<InspectionForm>(EMPTY_INSPECTION)
  const [inspectionId, setInspectionId] = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [error, setError]               = useState('')
  const [userId, setUserId]             = useState<string | null>(null)
  const [picklists, setPicklists]       = useState<Record<string, { id: string; label: string }[]>>({})

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))

    supabase.from('picklist_options')
      .select('id, list_name, label')
      .in('list_name', ['garden_description', 'patio_description'])
      .order('sort_order')
      .then(({ data }) => {
        const map: Record<string, { id: string; label: string }[]> = {}
        for (const row of data ?? []) {
          if (!map[row.list_name]) map[row.list_name] = []
          map[row.list_name].push({ id: row.id, label: row.label })
        }
        setPicklists(map)
      })

    supabase.from('property_inspections')
      .select('*, inspection_feature_selections(feature_key, picklist_option_id, picklist_options(label))')
      .eq('evaluation_id', evaluationId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setInspectionId(data.id)
          const sels = (data.inspection_feature_selections ?? []) as { feature_key: string; picklist_options: { label: string } | null }[]
          let gc: ConditionItem[] = []
          try { gc = data.general_condition ? JSON.parse(data.general_condition) : [] } catch { gc = [] }
          setForm({
            land_size:                     data.land_size ?? '',
            gate_type:                     data.gate_type ?? '',
            fencing_type:                  data.fencing_type ?? '',
            views_present:                 data.views_present ?? null,
            garages_quantity:              data.garages_quantity ?? 0,
            garages_descriptor:            data.garages_descriptor ?? '',
            carports_quantity:             data.carports_quantity ?? 0,
            garden_present:                data.garden_present ?? null,
            garden_selections:             sels.filter(s => s.feature_key === 'garden_description').map(s => s.picklist_options?.label ?? '').filter(Boolean),
            patio_quantity:                data.patio_quantity ?? 0,
            patio_selections:              sels.filter(s => s.feature_key === 'patio_description').map(s => s.picklist_options?.label ?? '').filter(Boolean),
            pool_present:                  data.pool_present ?? null,
            pool_condition:                data.pool_condition ?? '',
            jacuzzi_present:               data.jacuzzi_present ?? null,
            jacuzzi_status:                data.jacuzzi_status ?? '',
            tennis_court_present:          data.tennis_court_present ?? null,
            bedrooms_quantity:             data.bedrooms_quantity ?? 0,
            bedroom_sizes:                 data.bedroom_sizes ? data.bedroom_sizes.split(',') : [],
            bathrooms_quantity:            data.bathrooms_quantity ?? 0,
            bathroom_conditions:           data.bathroom_conditions ? data.bathroom_conditions.split(',') : [],
            kitchen_quantity:              data.kitchen_quantity ?? 0,
            lounges_quantity:              data.lounges_quantity ?? 0,
            dining_room_quantity:          data.dining_room_quantity ?? 0,
            other_reception_quantity:      data.other_reception_quantity ?? 0,
            study_quantity:                data.study_quantity ?? 0,
            study_types:                   data.study_types ? data.study_types.split(',') : [],
            domestic_quarters_quantity:    data.domestic_quarters_quantity ?? 0,
            domestic_quarters_toilet_only: data.domestic_quarters_toilet_only ?? false,
            flatlet_quantity:              data.flatlet_quantity ?? 0,
            flatlet_bedroom_types:         data.flatlet_bedroom_type ? data.flatlet_bedroom_type.split(',') : [],
            flatlet_notes:                 data.flatlet_notes ?? '',
            scullery_laundry_present:      data.scullery_laundry_present ?? null,
            scullery_laundry_type:         data.scullery_laundry_type ?? '',
            security_present:              data.security_present ?? null,
            security_features:             data.security_features ? data.security_features.split(',') : [],
            general_condition:             gc,
            additional_features:           data.additional_features ? data.additional_features.split(',') : [],
          })
        }
        setLoading(false)
      })
  }, [evaluationId])

  function set<K extends keyof InspectionForm>(field: K, value: InspectionForm[K]) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function toggleStr(field: 'garden_selections' | 'patio_selections' | 'security_features' | 'additional_features', label: string) {
    setForm(f => {
      const cur = f[field] as string[]
      return { ...f, [field]: cur.includes(label) ? cur.filter(v => v !== label) : [...cur, label] }
    })
  }

  function resizeArr(current: string[], newLen: number): string[] {
    const next = current.slice(0, newLen)
    while (next.length < newLen) next.push('')
    return next
  }

  function setConditionFeature(feature: string, condition: string) {
    setForm(f => {
      const existing = f.general_condition.find(c => c.feature === feature)
      if (existing) {
        return { ...f, general_condition: f.general_condition.map(c => c.feature === feature ? { ...c, condition } : c) }
      }
      return { ...f, general_condition: [...f.general_condition, { feature, condition }] }
    })
  }

  function toggleConditionItem(feature: string) {
    setForm(f => {
      const has = f.general_condition.some(c => c.feature === feature)
      return {
        ...f,
        general_condition: has
          ? f.general_condition.filter(c => c.feature !== feature)
          : [...f.general_condition, { feature, condition: '' }],
      }
    })
  }

  async function handleSave() {
    if (!userId) return
    setSaving(true)
    setError('')

    const payload = {
      evaluation_id:                 evaluationId,
      captured_by_user_id:           userId,
      land_size:                     form.land_size || null,
      gate_type:                     form.gate_type || null,
      fencing_type:                  form.fencing_type || null,
      views_present:                 form.views_present,
      garages_quantity:              form.garages_quantity,
      garages_descriptor:            form.garages_descriptor || null,
      carports_quantity:             form.carports_quantity,
      garden_present:                form.garden_present,
      patio_quantity:                form.patio_quantity,
      pool_present:                  form.pool_present,
      pool_condition:                form.pool_present ? (form.pool_condition || null) : null,
      jacuzzi_present:               form.jacuzzi_present,
      jacuzzi_status:                form.jacuzzi_present ? (form.jacuzzi_status || null) : null,
      tennis_court_present:          form.tennis_court_present,
      bedrooms_quantity:             form.bedrooms_quantity,
      bedroom_sizes:                 form.bedrooms_quantity > 0 ? form.bedroom_sizes.join(',') : null,
      bathrooms_quantity:            form.bathrooms_quantity,
      bathroom_conditions:           form.bathrooms_quantity > 0 ? form.bathroom_conditions.join(',') : null,
      kitchen_quantity:              form.kitchen_quantity,
      lounges_quantity:              form.lounges_quantity,
      dining_room_quantity:          form.dining_room_quantity,
      other_reception_quantity:      form.other_reception_quantity,
      study_quantity:                form.study_quantity,
      study_types:                   form.study_quantity > 0 ? form.study_types.join(',') : null,
      domestic_quarters_quantity:    form.domestic_quarters_quantity,
      domestic_quarters_toilet_only: form.domestic_quarters_toilet_only,
      flatlet_quantity:              form.flatlet_quantity,
      flatlet_bedroom_type:          form.flatlet_quantity > 0 ? form.flatlet_bedroom_types.join(',') : null,
      flatlet_notes:                 form.flatlet_quantity > 0 ? (form.flatlet_notes || null) : null,
      scullery_laundry_present:      form.scullery_laundry_present,
      scullery_laundry_type:         form.scullery_laundry_present ? (form.scullery_laundry_type || null) : null,
      security_present:              form.security_present,
      security_features:             form.security_present && form.security_features.length > 0 ? form.security_features.join(',') : null,
      general_condition:             form.general_condition.length > 0 ? JSON.stringify(form.general_condition) : null,
      additional_features:           form.additional_features.length > 0 ? form.additional_features.join(',') : null,
    }

    let newInspectionId = inspectionId
    if (inspectionId) {
      const { error: err } = await supabase.from('property_inspections').update(payload).eq('id', inspectionId)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { data, error: err } = await supabase.from('property_inspections').insert(payload).select('id').single()
      if (err || !data) { setError(err?.message ?? 'Failed to save.'); setSaving(false); return }
      newInspectionId = data.id
      setInspectionId(data.id)
    }

    if (newInspectionId) {
      await supabase.from('inspection_feature_selections').delete().eq('property_inspection_id', newInspectionId)
      const gardenOpts = picklists['garden_description'] ?? []
      const patioOpts  = picklists['patio_description'] ?? []
      const selections = [
        ...(form.garden_present ? form.garden_selections.map(label => {
          const opt = gardenOpts.find(o => o.label === label)
          return opt ? { property_inspection_id: newInspectionId!, feature_key: 'garden_description', picklist_option_id: opt.id } : null
        }).filter(Boolean) : []),
        ...(form.patio_quantity > 0 ? form.patio_selections.map(label => {
          const opt = patioOpts.find(o => o.label === label)
          return opt ? { property_inspection_id: newInspectionId!, feature_key: 'patio_description', picklist_option_id: opt.id } : null
        }).filter(Boolean) : []),
      ]
      if (selections.length > 0) await supabase.from('inspection_feature_selections').insert(selections as object[])

      await supabase.from('evaluation_pipeline_steps')
        .update({ is_complete: true, completed_at: new Date().toISOString(), completed_by_user_id: userId })
        .eq('evaluation_id', evaluationId).eq('step_key', 'description_captured')
    }

    setSaved(true)
    setSaving(false)
    onSaved()
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return <div className="text-center py-16 text-gray-400 text-sm">Loading inspection…</div>

  return (
    <div className="space-y-6">

      {/* ══ EXTERIOR ══ */}
      <InspSection title="Exterior">

        <SubHeading>Land & Access</SubHeading>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Land Size</label>
            <select value={form.land_size} onChange={e => set('land_size', e.target.value)} className={select}>
              <option value="">—</option>
              <option value="subdivisible">Subdivisible</option>
              <option value="not_subdivisible">Not Subdivisible</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Gate</label>
            <select value={form.gate_type} onChange={e => set('gate_type', e.target.value)} className={select}>
              <option value="">—</option>
              <option value="auto_gate">Auto Gate</option>
              <option value="manual">Manual</option>
              <option value="none">None</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Fencing</label>
            <select value={form.fencing_type} onChange={e => set('fencing_type', e.target.value)} className={select}>
              <option value="">—</option>
              <option value="fully_fenced">Fully Fenced</option>
              <option value="walls">Walls</option>
              <option value="partial">Partial</option>
              <option value="none">None</option>
            </select>
          </div>
        </div>
        <YesNo label="Views" value={form.views_present} onChange={v => set('views_present', v)} />

        <Divider />
        <SubHeading>Parking</SubHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Garages</label>
            <div className="flex gap-2 items-center">
              <Counter value={form.garages_quantity} onChange={v => set('garages_quantity', v)} />
              {form.garages_quantity > 0 && (
                <select value={form.garages_descriptor} onChange={e => set('garages_descriptor', e.target.value)} className={`${select} flex-1`}>
                  <option value="">Type…</option>
                  <option value="auto">Auto</option>
                  <option value="tandem">Tandem</option>
                </select>
              )}
            </div>
          </div>
          <div>
            <label className={labelCls}>Carports</label>
            <Counter value={form.carports_quantity} onChange={v => set('carports_quantity', v)} />
          </div>
        </div>

        <Divider />
        <SubHeading>Garden & Outdoor</SubHeading>
        <YesNo label="Garden" value={form.garden_present} onChange={v => set('garden_present', v)} />
        {form.garden_present && (
          <div>
            <label className={labelCls}>Garden Description</label>
            <MultiSelect options={GARDEN_OPTIONS} selected={form.garden_selections} onToggle={l => toggleStr('garden_selections', l)} />
          </div>
        )}
        <div>
          <label className={labelCls}>Patios / Braai Areas</label>
          <Counter value={form.patio_quantity} onChange={v => set('patio_quantity', v)} />
          {form.patio_quantity > 0 && (
            <div className="mt-3">
              <label className={labelCls}>Patio Description</label>
              <MultiSelect options={PATIO_OPTIONS} selected={form.patio_selections} onToggle={l => toggleStr('patio_selections', l)} />
            </div>
          )}
        </div>

        <Divider />
        <SubHeading>Pool & Extras</SubHeading>
        <YesNo label="Pool" value={form.pool_present} onChange={v => set('pool_present', v)} />
        {form.pool_present && (
          <div>
            <label className={labelCls}>Pool Condition</label>
            <select value={form.pool_condition} onChange={e => set('pool_condition', e.target.value)} className={select}>
              <option value="">—</option><option value="good">Good</option><option value="poor">Poor</option>
            </select>
          </div>
        )}
        <YesNo label="Jacuzzi" value={form.jacuzzi_present} onChange={v => set('jacuzzi_present', v)} />
        {form.jacuzzi_present && (
          <div>
            <label className={labelCls}>Jacuzzi Status</label>
            <select value={form.jacuzzi_status} onChange={e => set('jacuzzi_status', e.target.value)} className={select}>
              <option value="">—</option><option value="working">Working</option><option value="needs_repair">Needs Repair</option>
            </select>
          </div>
        )}
        <YesNo label="Tennis Court" value={form.tennis_court_present} onChange={v => set('tennis_court_present', v)} />
      </InspSection>

      {/* ══ INTERIOR ══ */}
      <InspSection title="Interior">

        <SubHeading>Bedrooms</SubHeading>
        <Counter
          value={form.bedrooms_quantity}
          onChange={v => { set('bedrooms_quantity', v); set('bedroom_sizes', resizeArr(form.bedroom_sizes, v)) }}
        />
        {form.bedrooms_quantity > 0 && (
          <div className="space-y-2 mt-2">
            {Array.from({ length: form.bedrooms_quantity }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-24 flex-shrink-0">Bedroom {i + 1}</span>
                <select value={form.bedroom_sizes[i] ?? ''} onChange={e => { const n = [...form.bedroom_sizes]; n[i] = e.target.value; set('bedroom_sizes', n) }} className={`${select} flex-1`}>
                  <option value="">Size…</option>
                  <option value="large">Large</option><option value="medium">Medium</option><option value="small">Small</option>
                </select>
              </div>
            ))}
          </div>
        )}

        <Divider />
        <SubHeading>Bathrooms</SubHeading>
        <Counter
          value={form.bathrooms_quantity}
          onChange={v => { set('bathrooms_quantity', v); set('bathroom_conditions', resizeArr(form.bathroom_conditions, v)) }}
        />
        {form.bathrooms_quantity > 0 && (
          <div className="space-y-2 mt-2">
            {Array.from({ length: form.bathrooms_quantity }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-24 flex-shrink-0">Bathroom {i + 1}</span>
                <select value={form.bathroom_conditions[i] ?? ''} onChange={e => { const n = [...form.bathroom_conditions]; n[i] = e.target.value; set('bathroom_conditions', n) }} className={`${select} flex-1`}>
                  <option value="">Condition…</option>
                  <option value="modern">Modern</option><option value="needs_work">Needs Work</option><option value="outdated">Outdated</option>
                </select>
              </div>
            ))}
          </div>
        )}

        <Divider />
        <SubHeading>Reception Rooms</SubHeading>
        <div className="grid grid-cols-2 gap-4">
          {([['kitchen_quantity','Kitchens'],['lounges_quantity','Lounges'],['dining_room_quantity','Dining Rooms'],['other_reception_quantity','Other Reception']] as const).map(([field, lbl]) => (
            <div key={field}>
              <label className={labelCls}>{lbl}</label>
              <Counter value={form[field]} onChange={v => set(field, v)} />
            </div>
          ))}
        </div>

        <Divider />
        <SubHeading>Study</SubHeading>
        <Counter
          value={form.study_quantity}
          onChange={v => { set('study_quantity', v); set('study_types', resizeArr(form.study_types, v)) }}
        />
        {form.study_quantity > 0 && (
          <div className="space-y-2 mt-2">
            {Array.from({ length: form.study_quantity }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-24 flex-shrink-0">Study {form.study_quantity > 1 ? i + 1 : ''}</span>
                <select value={form.study_types[i] ?? ''} onChange={e => { const n = [...form.study_types]; n[i] = e.target.value; set('study_types', n) }} className={`${select} flex-1`}>
                  <option value="">Type…</option>
                  <option value="nook">Nook</option><option value="separate_room">Separate Room</option>
                </select>
              </div>
            ))}
          </div>
        )}

        <Divider />
        <SubHeading>Domestic & Flatlet</SubHeading>
        <div>
          <label className={labelCls}>Domestic Quarters</label>
          <Counter value={form.domestic_quarters_quantity} onChange={v => set('domestic_quarters_quantity', v)} />
          {form.domestic_quarters_quantity > 0 && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
              <input type="checkbox" checked={form.domestic_quarters_toilet_only} onChange={e => set('domestic_quarters_toilet_only', e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-[#1a1a1a]" />
              <span className="text-sm text-gray-600">Toilet only (not a full room)</span>
            </label>
          )}
        </div>
        <div>
          <label className={labelCls}>Flatlet</label>
          <Counter
            value={form.flatlet_quantity}
            onChange={v => { set('flatlet_quantity', v); set('flatlet_bedroom_types', resizeArr(form.flatlet_bedroom_types, v)) }}
          />
          {form.flatlet_quantity > 0 && (
            <div className="mt-3 space-y-3">
              {Array.from({ length: form.flatlet_quantity }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-24 flex-shrink-0">Flatlet {form.flatlet_quantity > 1 ? i + 1 : ''}</span>
                  <select value={form.flatlet_bedroom_types[i] ?? ''} onChange={e => { const n = [...form.flatlet_bedroom_types]; n[i] = e.target.value; set('flatlet_bedroom_types', n) }} className={`${select} flex-1`}>
                    <option value="">Bedrooms…</option>
                    <option value="one_bed">1 Bedroom</option><option value="two_bed">2 Bedroom</option><option value="three_bed">3 Bedroom</option>
                  </select>
                </div>
              ))}
              <div>
                <label className={labelCls}>Flatlet Notes</label>
                <textarea value={form.flatlet_notes} onChange={e => set('flatlet_notes', e.target.value)} rows={2} className={`${input} resize-none`} />
              </div>
            </div>
          )}
        </div>

        <Divider />
        <SubHeading>Scullery / Laundry</SubHeading>
        <YesNo label="Scullery / Laundry" value={form.scullery_laundry_present} onChange={v => set('scullery_laundry_present', v)} />
        {form.scullery_laundry_present && (
          <div>
            <label className={labelCls}>Type</label>
            <select value={form.scullery_laundry_type} onChange={e => set('scullery_laundry_type', e.target.value)} className={select}>
              <option value="">—</option><option value="separated">Separated</option><option value="adjoined">Adjoined</option>
            </select>
          </div>
        )}

        <Divider />
        <SubHeading>Security</SubHeading>
        <YesNo label="Security" value={form.security_present} onChange={v => set('security_present', v)} />
        {form.security_present && (
          <div>
            <label className={labelCls}>Security Features</label>
            <MultiSelect options={SECURITY_OPTIONS} selected={form.security_features} onToggle={l => toggleStr('security_features', l)} />
          </div>
        )}

        <Divider />
        <SubHeading>General Condition</SubHeading>
        <p className="text-xs text-gray-400 -mt-2">Select items to rate, then choose Good or Poor for each.</p>
        <div className="space-y-3">
          {CONDITION_ITEMS.map(item => {
            const entry = form.general_condition.find(c => c.feature === item)
            const selected = !!entry
            return (
              <div key={item} className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={() => toggleConditionItem(item)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex-shrink-0 ${
                    selected ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]' : 'bg-white text-[#1a1a1a] border-gray-200 hover:border-gray-400'
                  }`}>
                  {item}
                </button>
                {selected && (
                  <div className="flex gap-2">
                    {(['Good','Poor'] as const).map(c => (
                      <button key={c} type="button" onClick={() => setConditionFeature(item, c.toLowerCase())}
                        className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                          entry.condition === c.toLowerCase()
                            ? c === 'Good' ? 'bg-green-600 text-white border-green-600' : 'bg-red-500 text-white border-red-500'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                        }`}>
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </InspSection>

      {/* ══ OTHER ══ */}
      <InspSection title="Other">
        <SubHeading>Additional Features</SubHeading>
        <MultiSelect options={ADDITIONAL_OPTS} selected={form.additional_features} onToggle={l => toggleStr('additional_features', l)} />
      </InspSection>

      {error && <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg">{error}</p>}

      <button onClick={handleSave} disabled={saving} className={`${btn.primary} w-full py-4`}>
        {saving ? 'Saving…' : saved ? '✓ Inspection Saved' : inspectionId ? 'Update Inspection' : 'Save Inspection'}
      </button>
    </div>
  )
}

// ── Inspection sub-components ─────────────────────────────────

function InspSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${card} p-6 space-y-4`}>
      <h3 className={sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide pt-1">{children}</p>
}

function Divider() {
  return <hr className="border-gray-100" />
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-[#1a1a1a]">{label}</span>
      <div className="flex gap-2">
        {([true, false] as const).map(v => (
          <button key={String(v)} type="button" onClick={() => onChange(value === v ? null : v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              value === v ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
            }`}>
            {v ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  )
}

function Counter({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))}
        className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-[#1a1a1a] transition-colors flex items-center justify-center text-lg font-medium">−</button>
      <span className="w-6 text-center text-sm font-semibold text-[#1a1a1a]">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)}
        className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-400 hover:text-[#1a1a1a] transition-colors flex items-center justify-center text-lg font-medium">+</button>
    </div>
  )
}

function MultiSelect({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (l: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button key={opt} type="button" onClick={() => onToggle(opt)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            selected.includes(opt) ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]' : 'bg-white text-[#1a1a1a] border-gray-200 hover:border-gray-400'
          }`}>
          {opt}
        </button>
      ))}
    </div>
  )
}
