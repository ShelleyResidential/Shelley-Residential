'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { btn, card } from '@/lib/styles'
import Link from 'next/link'

type Stats = { total: number; active: number; inactive: number; recentCount: number }

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, inactive: 0, recentCount: 0 })

  useEffect(() => {
    async function load() {
      const { count: total }    = await supabase.from('contacts').select('*', { count: 'exact', head: true })
      const { count: active }   = await supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('status', 'Active')
      const { count: inactive } = await supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('status', 'Inactive')
      const since = new Date(); since.setDate(since.getDate() - 30)
      const { count: recentCount } = await supabase.from('contacts').select('*', { count: 'exact', head: true }).gte('date_added', since.toISOString())
      setStats({ total: total ?? 0, active: active ?? 0, inactive: inactive ?? 0, recentCount: recentCount ?? 0 })
    }
    load()
  }, [])

  return (
    <div className="p-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-[#1a1a1a]">Dashboard</h1>
        <Link href="/dashboard/contacts/new" className={btn.primary}>+ Add Contact</Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Contacts"   value={stats.total}       delta={`${stats.recentCount} added this month`} up />
        <StatCard label="Active"           value={stats.active} />
        <StatCard label="Inactive"         value={stats.inactive} />
        <StatCard label="Added This Month" value={stats.recentCount} />
      </div>

      <div className={card}>
        <h2 className="text-sm font-bold text-[#1a1a1a] uppercase tracking-wide px-6 py-4 border-b border-gray-100">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <QuickLink href="/dashboard/contacts"     title="View Contacts" desc="Search and manage all contacts in the database." />
          <QuickLink href="/dashboard/contacts/new" title="Add Contact"   desc="Capture a new contact on the spot." border />
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, delta, up }: { label: string; value: number; delta?: string; up?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-3xl font-bold text-[#1a1a1a]">{value}</p>
      {delta && <p className={`text-xs font-semibold mt-2 ${up ? 'text-green-600' : 'text-gray-400'}`}>{up ? '▲ ' : ''}{delta}</p>}
    </div>
  )
}

function QuickLink({ href, title, desc, border }: { href: string; title: string; desc: string; border?: boolean }) {
  return (
    <Link href={href} className={`block p-6 hover:bg-[#f8f7f4] transition-colors ${border ? 'border-t sm:border-t-0 sm:border-l border-gray-100' : ''}`}>
      <p className="font-semibold text-[#1a1a1a] text-sm mb-1">{title}</p>
      <p className="text-sm text-[#1a1a1a]">{desc}</p>
    </Link>
  )
}
