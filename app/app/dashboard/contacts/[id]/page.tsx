'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { canDelete } from '@/lib/permissions'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'

type Contact = {
  id: string
  title: string | null
  first_name: string
  last_name: string
  status: string
  phone_number: string | null
  email_address: string | null
  contact_preference: string | null
  marital_status: string | null
  occupation: string | null
  company_name: string | null
  division: string | null
  branch: string | null
  birthday: string | null
  wedding_anniversary: string | null
  home_anniversary: string | null
  id_number: string | null
  date_added: string
  created_by: string | null
}

type Profile = { id: string; full_name: string | null; email: string | null }

type Note = { id: string; note_text: string; created_at: string; last_edited_at: string }
type NoteHistory = { id: string; note_text: string; edited_at: string }

function fullName(c: Pick<Contact, 'first_name' | 'last_name'>) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ')
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) > 1 ? 's' : ''} ago`
  return formatDate(iso)
}

export default function ContactDetailPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string

  const [contact, setContact]         = useState<Contact | null>(null)
  const [profiles, setProfiles]       = useState<Profile[]>([])
  const [userId, setUserId]           = useState<string | null>(null)
  const [userEmail, setUserEmail]     = useState<string | null>(null)
  const [deleting, setDeleting]       = useState(false)
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState<'info' | 'notes'>('info')
  const [editing, setEditing]         = useState(() => searchParams.get('edit') === '1')
  const [editForm, setEditForm]       = useState<Partial<Contact>>({})
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState('')
  const [notes, setNotes]             = useState<Note[]>([])
  const [newNote, setNewNote]         = useState('')
  const [addingNote, setAddingNote]   = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteText, setEditNoteText]   = useState('')
  const [noteHistory, setNoteHistory]     = useState<Record<string, NoteHistory[]>>({})
  const [showHistoryFor, setShowHistoryFor] = useState<string | null>(null)

  const fetchNotes = useCallback(async () => {
    const { data } = await supabase
      .from('contact_notes').select('id, note_text, created_at, last_edited_at')
      .eq('contact_id', id).order('created_at', { ascending: false })
    setNotes(data ?? [])
  }, [id])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserId(data.user.id)
      setUserEmail(data.user.email ?? null)
    })
    supabase.from('contacts').select('*').eq('id', id).single().then(({ data }) => {
      if (!data) { router.push('/dashboard/contacts'); return }
      setContact(data)
      setEditForm(data)
      setLoading(false)
    })
    supabase.from('profiles').select('id, full_name, email').then(({ data }) => setProfiles(data ?? []))
    fetchNotes()
  }, [id, router, fetchNotes])

  function setField(field: string, value: unknown) {
    setEditForm(f => ({ ...f, [field]: value }))
  }

  async function deleteContact() {
    if (!confirm(`Delete ${fullName(contact!)}? This cannot be undone.`)) return
    setDeleting(true)
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) {
      alert(error.code === '23503'
        ? "This contact is linked to one or more evaluations and can't be deleted. Delete those evaluations first."
        : error.message)
      setDeleting(false)
      return
    }
    router.push('/dashboard/contacts')
  }

  async function saveContact() {
    setSaving(true); setSaveError('')
    const updated = {
      ...editForm,
      name: [editForm.first_name, editForm.last_name].filter(Boolean).join(' '),
    }
    const { error } = await supabase.from('contacts').update(updated).eq('id', id)
    if (error) { setSaveError(error.message); setSaving(false); return }
    setContact({ ...contact!, ...updated } as Contact)
    setEditing(false); setSaving(false)
  }

  async function addNote() {
    if (!newNote.trim() || !userId) return
    setAddingNote(true)
    await supabase.from('contact_notes').insert({ contact_id: id, agent_id: userId, note_text: newNote.trim() })
    setNewNote(''); await fetchNotes(); setAddingNote(false)
  }

  async function saveNoteEdit(noteId: string) {
    if (!editNoteText.trim()) return
    await supabase.from('contact_notes').update({ note_text: editNoteText.trim() }).eq('id', noteId)
    setEditingNoteId(null); await fetchNotes()
  }

  async function deleteNote(noteId: string) {
    if (!confirm('Delete this note? This cannot be undone.')) return
    await supabase.from('contact_notes').delete().eq('id', noteId)
    await fetchNotes()
  }

  async function loadHistory(noteId: string) {
    if (showHistoryFor === noteId) { setShowHistoryFor(null); return }
    const { data } = await supabase.from('contact_note_history')
      .select('id, note_text, edited_at').eq('note_id', noteId).order('edited_at', { ascending: false })
    setNoteHistory(h => ({ ...h, [noteId]: data ?? [] }))
    setShowHistoryFor(noteId)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Loading…</div>
  if (!contact) return null

  return (
    <div className="p-10 max-w-4xl">

      <Link href="/dashboard/contacts/new" className={`${btn.primary} fixed top-8 right-10 z-40 shadow-md`}>+ New Contact</Link>

      {/* ── Header ── */}
      <div className="mb-8">
        <Breadcrumbs items={[{ label: 'Analyse' }, { label: 'Contacts', href: '/dashboard/contacts' }, { label: fullName(contact) }]} />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[#1a1a1a] truncate" title={fullName(contact)}>{fullName(contact)}</h1>
            <p className="text-sm text-gray-400 mt-1">Added {formatDate(contact.date_added)}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className={`text-sm px-3 py-1 rounded-full font-medium whitespace-nowrap ${
              contact.status === 'Active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>{contact.status}</span>
            {!editing && (
              <button onClick={() => { setEditing(true); setEditForm(contact) }} className={btn.secondary}>Edit</button>
            )}
            {canDelete(userEmail) && (
              <button onClick={deleteContact} disabled={deleting} className={btn.danger}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['info', 'notes'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-[#1a1a1a] text-[#1a1a1a]' : 'border-transparent text-gray-400 hover:text-[#1a1a1a]'
            }`}>
            {t === 'notes' ? 'Notes' : 'Details'}
          </button>
        ))}
      </div>

        {/* ── DETAILS / EDIT (same layout either way) ── */}
        {tab === 'info' && (
          <div className="space-y-6">
            <Section title="Basic Information">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Title" editing={editing} value={contact.title}>
                  <select value={editForm.title ?? ''} onChange={e => setField('title', e.target.value || null)} className={select}>
                    <option value="">—</option>
                    {['Mr', 'Mrs', 'Ms', 'Dr'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="First Name" editing={editing} value={contact.first_name}>
                  <input value={editForm.first_name ?? ''} onChange={e => setField('first_name', e.target.value)} className={input} />
                </Field>
                <Field label="Surname" editing={editing} value={contact.last_name}>
                  <input value={editForm.last_name ?? ''} onChange={e => setField('last_name', e.target.value)} className={input} />
                </Field>
              </div>
              <Field label="Status" editing={editing} value={contact.status}>
                <select value={editForm.status ?? 'Active'} onChange={e => setField('status', e.target.value)} className={select}>
                  <option>Active</option><option>Inactive</option>
                </select>
              </Field>
              <Field label="ID Number" editing={editing} value={contact.id_number}>
                <input value={editForm.id_number ?? ''} onChange={e => setField('id_number', e.target.value || null)} className={input} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date Added" editing={false} value={formatDate(contact.date_added)} />
                <Field label="Captured By" editing={false}
                  value={profiles.find(p => p.id === contact.created_by)?.full_name ?? profiles.find(p => p.id === contact.created_by)?.email} />
              </div>
            </Section>

            <Section title="Contact Details">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone" editing={editing} value={contact.phone_number}>
                  <input value={editForm.phone_number ?? ''} onChange={e => setField('phone_number', e.target.value || null)} className={input} />
                </Field>
                <Field label="Email" editing={editing} value={contact.email_address}>
                  <input type="email" value={editForm.email_address ?? ''} onChange={e => setField('email_address', e.target.value || null)} className={input} />
                </Field>
              </div>
              <Field label="Contact Preference" editing={editing} value={contact.contact_preference}>
                <select value={editForm.contact_preference ?? ''} onChange={e => setField('contact_preference', e.target.value || null)} className={select}>
                  <option value="">—</option>
                  {['WhatsApp', 'Email', 'Phone'].map(p => <option key={p}>{p}</option>)}
                </select>
              </Field>
            </Section>

            <Section title="Personal Details">
              <Field label="Marital Status" editing={editing} value={contact.marital_status}>
                <select value={editForm.marital_status ?? ''} onChange={e => setField('marital_status', e.target.value || null)} className={select}>
                  <option value="">—</option>
                  {['Single', 'Married', 'Divorced', 'Widowed', 'Separated'].map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Birthday" editing={editing} value={formatDate(contact.birthday)}>
                  <input type="date" value={editForm.birthday ?? ''} onChange={e => setField('birthday', e.target.value || null)} className={input} />
                </Field>
                <Field label="Wedding Anniv." editing={editing} value={formatDate(contact.wedding_anniversary)}>
                  <input type="date" value={editForm.wedding_anniversary ?? ''} onChange={e => setField('wedding_anniversary', e.target.value || null)} className={input} />
                </Field>
                <Field label="Home Anniv." editing={editing} value={formatDate(contact.home_anniversary)}>
                  <input type="date" value={editForm.home_anniversary ?? ''} onChange={e => setField('home_anniversary', e.target.value || null)} className={input} />
                </Field>
              </div>
            </Section>

            <Section title="Work Details">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Occupation" editing={editing} value={contact.occupation}>
                  <input value={editForm.occupation ?? ''} onChange={e => setField('occupation', e.target.value || null)} className={input} />
                </Field>
                <Field label="Company" editing={editing} value={contact.company_name}>
                  <input value={editForm.company_name ?? ''} onChange={e => setField('company_name', e.target.value || null)} className={input} />
                </Field>
                <Field label="Division" editing={editing} value={contact.division}>
                  <input value={editForm.division ?? ''} onChange={e => setField('division', e.target.value || null)} className={input} />
                </Field>
                <Field label="Branch" editing={editing} value={contact.branch}>
                  <input value={editForm.branch ?? ''} onChange={e => setField('branch', e.target.value || null)} className={input} />
                </Field>
              </div>
            </Section>

            {editing && saveError && <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg">{saveError}</p>}

            {editing && (
              <div className="flex gap-3">
                <button onClick={saveContact} disabled={saving} className={`${btn.primary} flex-1 py-3`}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button onClick={() => { setEditing(false); setEditForm(contact) }} className={`${btn.secondary} flex-1 py-3`}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── NOTES TAB ── */}
        {tab === 'notes' && (
          <div className="space-y-4">
            <div className={`${card} p-5`}>
              <textarea
                value={newNote} onChange={e => setNewNote(e.target.value)}
                placeholder="Write a note about this contact…" rows={3}
                className="w-full text-sm text-[#1a1a1a] placeholder-gray-400 resize-none focus:outline-none"
              />
              <div className="flex justify-end mt-3">
                <button onClick={addNote} disabled={addingNote || !newNote.trim()} className={btn.primary}>
                  {addingNote ? 'Saving…' : 'Add Note'}
                </button>
              </div>
            </div>

            {notes.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-8">No notes yet. Add one above.</p>
            ) : notes.map(note => (
              <div key={note.id} className={`${card} p-5`}>
                {editingNoteId === note.id ? (
                  <>
                    <textarea value={editNoteText} onChange={e => setEditNoteText(e.target.value)} rows={3}
                      className="w-full text-sm text-[#1a1a1a] resize-none focus:outline-none border border-gray-200 rounded-lg p-3" />
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => saveNoteEdit(note.id)} className={btn.primary}>Save</button>
                      <button onClick={() => setEditingNoteId(null)} className={btn.secondary}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-[#1a1a1a] whitespace-pre-wrap">{note.note_text}</p>
                    <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                      <div className="text-xs text-gray-400">
                        {timeAgo(note.created_at)}
                        {note.last_edited_at !== note.created_at && (
                          <span className="ml-2 italic">· edited {timeAgo(note.last_edited_at)}</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {note.last_edited_at !== note.created_at && (
                          <button onClick={() => loadHistory(note.id)} className={btn.ghost}>
                            {showHistoryFor === note.id ? 'Hide history' : 'View history'}
                          </button>
                        )}
                        <button onClick={() => { setEditingNoteId(note.id); setEditNoteText(note.note_text) }} className={btn.ghost}>Edit</button>
                        <button onClick={() => deleteNote(note.id)} className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">Delete</button>
                      </div>
                    </div>
                    {showHistoryFor === note.id && noteHistory[note.id] && (
                      <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
                        <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide">Previous versions</p>
                        {noteHistory[note.id].map(h => (
                          <div key={h.id} className="bg-gray-50 rounded-lg p-3">
                            <p className="text-sm text-[#1a1a1a] whitespace-pre-wrap">{h.note_text}</p>
                            <p className="text-xs text-gray-400 mt-1">{timeAgo(h.edited_at)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
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
