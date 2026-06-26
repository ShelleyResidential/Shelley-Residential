'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card, input, select } from '@/lib/styles'
import { useRouter } from 'next/navigation'
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
  tags: string[]
  company_name: string | null
}

function fullName(c: Pick<Contact, 'first_name' | 'last_name'>) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ')
}

export default function ContactsPage() {
  const router = useRouter()
  const [contacts, setContacts]       = useState<Contact[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [filterTag, setFilterTag]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('contacts')
      .select('id, title, first_name, last_name, status, phone_number, email_address, tags, company_name')
      .order('first_name')

    if (filterStatus) query = query.eq('status', filterStatus)
    if (filterTag)    query = query.contains('tags', [filterTag])
    if (search)       query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`)

    const { data } = await query
    setContacts(data ?? [])
    setLoading(false)
  }, [search, filterTag, filterStatus])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/') })
  }, [router])

  useEffect(() => {
    const timer = setTimeout(fetchContacts, 300)
    return () => clearTimeout(timer)
  }, [fetchContacts])

  return (
    <div className="p-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-[#1a1a1a]">Contacts</h1>
        <Link href="/dashboard/contacts/new" className={btn.primary}>+ Add Contact</Link>
      </div>

      {/* Filters */}
      <div className={`${card} p-4 mb-6 flex gap-3 flex-wrap items-center`}>
        <input
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`${input} flex-1 min-w-[200px]`}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${select} w-auto`}>
          <option value="">All statuses</option>
          <option>Active</option>
          <option>Inactive</option>
        </select>
        <select value={filterTag} onChange={e => setFilterTag(e.target.value)} className={`${select} w-auto`}>
          <option value="">All tags</option>
          {TAGS.map(t => <option key={t}>{t}</option>)}
        </select>
        {(search || filterTag || filterStatus) && (
          <button onClick={() => { setSearch(''); setFilterTag(''); setFilterStatus('') }} className={btn.secondary}>
            Clear
          </button>
        )}
      </div>

      {/* Count */}
      {!loading && (
        <p className="text-sm text-gray-400 mb-4">
          {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'} found
        </p>
      )}

      {/* Contact cards */}
      {loading ? (
        <div className="text-center py-20 text-gray-400 text-sm">Loading contacts…</div>
      ) : contacts.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <p className="text-gray-400 text-sm mb-4">No contacts found.</p>
          <Link href="/dashboard/contacts/new" className={btn.primary}>Add your first contact</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map(contact => (
            <Link
              key={contact.id}
              href={`/dashboard/contacts/${contact.id}`}
              className={`${card} flex items-center justify-between px-5 py-4 hover:shadow-md hover:border-gray-200 transition-all`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[#1a1a1a]">{fullName(contact)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    contact.status === 'Active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {contact.status}
                  </span>
                </div>
                <div className="flex gap-4 mt-1 text-sm text-[#1a1a1a] flex-wrap">
                  {contact.phone_number && <span>{contact.phone_number}</span>}
                  {contact.email_address && <span>{contact.email_address}</span>}
                  {contact.company_name && <span>{contact.company_name}</span>}
                </div>
                {contact.tags.length > 0 && (
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {contact.tags.map(tag => (
                      <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 text-[#1a1a1a] rounded-full">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-gray-300 text-lg flex-shrink-0 ml-4">›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
