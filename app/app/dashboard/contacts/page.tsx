'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input } from '@/lib/styles'
import { formatPhoneDisplay } from '@/lib/phone'
import { Breadcrumbs } from '@/lib/Breadcrumbs'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const PAGE_SIZE = 50

type SortColumn = 'status' | 'name' | 'phone_number' | 'email_address' | 'contact_preference' | 'date_added' | 'created_by'
type SortDirection = 'asc' | 'desc'

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
  created_by: string | null
}

type Profile = { id: string; full_name: string | null; email: string | null }

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
  const [profiles, setProfiles]       = useState<Profile[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [searchOpen, setSearchOpen]   = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [myOnly, setMyOnly]           = useState(false)
  const [userId, setUserId]           = useState<string | null>(null)
  const [page, setPage]               = useState(1)
  const [totalCount, setTotalCount]   = useState(0)
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [syncing, setSyncing]         = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [sortColumn, setSortColumn]       = useState<SortColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const SELECT_COLUMNS = 'id, title, first_name, last_name, status, phone_number, email_address, contact_preference, agent_id, date_added, created_by'

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    const ascending = sortDirection === 'asc'

    // "Captured By" sorts by a joined profile's display name, which
    // PostgREST can't order by directly on the contacts table -- fetch
    // every matching contact (paginated past Supabase's 1000-row cap),
    // resolve + sort client-side, then slice out just this page.
    if (sortColumn === 'created_by') {
      let base = supabase.from('contacts').select(SELECT_COLUMNS)
      if (myOnly && userId) base = base.eq('agent_id', userId)
      if (search) base = base.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,name.ilike.%${search}%`)

      let all: Contact[] = []
      for (let from = 0; ; from += 1000) {
        const { data } = await base.range(from, from + 999)
        if (!data || data.length === 0) break
        all = all.concat(data)
        if (data.length < 1000) break
      }

      const nameFor = (c: Contact) => {
        const p = profiles.find(p => p.id === c.created_by)
        return (p?.full_name ?? p?.email ?? '').toLowerCase()
      }
      all.sort((a, b) => nameFor(a).localeCompare(nameFor(b)) * (ascending ? 1 : -1))

      const from = (page - 1) * PAGE_SIZE
      setContacts(all.slice(from, from + PAGE_SIZE))
      setTotalCount(all.length)
      setLoading(false)
      return
    }

    let query = supabase
      .from('contacts')
      .select(SELECT_COLUMNS, { count: 'exact' })

    if (sortColumn === 'name') {
      query = query.order('first_name', { ascending }).order('last_name', { ascending })
    } else {
      query = query.order(sortColumn, { ascending })
    }

    if (myOnly && userId) query = query.eq('agent_id', userId)
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,name.ilike.%${search}%`)

    const from = (page - 1) * PAGE_SIZE
    query = query.range(from, from + PAGE_SIZE - 1)

    const { data, count } = await query
    setContacts(data ?? [])
    setTotalCount(count ?? 0)
    setLoading(false)
  }, [search, myOnly, userId, page, sortColumn, sortDirection, profiles])

  function handleSort(column: SortColumn, direction: SortDirection) {
    setSortColumn(column)
    setSortDirection(direction)
    setPage(1)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserId(data.user.id)
    })
    supabase.from('profiles').select('id, full_name, email').then(({ data }) => setProfiles(data ?? []))
  }, [router])

  // Any change to the filters should snap back to page 1.
  useEffect(() => {
    setPage(1)
  }, [search, myOnly])

  // Focus the input the moment it's revealed on mobile, so tapping the
  // search icon doesn't need a second tap to start typing.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    const timer = setTimeout(fetchContacts, 300)
    return () => clearTimeout(timer)
  }, [fetchContacts])

  function toggleSelected(id: string) {
    setSelectedId(prev => prev === id ? null : id)
  }

  async function syncContacts() {
    if (!userId) return
    setSyncing(true)
    setSyncMessage('')

    // The endpoint only ever processes one page (~200 contacts) per call --
    // on Vercel's Hobby plan a serverless function hard-stops at 10 seconds,
    // which a full multi-thousand-contact sync can easily exceed. Looping
    // it here, one short request at a time, means the sync always finishes
    // completely regardless of how large the contact list is.
    let pageToken: string | null = null
    let totalCreated = 0
    let totalUpdated = 0
    let totalSkipped = 0
    for (;;) {
      const res: Response = await fetch('/api/contacts/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId, pageToken }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSyncMessage(json.error ?? 'Sync failed.')
        setSyncing(false)
        return
      }
      totalCreated += json.created
      totalUpdated += json.updated
      totalSkipped += json.skipped ?? 0
      pageToken = json.nextPageToken
      setSyncMessage(`Syncing… ${totalCreated + totalUpdated + totalSkipped} contacts so far`)
      if (!pageToken) break
    }

    setSyncMessage(
      `Synced — ${totalCreated} new, ${totalUpdated} updated` +
      (totalSkipped > 0 ? `, ${totalSkipped} skipped (already saved by another agent)` : '') + '.'
    )
    await fetchContacts()
    setSyncing(false)
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
        Page {page} of {totalPages} · {PAGE_SIZE} Records Per Page
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
    <div className="p-4 md:p-10">
      <Breadcrumbs items={[{ label: 'Analyse' }, { label: 'Contacts' }]} />
      <div className="flex items-center justify-between mb-4 gap-2">
        <h1 className="text-lg sm:text-2xl font-bold text-[#1a1a1a]">Contacts</h1>
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={syncContacts} disabled={syncing} className={btn.primary}>
            {syncing ? 'Syncing…' : 'Sync Contacts'}
          </button>
          <Link href="/dashboard/contacts/new" className={btn.primary}>+ New Contact</Link>
          {/* Search toggle -- mobile only, sits in this same header row
              instead of a row of its own (which was mostly empty space,
              defeating the point of collapsing the search box at all). */}
          <button
            type="button"
            onClick={() => setSearchOpen(o => !o)}
            aria-label={searchOpen ? 'Hide search' : 'Show search'}
            aria-expanded={searchOpen}
            className={`md:hidden flex-shrink-0 p-2 rounded-lg border transition-colors ${
              searchOpen || search ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white' : 'border-gray-200 bg-white text-gray-500'
            }`}
          >
            <SearchIcon />
          </button>
        </div>
      </div>
      {syncMessage && <p className="text-xs text-gray-400 -mt-2 mb-4">{syncMessage}</p>}

      {/* Search -- collapsed on mobile (toggled from the header row above)
          so the records list sits higher up; always expanded on desktop. */}
      <div className={`${card} p-4 mb-3 flex gap-3 flex-wrap items-center md:flex ${searchOpen ? 'flex' : 'hidden'}`}>
        <input
          ref={searchInputRef}
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
            {totalCount.toLocaleString('en-US')} {totalCount === 1 ? 'Contact' : 'Contacts'}
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
        // min-w-[1000px] on the table itself is what actually makes this
        // scrollable sideways on a phone -- w-full alone lets table-fixed's
        // percentage columns just shrink to fit the viewport instead,
        // squeezing every cell into an unreadable sliver. max-h-[65vh] +
        // overflow-auto (both axes, not overflow-x-auto) turns this into its
        // own bounded scroll panel -- required for the sticky header below
        // to actually work: overflow-x-auto alone forces overflow-y to also
        // compute as auto per the CSS overflow spec, which makes this div
        // (not the page) the sticky positioning context, but since the div's
        // height was unbounded (auto-grows with content) it never actually
        // scrolled, so the "stuck" header just scrolled away with everything
        // else instead of pinning in place.
        <div className={`${card} overflow-auto max-h-[65vh]`}>
          <table className="w-full min-w-[1000px] text-sm table-fixed">
            <thead>
              <TableHeaderRow sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} sticky />
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
                  <td className="px-3 py-3 overflow-hidden">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium truncate inline-block max-w-full align-bottom ${
                      c.status === 'Active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {c.status || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-[#1a1a1a] font-medium truncate" title={fullName(c)}>{fullName(c)}</td>
                  <td className="px-3 py-3 text-gray-500 truncate">{formatPhoneDisplay(c.phone_number)}</td>
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
                  <td className="px-3 py-3 text-gray-500 truncate">{formatDate(c.date_added)}</td>
                  <td className="px-3 py-3 text-gray-500 truncate">
                    {profiles.find(p => p.id === c.created_by)?.full_name ?? profiles.find(p => p.id === c.created_by)?.email ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <TableHeaderRow sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
            </tfoot>
          </table>
        </div>
      )}

      {paginationControls && <div className="mt-4">{paginationControls}</div>}

      {rowActionControls && <div className="mt-4">{rowActionControls}</div>}
    </div>
  )
}

