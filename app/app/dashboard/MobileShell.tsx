'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, usePathname } from 'next/navigation'
import Image from 'next/image'

const ANALYSE_ROUTES = ['/dashboard/analyse', '/dashboard/contacts', '/dashboard/properties', '/dashboard/evaluations']

// The top bar is `fixed` (not `sticky`) so it can translate fully out of
// view on scroll-down -- main gets matching padding-top so content starts
// below it instead of sliding underneath.
const HEADER_HEIGHT = 72

function HamburgerIcon({ color = 'white' }: { color?: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M3 6h18M3 12h18M3 18h18" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 10 10"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease', flexShrink: 0 }}>
      <path d="M2 3.5L5 6.5L8 3.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Phone chrome: a slim top bar with a hamburger button that opens a
// FULL-SCREEN nav overlay (not a partial-width drawer) -- tapping any item
// closes the menu and navigates in the same motion, per an explicit design
// decision for the mobile UI rather than shrinking the desktop sidebar down.
export function MobileShell({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [analyseOpen, setAnalyseOpen] = useState(() => ANALYSE_ROUTES.some(r => pathname.startsWith(r)))
  const [email, setEmail] = useState('')
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

  // Close the full-screen menu and re-expand Analyse on navigation --
  // adjusted during render (React's recommended pattern for "reset state
  // when a prop changes") rather than in an effect, to avoid the extra
  // render pass that would cause.
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setMenuOpen(false)
    if (ANALYSE_ROUTES.some(r => pathname.startsWith(r))) setAnalyseOpen(true)
  }

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  // Hide the top bar on scroll-down, reveal it again on scroll-up -- a
  // small threshold on both the delta and a "near top" cutoff stops it
  // flickering on tiny scroll jitter.
  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollY = useRef(0)

  useEffect(() => {
    function onScroll() {
      const currentY = window.scrollY
      if (currentY < 10) {
        setHeaderVisible(true)
      } else if (currentY > lastScrollY.current + 5) {
        setHeaderVisible(false)
      } else if (currentY < lastScrollY.current - 5) {
        setHeaderVisible(true)
      }
      lastScrollY.current = currentY
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function go(href: string) {
    setMenuOpen(false)
    router.push(href)
  }

  const dashboardActive = pathname === '/dashboard'
  const analyseActive   = pathname === '/dashboard/analyse'

  const navItemCls = (active: boolean) =>
    `w-full flex items-center justify-between text-left py-4 text-xl border-b border-white/10 ${active ? 'font-bold text-white' : 'font-normal text-white/80'}`
  const subNavItemCls = (active: boolean) =>
    `w-full text-left py-3.5 text-lg border-b border-white/10 ${active ? 'font-bold text-white' : 'font-normal text-white/70'}`

  return (
    <div className="min-h-screen" style={{ background: '#FAFAF9' }}>

      {/* ── Top bar -- fixed + translated, not sticky, so it can slide
          fully out of view on scroll-down and back in on scroll-up. ── */}
      <div
        className={`fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 transition-transform duration-300 ease-in-out ${headerVisible ? 'translate-y-0' : '-translate-y-full'}`}
        style={{ background: '#2A2A2A', height: HEADER_HEIGHT }}
      >
        <button type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)} className="p-1 -ml-1">
          <HamburgerIcon />
        </button>
        <Image src="/logo.png" alt="Shelley Residential" width={100} height={50} style={{ filter: 'brightness(0) invert(1)' }} />
        <button type="button" aria-label="Account" onClick={() => go('/dashboard/settings')} className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
          {avatarUrl ? (
            <Image src={avatarUrl} alt={displayName} width={36} height={36} referrerPolicy="no-referrer" style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-base font-bold text-white" style={{ background: '#E8266F' }}>
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </button>
      </div>

      {/* ── Full-screen nav overlay ── */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#2A2A2A' }}>
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
            <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)} className="p-1 -ml-1">
              <CloseIcon />
            </button>
            <Image src="/logo.png" alt="Shelley Residential" width={100} height={50} style={{ filter: 'brightness(0) invert(1)' }} />
            {/* Spacer balancing the close button so the logo stays centered */}
            <div className="w-9" />
          </div>

          <nav className="flex-1 overflow-y-auto px-6">
            <button type="button" onClick={() => go('/dashboard')} className={navItemCls(dashboardActive)}>
              Dashboard
            </button>
            <button type="button" onClick={() => setAnalyseOpen(o => !o)} className={navItemCls(analyseActive)}>
              Analyse
              <ChevronIcon open={analyseOpen} />
            </button>
            {analyseOpen && (
              <div className="pl-4">
                <button type="button" onClick={() => go('/dashboard/contacts')} className={subNavItemCls(pathname.startsWith('/dashboard/contacts'))}>
                  Contacts
                </button>
                <button type="button" onClick={() => go('/dashboard/properties')} className={subNavItemCls(pathname.startsWith('/dashboard/properties'))}>
                  Properties
                </button>
                <button type="button" onClick={() => go('/dashboard/evaluations')} className={subNavItemCls(pathname.startsWith('/dashboard/evaluations'))}>
                  Evaluations
                </button>
              </div>
            )}
          </nav>

          <p className="px-6 text-xs text-white text-left flex-shrink-0" style={{ marginBottom: 16 }}>
            One Name. One Team. <span style={{ color: '#E8266F', fontWeight: 700 }}>One Standard.</span>
          </p>

          <button
            type="button"
            onClick={() => go('/dashboard/settings')}
            className="flex items-center gap-3 px-6 py-5 border-t border-white/10 flex-shrink-0"
          >
            {avatarUrl ? (
              <Image src={avatarUrl} alt={displayName} width={40} height={40} referrerPolicy="no-referrer" style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold text-white flex-shrink-0" style={{ background: '#E8266F' }}>
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-left min-w-0">
              <p className="text-white font-medium text-sm truncate">{displayName}</p>
              <p className="text-white/50 text-xs truncate">{email}</p>
            </div>
          </button>
        </div>
      )}

      <main style={{ paddingTop: HEADER_HEIGHT }}>{children}</main>
    </div>
  )
}
