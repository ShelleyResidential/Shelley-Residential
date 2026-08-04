'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input } from '@/lib/styles'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const PAGE_SIZE = 50

type Contact = {
  id: string
  title: string | null
  first_name: string
  last_name: string
  status: string | null
  phone_number: string | null
  email_address: string | null
  contact_preference: string | null
  agent_id: string | null
  date_added: string | null
}

function fullName(c: Pick<Contact, 'first_name' | 'last_name'>) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ')
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ContactsPage() {
  const router = useRouter()
  const [contacts, setContacts]       = useState<Contact[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [myOnly, setMyOnly]           = useState(false)
  const [userId, setUserId]           = useState<string | null>(null)
  const [page, setPage]               = useState(1)
  const [totalCount, setTotalCount]   = useState(0)
  const [selectedId, setSelectedId]   = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('contacts')
      .select('id, title, first_name, last_name, status, phone_number, email_address, contact_preference, agent_id, date_added', { count: 'exact' })
      .order('first_name')

    if (myOnly && userId) query = query.eq('agent_id', userId)
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`)

    const from = (page - 1) * PAGE_SIZE
    query = query.range(from, from + PAGE_SIZE - 1)

    const { data, count } = await query
    setContacts(data ?? [])
    setTotalCount(count ?? 0)
    setLoading(false)
  }, [search, myOnly, userId, page])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserId(data.user.id)
    })
  }, [router])

  // Any change to the filters should snap back to page 1.
  useEffect(() => {
    setPage(1)
  }, [search, myOnly])

  useEffect(() => {
    const timer = setTimeout(fetchContacts, 300)
    return () => clearTimeout(timer)
  }, [fetchContacts])

  function toggleSelected(id: string) {
    setSelectedId(prev => prev === id ? null : id)
  }

  const rowActionControls = selectedId && (
    <RowActionButtons
      onEdit={() => router.push(`/dashboard/contacts/${selectedId}?edit=1`)}
      onDetails={() => router.push(`/dashboard/contacts/${selectedId}`)}
    />
  )

  const paginationControls = !loading && contacts.length > 0 && (
    <div className="flex items-center gap-3 flex-wrap justify-end">
      <p className="text-xs text-gray-400">
        Page {page} of {totalPages} · {PAGE_SIZE} Records
      </p>
      <div className="flex items-center gap-1">
        <button onClick={() => setPage(1)} disabled={page <= 1}
          className="px-2.5 py-1.5 rounded-md text-sm text-[#1a1a1a] border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          «
        </button>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="px-2.5 py-1.5 rounded-md text-sm text-[#1a1a1a] border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          ‹
        </button>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
          className="px-2.5 py-1.5 rounded-md text-sm text-[#1a1a1a] border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          ›
        </button>
        <button onClick={() => setPage(totalPages)} disabled={page >= totalPages}
          className="px-2.5 py-1.5 rounded-md text-sm text-[#1a1a1a] border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          »
        </button>
      </div>
    </div>
  )

  return (
    <div className="p-10">
      <Breadcrumbs items={[{ label: 'Analyse' }, { label: 'Contacts' }]} />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1a1a1a]">Contacts</h1>
        <Link href="/dashboard/contacts/new" className={`${btn.primary} fixed top-8 right-10 z-40 shadow-md`}>+ New Contact</Link>
      </div>

      {/* Search */}
      <div className={`${card} p-4 mb-3 flex gap-3 flex-wrap items-center`}>
        <input
          type="text"
          placeholder="Search by Name…"
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

      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <label className="flex items-center gap-2 text-sm text-[#1a1a1a] cursor-pointer select-none w-fit">
          <input
            type="radio"
            name="my-contacts-only"
            checked={myOnly}
            onClick={() => setMyOnly(o => !o)}
            onChange={() => setMyOnly(true)}
            className="w-4 h-4 border-gray-300 accent-[#E8266F] cursor-pointer"
          />
          My Contacts Only
        </label>
        {rowActionControls}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        {!loading && (
          <p className="text-sm text-gray-400">
            {totalCount} {totalCount === 1 ? 'Contact' : 'Contacts'}
          </p>
        )}
        {paginationControls}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">Loading contacts…</div>
      ) : contacts.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <p className="text-gray-400 text-sm mb-4">No contacts found.</p>
          <Link href="/dashboard/contacts/new" className={btn.primary}>Add your first contact</Link>
        </div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-sm table-fixed">
            <thead>
              <TableHeaderRow />
            </thead>
            <tbody>
              {contacts.map((c, i) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/dashboard/contacts/${c.id}`)}
                  className={`cursor-pointer hover:bg-gray-100 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                >
                  <td className="px-3 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <input
                      type="radio"
                      name="selected-contact"
                      checked={selectedId === c.id}
                      onClick={() => toggleSelected(c.id)}
                      onChange={() => setSelectedId(c.id)}
                      className="w-4 h-4 border-gray-300 accent-[#E8266F] cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-3 text-[#1a1a1a] font-medium truncate" title={fullName(c)}>{fullName(c)}</td>
                  <td className="px-3 py-3 text-gray-500 truncate">{c.phone_number || '—'}</td>
                  <td className="px-3 py-3 overflow-hidden">
                    {c.email_address ? (
                      <a
                        href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.email_address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        title={c.email_address}
                        className="block truncate text-gray-500 underline hover:font-bold hover:text-[#1a1a1a] transition-all"
                      >
                        {c.email_address}
                      </a>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-gray-500 truncate">{c.contact_preference || '—'}</td>
                  <td className="px-3 py-3 overflow-hidden">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium truncate inline-block max-w-full align-bottom ${
                      c.status === 'Active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {c.status || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-500 truncate">{formatDate(c.date_added)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <TableHeaderRow />
            </tfoot>
          </table>
        </div>
      )}

      {paginationControls && <div className="mt-4">{paginationControls}</div>}

      {rowActionControls && <div className="mt-4">{rowActionControls}</div>}
    </div>
  )
}

// ── Table header row, repeated at both the top (thead) and bottom (tfoot)
// of the contacts table so the column labels stay visible either way.
function TableHeaderRow() {
  return (
    <tr className="border-b border-gray-100 text-left">
      <th className="px-3 py-3 whitespace-nowrap w-[4%]" />
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[16%]">Name</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[16%]">Phone Number</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[16%]">Email</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[16%]">Preference</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[16%]">Status</th>
      <th className="px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide w-[16%]">Date Added</th>
    </tr>
  )
}

// ── Row action buttons (Edit / Details), shown once a row is selected.
function RowActionButtons({ onEdit, onDetails }: { onEdit?: () => void; onDetails?: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <button disabled={!onEdit} onClick={onEdit} className={`${btn.secondary} cursor-pointer disabled:cursor-not-allowed`}>
        Edit
      </button>
      <button disabled={!onDetails} onClick={onDetails} className={`${btn.secondary} cursor-pointer disabled:cursor-not-allowed`}>
        Details
      </button>
    </div>
  )
}
