'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

const CHILD_ROUTES = ['/dashboard/contacts', '/dashboard/properties']

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

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      const meta = data.user.user_metadata ?? {}
      setEmail(data.user.email ?? '')
      setDisplayName(meta.full_name ?? meta.name ?? (data.user.email ?? '').split('@')[0])
      setAvatarUrl(meta.avatar_url ?? meta.picture ?? null)
    })
  }, [router])

  const dashboardActive   = pathname === '/dashboard'
  const evaluationsActive = pathname.startsWith('/dashboard/evaluations')
  const childSectionOpen  = evaluationsActive || CHILD_ROUTES.some(r => pathname.startsWith(r))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: '100vh' }}>

      {/* ── Sidebar ── */}
      <aside style={{ background: '#2A2A2A', color: '#fff', padding: '28px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 40, textAlign: 'center' }}>
          <Image src="/logo.png" alt="Shelley Residential" width={160} height={80} style={{ filter: 'brightness(0) invert(1)' }} />
        </div>

        <nav style={{ flex: 1 }}>
          <Link href="/dashboard" style={navItemStyle(dashboardActive, false)}>
            Dashboard
          </Link>

          <Link href="/dashboard/evaluations" style={navItemStyle(evaluationsActive, false)}>
            Evaluations
          </Link>

          {childSectionOpen && (
            <div>
              <Link href="/dashboard/contacts" style={navItemStyle(pathname.startsWith('/dashboard/contacts'), true)}>
                Contacts
              </Link>
              <Link href="/dashboard/properties" style={navItemStyle(pathname.startsWith('/dashboard/properties'), true)}>
                Properties
              </Link>
            </div>
          )}
        </nav>

        {/* Slogan */}
        <p style={{ fontSize: 11, color: '#fff', textAlign: 'left', paddingLeft: 12, marginBottom: 16, lineHeight: 1.6 }}>
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
              <img
                src={avatarUrl}
                alt={displayName}
                style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
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

    </div>
  )
}
