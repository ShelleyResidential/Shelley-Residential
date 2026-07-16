'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select, sectionTitle, label as labelCls } from '@/lib/styles'
import { canDelete } from '@/lib/permissions'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

const TAGS = [
  'Current Buyer', 'Current Seller', 'Family', 'Friends', 'Homeowner',
  'Investor', 'Referral Agent', 'Service Provider', 'Shelly Team Member', 'Strategic Partner',
]

type Contact = {
  id: string
  title: string | null
  first_name: string
  last_name: string
  status: string
  phone_number: string | null
  email_address: string | null
  contact_preference: string | null
  tags: string[]
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
  date_added: string
}

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
  const id = params.id as string

  const [contact, setContact]         = useState<Contact | null>(null)
  const [userId, setUserId]           = useState<string | null>(null)
  const [userEmail, setUserEmail]     = useState<string | null>(null)
  const [deleting, setDeleting]       = useState(false)
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState<'info' | 'notes'>('info')
  const [editing, setEditing]         = useState(false)
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
    fetchNotes()
  }, [id, router, fetchNotes])

  function setField(field: string, value: unknown) {
    setEditForm(f => ({ ...f, [field]: value }))
  }

  function toggleTag(tag: string) {
    const current = (editForm.tags ?? []) as string[]
    setField('tags', current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag])
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
    <div className="bg-[#f8f7f4] min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/contacts" className="text-gray-400 hover:text-[#1a1a1a] text-sm transition-colors">← Contacts</Link>
          <h1 className="text-lg font-bold text-[#1a1a1a]">{fullName(contact)}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            contact.status === 'Active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>{contact.status}</span>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <button onClick={() => { setEditing(true); setEditForm(contact) }} className={btn.secondary}>
              Edit
            </button>
          )}
          {canDelete(userEmail) && (
            <button onClick={deleteContact} disabled={deleting} className={btn.danger}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-100 px-8">
        <div className="flex gap-6">
          {(['info', 'notes'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t ? 'border-[#1a1a1a] text-[#1a1a1a]' : 'border-transparent text-gray-400 hover:text-[#1a1a1a]'
              }`}>
              {t === 'notes' ? 'Notes' : 'Information'}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-4 py-8">

        {/* ── INFO VIEW ── */}
        {tab === 'info' && !editing && (
          <div className="space-y-4">
            <InfoSection title="Basic Information">
              <Row label="Title"      value={contact.title} />
              <Row label="First Name" value={contact.first_name} />
              <Row label="Surname"    value={contact.last_name} />
              <Row label="Status"     value={contact.status} />
              <Row label="Tags"       value={contact.tags?.length ? contact.tags.join(', ') : null} />
              <Row label="ID Number"  value={contact.id_number} />
              <Row label="Date Added" value={formatDate(contact.date_added)} />
            </InfoSection>

            <InfoSection title="Contact Details">
              <Row label="Phone"      value={contact.phone_number} />
              <Row label="Email"      value={contact.email_address} />
              <Row label="Preference" value={contact.contact_preference} />
              <AddressRow address={contact.address} />
            </InfoSection>

            <InfoSection title="Personal Details">
              <Row label="Marital Status"      value={contact.marital_status} />
              <Row label="Birthday"            value={formatDate(contact.birthday)} />
              <Row label="Wedding Anniversary" value={formatDate(contact.wedding_anniversary)} />
              <Row label="Home Anniversary"    value={formatDate(contact.home_anniversary)} />
            </InfoSection>

            <InfoSection title="Work Details">
              <Row label="Occupation" value={contact.occupation} />
              <Row label="Company"    value={contact.company_name} />
              <Row label="Division"   value={contact.division} />
              <Row label="Branch"     value={contact.branch} />
            </InfoSection>
          </div>
        )}

        {/* ── EDIT VIEW ── */}
        {tab === 'info' && editing && (
          <div className="space-y-4">
            <EditSection title="Basic Information">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Title</label>
                  <select value={editForm.title ?? ''} onChange={e => setField('title', e.target.value || null)} className={select}>
                    <option value="">—</option>
                    {['Mr', 'Mrs', 'Ms', 'Dr'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>First Name</label>
                  <input value={editForm.first_name ?? ''} onChange={e => setField('first_name', e.target.value)} className={input} />
                </div>
                <div>
                  <label className={labelCls}>Surname</label>
                  <input value={editForm.last_name ?? ''} onChange={e => setField('last_name', e.target.value)} className={input} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select value={editForm.status ?? 'Active'} onChange={e => setField('status', e.target.value)} className={select}>
                  <option>Active</option><option>Inactive</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Tags</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {TAGS.map(tag => (
                    <button key={tag} type="button" onClick={() => toggleTag(tag)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        (editForm.tags ?? []).includes(tag)
                          ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]'
                          : 'bg-white text-[#1a1a1a] border-gray-200 hover:border-gray-400'
                      }`}>
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>ID Number</label>
                <input value={editForm.id_number ?? ''} onChange={e => setField('id_number', e.target.value || null)} className={input} />
              </div>
            </EditSection>

            <EditSection title="Contact Details">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Phone</label>
                  <input value={editForm.phone_number ?? ''} onChange={e => setField('phone_number', e.target.value || null)} className={input} />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input type="email" value={editForm.email_address ?? ''} onChange={e => setField('email_address', e.target.value || null)} className={input} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Contact Preference</label>
                <select value={editForm.contact_preference ?? ''} onChange={e => setField('contact_preference', e.target.value || null)} className={select}>
                  <option value="">—</option>
                  {['WhatsApp', 'Email', 'Phone'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Address</label>
                <input value={editForm.address ?? ''} onChange={e => setField('address', e.target.value || null)} className={input} />
              </div>
            </EditSection>

            <EditSection title="Personal Details">
              <div>
                <label className={labelCls}>Marital Status</label>
                <select value={editForm.marital_status ?? ''} onChange={e => setField('marital_status', e.target.value || null)} className={select}>
                  <option value="">—</option>
                  {['Single', 'Married', 'Divorced', 'Widowed', 'Separated'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Birthday</label>
                  <input type="date" value={editForm.birthday ?? ''} onChange={e => setField('birthday', e.target.value || null)} className={input} />
                </div>
                <div>
                  <label className={labelCls}>Wedding Anniv.</label>
                  <input type="date" value={editForm.wedding_anniversary ?? ''} onChange={e => setField('wedding_anniversary', e.target.value || null)} className={input} />
                </div>
                <div>
                  <label className={labelCls}>Home Anniv.</label>
                  <input type="date" value={editForm.home_anniversary ?? ''} onChange={e => setField('home_anniversary', e.target.value || null)} className={input} />
                </div>
              </div>
            </EditSection>

            <EditSection title="Work Details">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Occupation</label><input value={editForm.occupation ?? ''} onChange={e => setField('occupation', e.target.value || null)} className={input} /></div>
                <div><label className={labelCls}>Company</label><input value={editForm.company_name ?? ''} onChange={e => setField('company_name', e.target.value || null)} className={input} /></div>
                <div><label className={labelCls}>Division</label><input value={editForm.division ?? ''} onChange={e => setField('division', e.target.value || null)} className={input} /></div>
                <div><label className={labelCls}>Branch</label><input value={editForm.branch ?? ''} onChange={e => setField('branch', e.target.value || null)} className={input} /></div>
              </div>
            </EditSection>

            {saveError && <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg">{saveError}</p>}

            <div className="flex gap-3">
              <button onClick={saveContact} disabled={saving} className={`${btn.primary} flex-1 py-3`}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => { setEditing(false); setEditForm(contact) }} className={`${btn.secondary} flex-1 py-3`}>
                Cancel
              </button>
            </div>
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
      </main>
    </div>
  )
}

// ── Reusable components ────────────────────────────────────

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${card} p-6`}>
      <h3 className={sectionTitle}>{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-[#1a1a1a] text-right font-medium">{value || '—'}</span>
    </div>
  )
}

function AddressRow({ address }: { address: string | null }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-gray-500 flex-shrink-0">Address</span>
      {address ? (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
          target="_blank" rel="noopener noreferrer"
          className="text-[#1a1a1a] font-medium text-right underline underline-offset-2 hover:text-blue-600 transition-colors"
        >
          {address}
        </a>
      ) : (
        <span className="text-[#1a1a1a] font-medium">—</span>
      )}
    </div>
  )
}

function EditSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${card} p-6 space-y-4`}>
      <h3 className={sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}
