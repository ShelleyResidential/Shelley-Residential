'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

type Stats = {
  contacts: number
  properties: number
  evaluations: number
  evaluationsByStatus: Record<string, number>
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In Progress', open: 'Open', won: 'Won', lost: 'Lost', future: 'Future',
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    contacts: 0, properties: 0, evaluations: 0, evaluationsByStatus: {},
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [
        { count: contacts },
        { count: properties },
        { data: evData },
      ] = await Promise.all([
        supabase.from('contacts').select('*', { count: 'exact', head: true }),
        supabase.from('properties').select('*', { count: 'exact', head: true }),
        supabase.from('evaluations').select('status'),
      ])

      const evaluationsByStatus: Record<string, number> = {}
      for (const row of evData ?? []) {
        evaluationsByStatus[row.status] = (evaluationsByStatus[row.status] ?? 0) + 1
      }

      setStats({
        contacts:  contacts  ?? 0,
        properties: properties ?? 0,
        evaluations: (evData ?? []).length,
        evaluationsByStatus,
      })
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold text-[#1a1a1a] mb-8">Dashboard</h1>

      {/* ── Top stat blocks ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatBlock
          label="Total Contacts"
          value={loading ? '—' : stats.contacts}
          href="/dashboard/contacts"
        />
        <StatBlock
          label="Total Properties"
          value={loading ? '—' : stats.properties}
          href="/dashboard/properties"
        />
        <StatBlock
          label="Total Evaluations"
          value={loading ? '—' : stats.evaluations}
          href="/dashboard/evaluations"
        />
      </div>

      {/* ── Evaluations by status ── */}
      {!loading && stats.evaluations > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
          <p className="text-xs font-bold text-[#1a1a1a] uppercase tracking-wide mb-5">Evaluations by Status</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Object.entries(STATUS_LABELS).map(([key, label]) => {
              const count = stats.evaluationsByStatus[key] ?? 0
              return (
                <Link key={key} href={`/dashboard/evaluations?status=${key}`}
                  className="flex flex-col items-center p-4 rounded-xl border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all">
                  <span className="text-2xl font-bold text-[#1a1a1a]">{count}</span>
                  <span className="text-xs font-medium mt-1 text-gray-400">{label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StatBlock({ label, value, href }: {
  label: string; value: number | string; href: string
}) {
  return (
    <Link
      href={href}
      className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center justify-between hover:shadow-md hover:border-gray-200 transition-all"
    >
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
        <p className="text-4xl font-bold text-[#1a1a1a]">{value}</p>
      </div>
    </Link>
  )
}