// ── Sort arrows: one for ascending, one for descending, each clickable on
// its own so an agent can jump straight to the direction they want instead
// of toggling through a single button.
function SortArrows({ column, sortColumn, sortDirection, onSort }: {
  column: SortColumn
  sortColumn: SortColumn
  sortDirection: SortDirection
  onSort: (column: SortColumn, direction: SortDirection) => void
}) {
  const isAsc  = sortColumn === column && sortDirection === 'asc'
  const isDesc = sortColumn === column && sortDirection === 'desc'
  return (
    <span className="inline-flex flex-col ml-1 -space-y-0.5 align-middle normal-case">
      <button type="button" onClick={() => onSort(column, 'asc')}
        className={`leading-none text-[8px] cursor-pointer transition-colors ${isAsc ? 'text-[#E8266F]' : 'text-gray-300 hover:text-gray-500'}`}
        aria-label="Sort ascending">▲</button>
      <button type="button" onClick={() => onSort(column, 'desc')}
        className={`leading-none text-[8px] cursor-pointer transition-colors ${isDesc ? 'text-[#E8266F]' : 'text-gray-300 hover:text-gray-500'}`}
        aria-label="Sort descending">▼</button>
    </span>
  )
}

// Status gets a much narrower column than the rest -- its content (a short
// "Active"/"Inactive" badge) was leaving a big gap before Name started
// under the old equal-width columns. The freed-up width is spread across
// the remaining columns.
const HEADER_COLUMNS: { key: SortColumn; label: string; width: string }[] = [
  { key: 'status',             label: 'Status',       width: 'w-[7%]' },
  { key: 'name',                label: 'Name',         width: 'w-[16%]' },
  { key: 'phone_number',        label: 'Phone Number', width: 'w-[14%]' },
  { key: 'email_address',       label: 'Email',        width: 'w-[17%]' },
  { key: 'contact_preference',  label: 'Preference',   width: 'w-[13%]' },
  { key: 'date_added',          label: 'Date Added',   width: 'w-[13%]' },
  { key: 'created_by',          label: 'Captured By',  width: 'w-[16%]' },
]

