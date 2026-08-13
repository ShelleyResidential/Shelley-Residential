'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { canDelete } from '@/lib/permissions'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { EvaluationForm } from '../EvaluationForm'
import { REPORT_TYPES } from '@/lib/evaluation-documents'
import {
  STATUS_LABELS, STATUS_COLOURS, stepLabel, stepOwnerRole, canActOnRole,
  markStepComplete, promoteStatus, checkPreparedGate, checkPresentationReadyGate,
} from '@/lib/pipeline'

// ── Types ─────────────────────────────────────────────────────
type Property = {
  id: string; property_type: string | null
  unit_number: string | null; complex_or_building_name: string | null
  street_number: string | null; street_name: string | null
  suburb: string | null; city: string | null; province: string | null
  postal_code: string | null; google_maps_url: string | null
  latitude: number | null; longitude: number | null
}

type PipelineStep = {
  id: string; step_key: string; is_complete: boolean; status: string
  owner_role: string | null; due_date: string | null; created_at: string | null
  completed_at: string | null; completed_by_user_id: string | null; sort_order: number
}

type PipelineProfile = { full_name: string | null; email: string | null; designation: string | null }

type Evaluation = {
  id: string; status: string; date_captured: string
  scheduled_at: string | null; calendar_event_link: string | null
  properties: Property | null
  evaluation_pipeline_steps: PipelineStep[]
}

// ── Helpers ───────────────────────────────────────────────────
function capitalizeWords(text: string): string {
  return text.replace(/\b\w/g, c => c.toUpperCase())
}

// Heading format: unit + complex + suburb only — the full street address
// (kept separately in Property Details) would make the page title unwieldy.
function formatAddress(p: Property | null): string {
  if (!p) return 'Unknown address'
  const street = [p.street_number, p.street_name].filter(Boolean).join(' ')
  if (p.property_type === 'sectional_title' && p.unit_number) {
    const unit = [`Unit ${p.unit_number}`, p.complex_or_building_name ? capitalizeWords(p.complex_or_building_name) : null].filter(Boolean).join(' ')
    return [unit, p.suburb].filter(Boolean).join(', ')
  }
  return [street, p.suburb].filter(Boolean).join(', ') || p.city || 'Unknown address'
}

