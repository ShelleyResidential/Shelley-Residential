'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { btn, select as selectCls, label as labelCls } from '@/lib/styles'

const ANALYSE_ROUTES = ['/dashboard/contacts', '/dashboard/properties', '/dashboard/evaluations']

function navItemStyle(active: boolean, indented: boolean) {
  const basePadding = indented ? 24 : 12
  return {
    display: 'block',
    padding: '11px 12px',
    marginBottom: 2,
    fontSize: 14,
    color: '#fff',
    fontWeight: active ? 700 : 400,
    borderLeft: active ? '2px solid #E8266F' : '2px solid transparent',
    paddingLeft: active ? basePadding - 2 : basePadding,
    textDecoration: 'none',
  } as const
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [email, setEmail]         = useState('')
  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [userId, setUserId]       = useState<string | null>(null)
  const [needsRole, setNeedsRole] = useState(false)
  const [analyseOpen, setAnalyseOpen] = useState(() => ANALYSE_ROUTES.some(r => pathname.startsWith(r)))

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      const meta = data.user.user_metadata ?? {}
      setEmail(data.user.email ?? '')
      setDisplayName(meta.full_name ?? meta.name ?? (data.user.email ?? '').split('@')[0])
      setAvatarUrl(meta.avatar_url ?? meta.picture ?? null)
      setUserId(data.user.id)

      supabase.from('profiles').select('role').eq('id', data.user.id).single().then(({ data: profile }) => {
        if (!profile?.role) setNeedsRole(true)
      })
    })
  }, [router])

  // Re-expand Analyse whenever navigation lands on one of its child pages
  // (e.g. a link from elsewhere in the app), without fighting a manual toggle.
  useEffect(() => {
    if (ANALYSE_ROUTES.some(r => pathname.startsWith(r))) setAnalyseOpen(true)
  }, [pathname])

  const dashboardActive = pathname === '/dashboard'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: '100vh' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        background: '#2A2A2A', color: '#fff', padding: '28px 24px',
        display: 'flex', flexDirection: 'column',
        position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
      }}>
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <Image src="/logo.png" alt="Shelley Residential" width={160} height={80} style={{ filter: 'brightness(0) invert(1)' }} />
        </div>

        <nav style={{ flex: 1 }}>
          <Link href="/dashboard" style={navItemStyle(dashboardActive, false)}>
            Dashboard
          </Link>

          <button
            type="button"
            onClick={() => setAnalyseOpen(o => !o)}
            style={{
              ...navItemStyle(false, false),
              width: '100%', background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              font: 'inherit',
            }}
          >
            Analyse
            <span style={{ fontSize: 10, opacity: 0.7 }}>{analyseOpen ? '▾' : '▸'}</span>
          </button>

          {analyseOpen && (
            <div>
              <Link href="/dashboard/contacts" style={navItemStyle(pathname.startsWith('/dashboard/contacts'), true)}>
                Contacts
              </Link>
              <Link href="/dashboard/properties" style={navItemStyle(pathname.startsWith('/dashboard/properties'), true)}>
                Properties
              </Link>
              <Link href="/dashboard/evaluations" style={navItemStyle(pathname.startsWith('/dashboard/evaluations'), true)}>
                Evaluations
              </Link>
            </div>
          )}
        </nav>

        {/* Slogan */}
        <p style={{ fontSize: 10, color: '#fff', textAlign: 'left', paddingLeft: 4, marginBottom: 16, whiteSpace: 'nowrap' }}>
          One Name. One Team. <span style={{ color: '#E8266F', fontWeight: 700 }}>One Standard.</span>
        </p>

        {/* ── User section ── */}
        <div style={{ borderTop: '1px solid #3a3a3a', paddingTop: 20 }}>
          <Link
            href="/dashboard/settings"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '6px 8px',
              borderRadius: 8,
              textDecoration: 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#333')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {/* Avatar: Google photo if available, else initials */}
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={displayName}
                width={30}
                height={30}
                referrerPolicy="no-referrer"
                style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
              />
            ) : (
              <div style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: '#E8266F',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                color: '#fff',
                flexShrink: 0,
              }}>
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, color: '#fff', fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </p>
              <p style={{ fontSize: 11, color: '#6E6E6E', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {email}
              </p>
            </div>
          </Link>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ background: '#FAFAF9', minHeight: '100vh' }}>
        {children}
      </main>

      {needsRole && userId && (
        <RoleQuestionnaireModal userId={userId} onAnswered={() => setNeedsRole(false)} />
      )}

    </div>
  )
}

// ── One-time "What is your role?" questionnaire ──────────────
function RoleQuestionnaireModal({ userId, onAnswered }: { userId: string; onAnswered: () => void }) {
  const [role, setRole] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function save() {
    if (!role) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('profiles').update({ role }).eq('id', userId)
    if (err) { setError(err.message); setSaving(false); return }
    onAnswered()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <h3 className="text-lg font-bold text-[#1a1a1a] mb-1">Welcome!</h3>
        <p className="text-sm text-gray-500 mb-4">What is your role at Shelley Residential?</p>

        <label className={labelCls}>Role</label>
        <select value={role} onChange={e => setRole(e.target.value)} className={selectCls}>
          <option value="">Select role…</option>
          <option value="agent">Agent</option>
          <option value="transaction_coordinator">Transaction Coordinator</option>
        </select>

        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}

        <button onClick={save} disabled={!role || saving} className={`${btn.primary} w-full mt-4`}>
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
