'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeToE164 } from '@/lib/phone'
import { btn, card, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { useRouter, useSearchParams } from 'next/navigation'

const RELATIONSHIP_TYPES = [
  'Aunt', 'Brother', 'Business Partner', 'Contractor', 'Daughter',
  'Employee', 'Father', 'Grandfather', 'Grandmother', 'Landlord',
  'Managing Agent', 'Mother', 'Nephew', 'Niece', 'Partner',
  'Sister', 'Son', 'Spouse', 'Tenant', 'Uncle',
]

const EMPTY_FORM = {
  title: '', first_name: '', last_name: '', status: 'Active', phone_number: '', email_address: '',
  contact_preference: '', marital_status: '',
  occupation: '', company_name: '', division: '', branch: '',
  birthday: '', wedding_anniversary: '', home_anniversary: '',
  id_number: '', linked_contact_id: '', linked_contact_name: '', relationship_type: '',
}

function AddContactForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get('returnTo')
  const returnFor = searchParams.get('for')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [userId, setUserId]   = useState<string | null>(null)
  const [form, setForm]       = useState(EMPTY_FORM)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserId(data.user.id)
    })
  }, [router])

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function handleCancel() {
    if (returnTo) {
      router.push(`${returnTo}?resume=1`)
    } else {
      router.push('/dashboard/contacts')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.first_name.trim()) { setError('First name is required.'); return }
    if (!form.phone_number.trim()) { setError('Phone number is required.'); return }
    const normalizedPhone = normalizeToE164(form.phone_number)
    if (!normalizedPhone) { setError("That doesn't look like a valid phone number."); return }
    setError('')
    setSaving(true)

    const payload: Record<string, unknown> = {
      title: form.title || null,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      name: [form.first_name.trim(), form.last_name.trim()].filter(Boolean).join(' '),
      status: form.status || 'Active',
      phone_number: normalizedPhone, email_address: form.email_address || null,
      contact_preference: form.contact_preference || null,
      marital_status: form.marital_status || null, occupation: form.occupation || null,
      company_name: form.company_name || null, division: form.division || null,
      branch: form.branch || null,
      birthday: form.birthday || null, wedding_anniversary: form.wedding_anniversary || null,
      home_anniversary: form.home_anniversary || null, id_number: form.id_number || null,
      created_by: userId, agent_id: userId,
    }

    const { data: contact, error: insertError } = await supabase
      .from('contacts').insert(payload).select('id').single()

    if (insertError) {
      // Never surface a raw Postgres error to the agent -- translate the
      // ones we expect into plain language, and fall back to something
      // generic (not the driver's own wording) for anything else.
      const friendly = insertError.code === '23514' && insertError.message.includes('phone')
        ? "That phone number doesn't look valid. Double-check the digits and try again."
        : 'Something went wrong saving this contact. Please try again.'
      setError(friendly)
      setSaving(false)
      return
    }

    if (form.linked_contact_id && form.relationship_type && contact) {
      await supabase.from('contact_relationships').insert({
        contact_id: contact.id,
        linked_contact_id: form.linked_contact_id,
        relationship_type: form.relationship_type,
      })
    }

    if (returnTo && contact) {
      const name = [form.first_name.trim(), form.last_name.trim()].filter(Boolean).join(' ')
      const phoneParam = encodeURIComponent(form.phone_number)
      const emailParam = encodeURIComponent(form.email_address)
      router.push(`${returnTo}?newContactId=${contact.id}&newContactName=${encodeURIComponent(name)}&for=${returnFor ?? 'contact'}&phone=${phoneParam}&email=${emailParam}`)
      return
    }

    // Came straight from the Contacts records table (not the evaluation
    // flow above) -- go straight back to it instead of an intermediate
    // "contact saved" screen.
    router.push('/dashboard/contacts')
  }

  return (
    <div className="p-4 md:p-10 max-w-4xl">
      <Breadcrumbs items={returnTo
        ? [{ label: 'Analyse' }, { label: 'Evaluations', href: '/dashboard/evaluations' }, { label: 'Back to Evaluation', href: `${returnTo}?resume=1` }, { label: 'New Contact' }]
        : [{ label: 'Analyse' }, { label: 'Contacts', href: '/dashboard/contacts' }, { label: 'New Contact' }]
      } />
      <h1 className="text-lg sm:text-2xl font-bold text-[#1a1a1a] mb-8">New Contact</h1>
      <form onSubmit={handleSubmit} className="space-y-6">

          <Section title="Basic Information">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Title</label>
                <select value={form.title} onChange={e => set('title', e.target.value)} className={select}>
                  <option value="">—</option>
                  {['Mr', 'Mrs', 'Ms', 'Dr'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>First Name <span className="text-red-400">*</span></label>
                <input value={form.first_name} onChange={e => set('first_name', e.target.value)} placeholder="Jane" className={input} />
              </div>
              <div>
                <label className={labelCls}>Surname</label>
                <input value={form.last_name} onChange={e => set('last_name', e.target.value)} placeholder="Smith" className={input} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={select}>
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </div>
          </Section>

          <Section title="Contact Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Phone Number <span className="text-red-400">*</span></label>
                <input value={form.phone_number} onChange={e => set('phone_number', e.target.value)} placeholder="e.g. 083 123 4567" className={input} />
              </div>
              <div>
                <label className={labelCls}>Email Address</label>
                <input type="email" value={form.email_address} onChange={e => set('email_address', e.target.value)} placeholder="jane@example.com" className={input} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Contact Preference</label>
              <select value={form.contact_preference} onChange={e => set('contact_preference', e.target.value)} className={select}>
                <option value="">—</option>
                {['WhatsApp', 'Email', 'Phone'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </Section>

          <Section title="Personal Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Marital Status</label>
                <select value={form.marital_status} onChange={e => set('marital_status', e.target.value)} className={select}>
                  <option value="">—</option>
                  {['Single', 'Married', 'Divorced', 'Widowed', 'Separated'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>ID Number</label>
                <input value={form.id_number} onChange={e => set('id_number', e.target.value)} placeholder="SA ID number" className={input} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Birthday</label>
                <input type="date" value={form.birthday} onChange={e => set('birthday', e.target.value)} className={input} />
              </div>
              <div>
                <label className={labelCls}>Wedding Anniversary</label>
                <input type="date" value={form.wedding_anniversary} onChange={e => set('wedding_anniversary', e.target.value)} className={input} />
              </div>
              <div>
                <label className={labelCls}>Home Anniversary</label>
                <input type="date" value={form.home_anniversary} onChange={e => set('home_anniversary', e.target.value)} className={input} />
              </div>
            </div>
          </Section>

          <Section title="Work Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Occupation</label>
                <input value={form.occupation} onChange={e => set('occupation', e.target.value)} placeholder="e.g. Teacher" className={input} />
              </div>
              <div>
                <label className={labelCls}>Company Name</label>
                <input value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="e.g. ABC Pty Ltd" className={input} />
              </div>
              <div>
                <label className={labelCls}>Division</label>
                <input value={form.division} onChange={e => set('division', e.target.value)} placeholder="To be confirmed" className={input} />
              </div>
              <div>
                <label className={labelCls}>Branch</label>
                <input value={form.branch} onChange={e => set('branch', e.target.value)} placeholder="To be confirmed" className={input} />
              </div>
            </div>
          </Section>

          <Section title="Linked Contact (optional)">
            <p className="text-xs text-gray-400 -mt-1 mb-1">Link this contact to someone already in the database</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Related Contact</label>
                <ContactSearch
                  selectedName={form.linked_contact_name}
                  onSelect={(id, name) => setForm(f => ({ ...f, linked_contact_id: id, linked_contact_name: name }))}
                  onClear={() => setForm(f => ({ ...f, linked_contact_id: '', linked_contact_name: '', relationship_type: '' }))}
                />
              </div>
              <div>
                <label className={labelCls}>Relationship Type</label>
                <select value={form.relationship_type} onChange={e => set('relationship_type', e.target.value)}
                  disabled={!form.linked_contact_id} className={select}>
                  <option value="">—</option>
                  {RELATIONSHIP_TYPES.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </Section>

          {error && <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg">{error}</p>}

          <div className="flex gap-3">
            <button type="submit" disabled={saving} className={`${btn.primary} flex-1 py-4`}>
              {saving ? 'Saving contact…' : 'Save Contact'}
            </button>
            <button type="button" onClick={handleCancel} className={`${btn.secondary} flex-1`}>
              Cancel
            </button>
          </div>

      </form>
    </div>
  )
}

export default function AddContactPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f8f7f4]" />}>
      <AddContactForm />
    </Suspense>
  )
}

// ── Contact search combobox ────────────────────────────────

function ContactSearch({ selectedName, onSelect, onClear }: {
  selectedName: string
  onSelect: (id: string, name: string) => void
  onClear: () => void
}) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<{ id: string; first_name: string; last_name: string; title: string | null; created_by: string | null }[]>([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [profiles, setProfiles] = useState<{ id: string; full_name: string | null; email: string | null }[]>([])
  const containerRef          = useRef<HTMLDivElement>(null)

  // Different agents can each have their own contact for the same real
  // person -- fetched once so every result can show who captured it,
  // making it obvious which copy you're picking.
  useEffect(() => {
    supabase.from('profiles').select('id, full_name, email').then(({ data }) => setProfiles(data ?? []))
  }, [])

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
        .select('id, first_name, last_name, title, created_by')
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,name.ilike.%${query}%`)
        .order('first_name').limit(8)
      setResults(data ?? [])
      setOpen(true)
      setLoading(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  if (selectedName) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm">
        <span className="flex-1 text-[#1a1a1a]">{selectedName}</span>
        <button type="button" onClick={onClear} className="text-gray-400 hover:text-[#1a1a1a] text-lg leading-none transition-colors">×</button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text" value={query} onChange={e => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        placeholder="Type a name to search…"
        className={input}
      />
      {open && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 border-t-0 rounded-b-lg shadow-md max-h-60 overflow-y-auto">
          {loading && <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>}
          {!loading && results.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No contacts found</div>}
          {!loading && results.map(r => {
            const name = `${r.title ? r.title + ' ' : ''}${r.first_name} ${r.last_name}`.trim()
            const owner = profiles.find(p => p.id === r.created_by)
            const ownerName = owner?.full_name ?? owner?.email
            return (
              <button key={r.id} type="button"
                onMouseDown={() => { onSelect(r.id, name); setQuery(''); setOpen(false) }}
                className="w-full text-left px-4 py-2.5 text-sm text-[#1a1a1a] hover:bg-[#f8f7f4] border-b border-gray-100 last:border-b-0 transition-colors flex items-center justify-between gap-2">
                <span className="truncate">{name}</span>
                {ownerName && <span className="text-xs text-gray-400 flex-shrink-0">Captured by {ownerName}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Section wrapper ────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${card} p-6 space-y-4`}>
      <h3 className={sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}