// ── Table header row, repeated at both the top (thead) and bottom (tfoot)
// of the contacts table so the column labels stay visible either way. Only
// the thead instance passes `sticky` -- a sticky footer would just pin
// itself to the top of the viewport, which makes no sense for a tfoot.
// `position: sticky` has to sit on each <th> itself, not the <tr>/<thead>,
// to work reliably across browsers with a table layout.
function TableHeaderRow({ sortColumn, sortDirection, onSort, sticky }: {
  sortColumn: SortColumn
  sortDirection: SortDirection
  onSort: (column: SortColumn, direction: SortDirection) => void
  sticky?: boolean
}) {
  // top-0 relative to the table's own scroll panel (see the max-h-[65vh]
  // wrapper), not the page -- MobileShell's fixed top bar is a separate,
  // unrelated scroll context and doesn't need compensating for here.
  const thCls = `px-3 py-3 font-semibold text-[#1a1a1a] whitespace-nowrap text-xs uppercase tracking-wide ${sticky ? 'sticky top-0 z-10 bg-white' : ''}`
  return (
    <tr className="border-b border-gray-100 text-left">
      <th className={`w-[4%] ${thCls}`} />
      {HEADER_COLUMNS.map(col => (
        <th key={col.key} className={`${col.width} ${thCls}`}>
          {col.label}
          <SortArrows column={col.key} sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
        </th>
      ))}
    </tr>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16L12.5 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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