// ── Page ──────────────────────────────────────────────────────
export default function EvaluationDetailPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string

  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState<'details' | 'documents' | 'inspection' | 'pipeline'>('details')
  const [userId, setUserId]         = useState<string | null>(null)
  const [userEmail, setUserEmail]   = useState<string | null>(null)
  const [userDesignation, setUserDesignation] = useState<string | null>(null)
  const [editing, setEditing]       = useState(() => searchParams.get('edit') === '1' || searchParams.get('newContactId') !== null)
  const [deleting, setDeleting]     = useState(false)
  // Looked up separately rather than embedded via a PostgREST relationship
  // join -- completed_by_user_id has no foreign key constraint, so an
  // embed there 400s the whole query. Same pattern the rest of the app
  // already uses for user references (evaluations list, EvaluationForm).
  const [profiles, setProfiles]     = useState<Record<string, PipelineProfile>>({})

  const fetchEvaluation = useCallback(async () => {
    const { data } = await supabase
      .from('evaluations')
      .select(`
        id, status, date_captured, scheduled_at, calendar_event_link,
        properties (id, property_type, unit_number, complex_or_building_name,
          street_number, street_name, suburb, city, province, postal_code,
          google_maps_url, latitude, longitude),
        evaluation_pipeline_steps (
          id, step_key, is_complete, status, owner_role, due_date, created_at, completed_at, completed_by_user_id, sort_order
        )
      `)
      .eq('id', id)
      .single()

    if (data) {
      setEvaluation(data as unknown as Evaluation)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, email, designation').then(({ data }) => {
      const map: Record<string, PipelineProfile> = {}
      for (const p of (data ?? []) as { id: string; full_name: string | null; email: string | null; designation: string | null }[]) {
        map[p.id] = { full_name: p.full_name, email: p.email, designation: p.designation }
      }
      setProfiles(map)
    })
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserId(data.user.id)
      setUserEmail(data.user.email ?? null)
      supabase.from('profiles').select('designation').eq('id', data.user.id).single()
        .then(({ data: profile }) => setUserDesignation(profile?.designation ?? null))
    })
    fetchEvaluation()
  }, [router, fetchEvaluation])

  async function deleteEvaluation() {
    if (!confirm('Delete this evaluation? This cannot be undone.')) return
    setDeleting(true)
    const { error: err } = await supabase.from('evaluations').delete().eq('id', id)
    if (err) { alert(err.message); setDeleting(false); return }
    router.push('/dashboard/evaluations')
  }

  // Single-step gates -- completing these steps directly promotes status,
  // matching their 1:1 mapping in the Status Model. (evaluation_closed is
  // deliberately excluded: closing always goes through the Details tab's
  // Evaluation Outcome field, which also captures Won/Lost/Cancelled --
  // toggling it here alone would leave that outcome unrecorded.)
  const SINGLE_STEP_STATUS: Record<string, string> = {
    property_inspected: 'inspected', cma_approved: 'evaluated', presentation_completed: 'presented',
  }

  // These three complete purely as a side effect of another action --
  // creating the evaluation, a successful calendar sync, the required
  // fields all being filled in -- never a direct click in the Pipeline
  // tab, for anyone, regardless of role.
  const AUTO_ONLY_STEPS = ['captured', 'scheduled', 'evaluation_form_completed']

  async function togglePipelineStep(stepId: string, stepKey: string, currentlyComplete: boolean) {
    if (!userId) return
    if (AUTO_ONLY_STEPS.includes(stepKey)) return
    if (!canActOnRole(userDesignation, stepOwnerRole(stepKey))) return

    if (currentlyComplete) {
      // Un-completing is a plain rollback -- never demotes the evaluation's
      // status, since other steps may already depend on having moved past it.
      await supabase.from('evaluation_pipeline_steps').update({
        status: 'pending', is_complete: false, completed_at: null, completed_by_user_id: null,
      }).eq('id', stepId)
    } else {
      await markStepComplete(id, stepKey, userId)
      if (SINGLE_STEP_STATUS[stepKey]) await promoteStatus(id, SINGLE_STEP_STATUS[stepKey])
      await checkPreparedGate(id)
      await checkPresentationReadyGate(id)
    }
    fetchEvaluation()
  }

  if (loading) return <div className="p-10 text-gray-400 text-sm">Loading…</div>
  if (!evaluation) return <div className="p-10 text-gray-400 text-sm">Evaluation not found.</div>

  const ev = evaluation
  const address = formatAddress(ev.properties)
  const sortedSteps    = [...(ev.evaluation_pipeline_steps ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  const stepsComplete  = sortedSteps.filter(s => s.status === 'complete' || s.is_complete).length
  const dateStr = new Date(ev.date_captured).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="p-10 max-w-4xl">

      <Link href="/dashboard/evaluations/new" className={`${btn.primary} fixed top-8 right-10 z-40 shadow-md`}>+ New Evaluation</Link>

      {/* ── Header ── */}
      <div className="mb-8">
        <Breadcrumbs items={[{ label: 'Analyse' }, { label: 'Evaluations', href: '/dashboard/evaluations' }, { label: address }]} />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[#1a1a1a] truncate" title={address}>{address}</h1>
            <p className="text-sm text-gray-400 mt-1">Captured {dateStr}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className={`text-sm px-3 py-1 rounded-full font-medium whitespace-nowrap ${STATUS_COLOURS[ev.status] ?? 'bg-gray-100 text-gray-500'}`}>
              {STATUS_LABELS[ev.status] ?? ev.status}
            </span>
            {!editing && (
              <button onClick={() => { setActiveTab('details'); setEditing(true) }} className={`${btn.secondary} whitespace-nowrap`}>Edit</button>
            )}
            {canDelete(userEmail) && (
              <button onClick={deleteEvaluation} disabled={deleting} className={`${btn.danger} whitespace-nowrap`}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { key: 'details',    label: 'Details' },
          { key: 'documents',  label: 'Documents' },
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
          <EvaluationForm
            evaluationId={id}
            readOnly={!editing}
            calendarEventLink={ev.calendar_event_link}
            onSaved={() => { setEditing(false); fetchEvaluation() }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}

      {/* ── Documents tab ── */}
      {activeTab === 'documents' && (
        <DocumentsTab
          evaluationId={id} userId={userId} propertyType={ev.properties?.property_type ?? null}
          pipelineSteps={ev.evaluation_pipeline_steps} userDesignation={userDesignation}
          onStepChanged={fetchEvaluation}
        />
      )}

      {/* ── Inspection tab ── */}
      {activeTab === 'inspection' && (
        <InspectionTab evaluationId={id} userDesignation={userDesignation} onSaved={fetchEvaluation} />
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
              className="bg-[#E8266F] h-2 rounded-full transition-all"
              style={{ width: `${sortedSteps.length > 0 ? (stepsComplete / sortedSteps.length) * 100 : 0}%` }}
            />
          </div>

          <div className="space-y-3">
            {sortedSteps.map((step, i) => {
              const complete       = step.status === 'complete' || step.is_complete
              const completedBy    = step.completed_by_user_id ? profiles[step.completed_by_user_id] : null
              // Derived from the step key via the code's own catalogue rather
              // than the DB row's owner_role column -- evaluations created
              // before this pipeline rebuild have that column as null.
              const ownerRole      = stepOwnerRole(step.step_key)
              const autoOnly       = AUTO_ONLY_STEPS.includes(step.step_key)
              const canAct         = !autoOnly && canActOnRole(userDesignation, ownerRole)
              const overdue        = !complete && step.due_date && new Date(step.due_date) < new Date()
              return (
                <div key={step.id} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => togglePipelineStep(step.id, step.step_key, complete)}
                    disabled={!canAct}
                    title={autoOnly
                      ? 'Completes automatically -- not manually toggleable'
                      : !canAct ? `Only ${ownerRole === 'tc' ? 'a Transaction Coordinator' : ownerRole === 'cma_approver' ? 'a CMA Approver' : 'an Agent'} can toggle this step` : undefined}
                    className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                      complete
                        ? 'bg-[#1a1a1a] border-[#1a1a1a] text-white'
                        : 'border-gray-300 hover:border-gray-500'
                    } ${!canAct ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {complete && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>

                  <div className="flex-1">
                    <p className={`text-sm font-medium ${complete ? 'text-[#1a1a1a]' : 'text-gray-400'}`}>
                      {i + 1}. {stepLabel(step.step_key)}
                    </p>
                    {complete && step.completed_at ? (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Captured by {completedBy?.full_name ?? completedBy?.email ?? '—'}
                        {completedBy?.designation && ` | ${completedBy.designation}`}
                        {' · '}{new Date(step.completed_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    ) : step.due_date ? (
                      <p className={`text-xs mt-0.5 ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                        Due {new Date(step.due_date).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                        {overdue ? ' (overdue)' : ''}
                      </p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── DocumentsTab ─────────────────────────────────────────────
type EvaluationDocument = {
  id: string
  report_type: string
  file_name: string
  uploaded_at: string
}

function DocumentsTab({ evaluationId, userId, propertyType, pipelineSteps, userDesignation, onStepChanged }: {
  evaluationId: string; userId: string | null; propertyType: string | null
  pipelineSteps: PipelineStep[]; userDesignation: string | null
  onStepChanged: () => void
}) {
  // Sectional titles get an SS (Sectional Scheme) report; freehold and
  // vacant land don't have one to upload.
  const visibleReportTypes = propertyType === 'sectional_title'
    ? REPORT_TYPES
    : REPORT_TYPES.filter(rt => rt.key !== 'ss_report')

  const [documents, setDocuments]         = useState<EvaluationDocument[]>([])
  const [loading, setLoading]             = useState(true)
  const [uploadingType, setUploadingType] = useState<string | null>(null)
  const [error, setError]                 = useState('')

  const canTC = canActOnRole(userDesignation, 'tc')
  const step  = (key: string) => pipelineSteps.find(s => s.step_key === key)
  const evaluationPackComplete = step('evaluation_pack_prepared')?.status === 'complete'
  const mandatePackComplete    = step('mandate_pack_prepared')?.status === 'complete'

  const fetchDocuments = useCallback(async () => {
    const { data } = await supabase
      .from('evaluation_documents')
      .select('id, report_type, file_name, uploaded_at')
      .eq('evaluation_id', evaluationId)
    setDocuments(data ?? [])
    setLoading(false)
  }, [evaluationId])

  useEffect(() => { fetchDocuments() }, [fetchDocuments])

  async function handleUpload(reportType: string, file: File) {
    if (!userId) return
    setUploadingType(reportType)
    setError('')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('report_type', reportType)
    formData.append('user_id', userId)

    const res = await fetch(`/api/evaluations/${evaluationId}/documents`, { method: 'POST', body: formData })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Upload failed.')
    } else {
      await fetchDocuments()

      // "Transfer Reports Uploaded" only completes once every report this
      // property type needs is actually on file.
      const { data: docsNow } = await supabase.from('evaluation_documents')
        .select('report_type').eq('evaluation_id', evaluationId)
      const uploadedTypes = new Set((docsNow ?? []).map(d => d.report_type))
      if (visibleReportTypes.every(rt => uploadedTypes.has(rt.key))) {
        await markStepComplete(evaluationId, 'lightstone_uploaded', userId)
        await checkPreparedGate(evaluationId)
        onStepChanged()
      }
    }
    setUploadingType(null)
  }

  async function toggleManualStep(stepKey: string, currentlyComplete: boolean, gate: 'prepared' | 'presentation_ready') {
    if (!userId || !canTC) return
    if (currentlyComplete) {
      await supabase.from('evaluation_pipeline_steps').update({
        status: 'pending', is_complete: false, completed_at: null, completed_by_user_id: null,
      }).eq('evaluation_id', evaluationId).eq('step_key', stepKey)
    } else {
      await markStepComplete(evaluationId, stepKey, userId)
      if (gate === 'prepared') await checkPreparedGate(evaluationId)
      else await checkPresentationReadyGate(evaluationId)
    }
    onStepChanged()
  }

  if (loading) return <div className="text-center py-16 text-gray-400 text-sm">Loading documents…</div>

  return (
    <>
    <div className={`${card} p-6`}>
      <h3 className={sectionTitle}>Transfer Reports</h3>

      {error && <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg mb-4">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {visibleReportTypes.map(rt => {
          const doc       = documents.find(d => d.report_type === rt.key)
          const uploading = uploadingType === rt.key
          return (
            <div key={rt.key} className="border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
              <h4 className="text-sm font-bold text-[#1a1a1a]">{rt.label}</h4>
              {doc ? (
                <>
                  <p className="text-xs text-gray-500 truncate" title={doc.file_name}>{doc.file_name}</p>
                  <div className="flex gap-2">
                    <a href={`/api/documents/${doc.id}/download`} className={`${btn.primary} flex-1 text-center`}>
                      Download
                    </a>
                    <label className={`${btn.secondary} flex-1 text-center cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                      {uploading ? 'Uploading…' : 'Replace'}
                      <input type="file" className="hidden"
                        onChange={e => e.target.files?.[0] && handleUpload(rt.key, e.target.files[0])} />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-400">No file uploaded yet.</p>
                  <label className={`${btn.primary} text-center cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploading ? 'Uploading…' : '+ Upload'}
                    <input type="file" className="hidden"
                      onChange={e => e.target.files?.[0] && handleUpload(rt.key, e.target.files[0])} />
                  </label>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>

    <div className={`${card} p-6 mt-6`}>
      <h3 className={sectionTitle}>Evaluation Pack</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CoverLetterCard
          evaluationId={evaluationId}
          userId={userId}
          doc={documents.find(d => d.report_type === 'cover_letter')}
          onGenerated={fetchDocuments}
        />
        <ManualCompleteCard
          title="Mark Complete"
          complete={evaluationPackComplete}
          canAct={canTC}
          onToggle={() => toggleManualStep('evaluation_pack_prepared', evaluationPackComplete, 'prepared')}
        />
      </div>
    </div>

    {/* Placeholder -- the actual upload/generation feature for this comes
        later; for now it's just a TC-owned manual completion gate, same
        mechanism as the Evaluation Pack above. */}
    <div className={`${card} p-6 mt-6`}>
      <h3 className={sectionTitle}>Mandate Pack</h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ManualCompleteCard
          title="Mark Complete"
          complete={mandatePackComplete}
          canAct={canTC}
          onToggle={() => toggleManualStep('mandate_pack_prepared', mandatePackComplete, 'presentation_ready')}
        />
      </div>
    </div>
    </>
  )
}

// A simple TC-owned "confirm complete" card -- shared by the Evaluation
// Pack and Mandate Pack sections, which are both Manual completion mode
// per the Workflow Tasks doc (no auto-derivation from underlying data).
function ManualCompleteCard({ title, complete, canAct, onToggle }: {
  title: string; complete: boolean; canAct: boolean; onToggle: () => void
}) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
      <h4 className="text-sm font-bold text-[#1a1a1a]">{title}</h4>
      <p className="text-xs text-gray-400">{complete ? 'Confirmed complete.' : 'Not yet confirmed.'}</p>
      <button type="button" onClick={onToggle} disabled={!canAct}
        title={!canAct ? 'Only a Transaction Coordinator can confirm this' : undefined}
        className={`${complete ? btn.secondary : btn.primary} text-center disabled:opacity-40 disabled:cursor-not-allowed`}>
        {complete ? 'Undo' : 'Confirm Complete'}
      </button>
    </div>
  )
}

// A card that generates its own file server-side instead of taking an
// upload -- same look as the Transfer Report cards, but Generate/
// Regenerate instead of Upload/Replace.
function CoverLetterCard({ evaluationId, userId, doc, onGenerated }: {
  evaluationId: string
  userId: string | null
  doc: EvaluationDocument | undefined
  onGenerated: () => void
}) {
  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState('')

  async function generate() {
    if (!userId) return
    setGenerating(true)
    setError('')
    const res = await fetch(`/api/evaluations/${evaluationId}/cover-letter`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Generation failed.')
    } else {
      onGenerated()
    }
    setGenerating(false)
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 flex flex-col gap-3">
      <h4 className="text-sm font-bold text-[#1a1a1a]">Cover Letter</h4>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {doc ? (
        <>
          <p className="text-xs text-gray-500 truncate" title={doc.file_name}>{doc.file_name}</p>
          <div className="flex gap-2">
            <a href={`/api/documents/${doc.id}/download`} className={`${btn.primary} flex-1 text-center`}>
              Download
            </a>
            <button type="button" onClick={generate} disabled={generating}
              className={`${btn.secondary} flex-1 ${generating ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {generating ? 'Regenerating…' : 'Regenerate'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-400">Not generated yet.</p>
          <button type="button" onClick={generate} disabled={generating}
            className={`${btn.primary} ${generating ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </>
      )}
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
  // Appointment Outcome -- the Status Model's gate for "Inspected"
  appointment_outcome: string
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
  appointment_outcome: '',
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

const APPOINTMENT_OUTCOMES = [
  { value: 'completed',            label: 'Completed' },
  { value: 'no_show',              label: 'No Show' },
  { value: 'unable_to_complete',   label: 'Unable to Complete' },
]

function InspectionTab({ evaluationId, userDesignation, onSaved }: { evaluationId: string; userDesignation: string | null; onSaved: () => void }) {
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
            appointment_outcome:           data.appointment_outcome ?? '',
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
      appointment_outcome:           form.appointment_outcome || null,
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

      // "Property Inspection Completed" only actually completes -- and
      // advances the evaluation to Inspected -- once the Appointment
      // Outcome says the visit happened. No Show / Unable to Complete
      // route back to scheduling instead of moving the pipeline forward.
      if (form.appointment_outcome === 'completed') {
        await markStepComplete(evaluationId, 'property_inspected', userId)
        await promoteStatus(evaluationId, 'inspected')
      } else if (form.appointment_outcome === 'no_show' || form.appointment_outcome === 'unable_to_complete') {
        await supabase.from('evaluations').update({ status: 'scheduled' }).eq('id', evaluationId)
      }
    }

    setSaved(true)
    setSaving(false)
    onSaved()
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return <div className="text-center py-16 text-gray-400 text-sm">Loading inspection…</div>

  return (
    <div className="space-y-6">

      {/* ══ APPOINTMENT OUTCOME -- gates the "Inspected" status ══ */}
      <InspSection title="Appointment Outcome">
        <div>
          <label className={labelCls}>Outcome</label>
          <select value={form.appointment_outcome} onChange={e => set('appointment_outcome', e.target.value)} className={select}>
            <option value="">—</option>
            {APPOINTMENT_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {(form.appointment_outcome === 'no_show' || form.appointment_outcome === 'unable_to_complete') && (
            <p className="text-xs text-gray-400 mt-2">Saving will move this evaluation back to Scheduled.</p>
          )}
        </div>
      </InspSection>

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
      {!canActOnRole(userDesignation, 'agent') && (
        <p className="text-xs text-gray-400 text-center">Only an Agent can save the Property Inspection.</p>
      )}

      <button onClick={handleSave} disabled={saving || !canActOnRole(userDesignation, 'agent')}
        className={`${btn.primary} w-full py-4 disabled:opacity-40 disabled:cursor-not-allowed`}>
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
