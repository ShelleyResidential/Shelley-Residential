'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

const NAV = [
  { label: 'Overview',  href: '/dashboard' },
  { label: 'Contacts',  href: '/dashboard/contacts' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [email, setEmail] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/')
      else setEmail(data.user.email ?? '')
    })
  }, [router])

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: '100vh' }}>

      {/* ── Sidebar ── */}
      <aside style={{ background: '#2A2A2A', color: '#fff', padding: '28px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 40 }}>
          <Image src="/logo.png" alt="Shelley Residential" width={160} height={80} style={{ filter: 'brightness(0) invert(1)' }} />
        </div>

        <nav style={{ flex: 1 }}>
          {NAV.map(item => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '11px 12px',
                  marginBottom: 2,
                  fontSize: 14,
                  color: active ? '#fff' : '#cfcfcf',
                  fontWeight: active ? 700 : 400,
                  borderLeft: active ? '2px solid #E8266F' : '2px solid transparent',
                  paddingLeft: active ? 10 : 12,
                  textDecoration: 'none',
                }}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div style={{ borderTop: '1px solid #3a3a3a', paddingTop: 20 }}>
          <p style={{ fontSize: 12, color: '#6E6E6E', marginBottom: 8, wordBreak: 'break-all' }}>{email}</p>
          <button
            onClick={signOut}
            style={{ fontSize: 12, color: '#6E6E6E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ background: '#F1F0EE', minHeight: '100vh' }}>
        {children}
      </main>

    </div>
  )
}
