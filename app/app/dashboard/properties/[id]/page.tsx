'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { canDelete } from '@/lib/permissions'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'

type Property = {
  id: string
  property_type: string | null
  unit_number: string | null
  complex_or_building_name: string | null
  sectional_title_number: string | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  google_maps_url: string | null
  created_at: string
  created_by_user_id: string | null
}

type Profile = { id: string; full_name: string | null; email: string | null }

type LinkedEvaluation = { id: string; status: string; date_captured: string; scheduled_at: string | null }

const TYPE_LABELS: Record<string, string> = {
  freehold:        'Freehold',
  sectional_title: 'Sectional Title',
  vacant_land:     'Vacant Land',
}

const STATUS_COLOURS: Record<string, string> = {
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

// Heading format: unit + complex + suburb only — the full street address is
// kept separately below, and used for the Maps link.
function formatAddress(p: Property): string {
  const street = [p.street_number, p.street_name].filter(Boolean).join(' ')
  if (p.property_type === 'sectional_title' && p.unit_number) {
    const unit = [`Unit ${p.unit_number}`, p.complex_or_building_name ? capitalizeWords(p.complex_or_building_name) : null].filter(Boolean).join(' ')
    return [unit, p.suburb].filter(Boolean).join(', ')
  }
  return [street, p.suburb].filter(Boolean).join(', ') || p.city || 'Unknown address'
}

// The actual navigable street address -- a unit/complex name alone doesn't
// reliably geocode.
function mapQuery(p: Property): string {
  return [p.street_number, p.street_name, p.suburb, p.city].filter(Boolean).join(' ')
}

function mapsUrl(p: Property): string | null {
  if (p.google_maps_url) return p.google_maps_url
  const q = mapQuery(p)
  return q ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}` : null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function PropertyDetailPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string

  const [property, setProperty]       = useState<Property | null>(null)
  const [profiles, setProfiles]       = useState<Profile[]>([])
  const [evaluations, setEvaluations] = useState<LinkedEvaluation[]>([])
  const [userEmail, setUserEmail]     = useState<string | null>(null)
  const [deleting, setDeleting]       = useState(false)
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState<'info' | 'evaluations'>('info')
  const [editing, setEditing]         = useState(() => searchParams.get('edit') === '1')
  const [editForm, setEditForm]       = useState<Partial<Property>>({})
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState('')

  const fetchEvaluations = useCallback(async () => {
    const { data } = await supabase
      .from('evaluations').select('id, status, date_captured, scheduled_at')
      .eq('property_id', id).order('date_captured', { ascending: false })
    setEvaluations(data ?? [])
  }, [id])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserEmail(data.user.email ?? null)
    })
    supabase.from('properties').select('*').eq('id', id).single().then(({ data }) => {
      if (!data) { router.push('/dashboard/properties'); return }
      setProperty(data)
      setEditForm(data)
      setLoading(false)
    })
    supabase.from('profiles').select('id, full_name, email').then(({ data }) => setProfiles(data ?? []))
    fetchEvaluations()
  }, [id, router, fetchEvaluations])

  function setField(field: string, value: unknown) {
    setEditForm(f => ({ ...f, [field]: value }))
  }

  async function deleteProperty() {
    if (!confirm(`Delete ${formatAddress(property!)}? This cannot be undone.`)) return
    setDeleting(true)
    const { error } = await supabase.from('properties').delete().eq('id', id)
    if (error) {
      alert(error.code === '23503'
        ? "This property has evaluations linked to it and can't be deleted. Delete those evaluations first."
        : error.message)
      setDeleting(false)
      return
    }
    router.push('/dashboard/properties')
  }

  async function saveProperty() {
    setSaving(true); setSaveError('')
    const updated = {
      property_type:            editForm.property_type ?? null,
      unit_number:              editForm.unit_number || null,
      complex_or_building_name: editForm.complex_or_building_name || null,
      sectional_title_number:   editForm.property_type === 'sectional_title' ? (editForm.sectional_title_number || null) : null,
      street_number:            editForm.street_number || null,
      street_name:              editForm.street_name || null,
      suburb:                   editForm.suburb || null,
      city:                     editForm.city || null,
      province:                 editForm.province || null,
      postal_code:              editForm.postal_code || null,
      country:                  editForm.country || null,
    }
    const { error } = await supabase.from('properties').update(updated).eq('id', id)
    if (error) { setSaveError(error.message); setSaving(false); return }
    setProperty({ ...property!, ...updated })
    setEditing(false); setSaving(false)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  if (!property) return null

  const address    = formatAddress(property)
  const mapsLink   = mapsUrl(property)
  const capturedBy = profiles.find(p => p.id === property.created_by_user_id)

  return (
    <div className="p-10 max-w-4xl">

      {/* ── Header ── */}
      <div className="mb-8">
        <Breadcrumbs items={[{ label: 'Analyse' }, { label: 'Properties', href: '/dashboard/properties' }, { label: address }]} />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-[#1a1a1a] truncate" title={address}>{address}</h1>
              {property.property_type && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium flex-shrink-0">
                  {TYPE_LABELS[property.property_type] ?? property.property_type}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400 mt-1">Added {formatDate(property.created_at)}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {mapsLink && (
              <a href={mapsLink} target="_blank" rel="noopener noreferrer" className={`${btn.primary} whitespace-nowrap`}>
                View Maps
              </a>
            )}
            {!editing && (
              <button onClick={() => { setEditing(true); setEditForm(property) }} className={`${btn.secondary} whitespace-nowrap`}>Edit</button>
            )}
            {canDelete(userEmail) && (
              <button onClick={deleteProperty} disabled={deleting} className={`${btn.danger} whitespace-nowrap`}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { key: 'info',        label: 'Details' },
          { key: 'evaluations', label: 'Evaluations' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-[#1a1a1a] text-[#1a1a1a]' : 'border-transparent text-gray-400 hover:text-[#1a1a1a]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── DETAILS / EDIT (same layout either way) ── */}
      {tab === 'info' && (
        <div className="space-y-6">
          <Section title="Property Type">
            <Field label="Type" editing={editing} value={property.property_type ? (TYPE_LABELS[property.property_type] ?? property.property_type) : undefined}>
              <select value={editForm.property_type ?? ''} onChange={e => setField('property_type', e.target.value || null)} className={select}>
                <option value="">—</option>
                <option value="freehold">Freehold</option>
                <option value="sectional_title">Sectional Title</option>
                <option value="vacant_land">Vacant Land</option>
              </select>
            </Field>
            {editForm.property_type === 'sectional_title' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Unit Number" editing={editing} value={property.unit_number}>
                  <input value={editForm.unit_number ?? ''} onChange={e => setField('unit_number', e.target.value || null)} className={input} />
                </Field>
                <Field label="Complex / Building Name" editing={editing} value={property.complex_or_building_name ? capitalizeWords(property.complex_or_building_name) : null}>
                  <input value={editForm.complex_or_building_name ?? ''} onChange={e => setField('complex_or_building_name', e.target.value || null)} className={input} />
                </Field>
              </div>
            )}
            {editForm.property_type === 'sectional_title' && (
              <Field label="Sectional Title Number" editing={editing} value={property.sectional_title_number}>
                <input value={editForm.sectional_title_number ?? ''} onChange={e => setField('sectional_title_number', e.target.value || null)} className={input} />
              </Field>
            )}
          </Section>

          <Section title="Address">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Street Number" editing={editing} value={property.street_number}>
                <input value={editForm.street_number ?? ''} onChange={e => setField('street_number', e.target.value || null)} className={input} />
              </Field>
              <Field label="Street Name" editing={editing} value={property.street_name}>
                <input value={editForm.street_name ?? ''} onChange={e => setField('street_name', e.target.value || null)} className={input} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Suburb" editing={editing} value={property.suburb}>
                <input value={editForm.suburb ?? ''} onChange={e => setField('suburb', e.target.value || null)} className={input} />
              </Field>
              <Field label="City" editing={editing} value={property.city}>
                <input value={editForm.city ?? ''} onChange={e => setField('city', e.target.value || null)} className={input} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Province" editing={editing} value={property.province}>
                <input value={editForm.province ?? ''} onChange={e => setField('province', e.target.value || null)} className={input} />
              </Field>
              <Field label="Postal Code" editing={editing} value={property.postal_code}>
                <input value={editForm.postal_code ?? ''} onChange={e => setField('postal_code', e.target.value || null)} className={input} />
              </Field>
            </div>
            <Field label="Country" editing={editing} value={property.country}>
              <input value={editForm.country ?? ''} onChange={e => setField('country', e.target.value || null)} className={input} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date Added" editing={false} value={formatDate(property.created_at)} />
              <Field label="Captured By" editing={false} value={capturedBy?.full_name ?? capturedBy?.email} />
            </div>
          </Section>

          {editing && saveError && <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg">{saveError}</p>}

          {editing && (
            <div className="flex gap-3">
              <button onClick={saveProperty} disabled={saving} className={`${btn.primary} flex-1 py-3`}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => { setEditing(false); setEditForm(property) }} className={`${btn.secondary} flex-1 py-3`}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── EVALUATIONS TAB ── */}
      {tab === 'evaluations' && (
        <div className="space-y-3">
          {evaluations.length === 0 ? (
            <div className={`${card} p-12 text-center`}>
              <p className="text-gray-400 text-sm">No evaluations for this property yet.</p>
            </div>
          ) : evaluations.map(ev => (
            <Link key={ev.id} href={`/dashboard/evaluations/${ev.id}`}
              className={`${card} flex items-center justify-between px-5 py-4 gap-4 hover:bg-gray-50 transition-colors`}>
              <div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOURS[ev.status] ?? 'bg-gray-100 text-gray-500'}`}>
                  {STATUS_LABELS[ev.status] ?? ev.status}
                </span>
                <p className="text-xs text-gray-400 mt-1.5">Captured {formatDate(ev.date_captured)}</p>
              </div>
              <span className="text-sm font-medium text-[#1a1a1a]">View →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Reusable components ────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${card} p-6 space-y-4`}>
      <h3 className={sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

// ── Field: same label-above-content layout either way — plain text (no
// box) when not editing, the actual editable control once Edit is clicked.
function Field({ label, editing, value, children }: { label: string; editing: boolean; value?: React.ReactNode; children?: React.ReactNode }) {
  if (!editing) {
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
