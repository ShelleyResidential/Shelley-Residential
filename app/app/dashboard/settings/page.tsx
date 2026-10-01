'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { card, btn, sectionTitle, label as labelCls } from '@/lib/styles'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { useMobileLoadingGate } from '@/lib/MobileLoadingGate'
import { ProfessionalDetailsForm } from './ProfessionalDetailsForm'

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 10 10"
      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s ease', flexShrink: 0 }}
    >
      <path d="M2 3.5L5 6.5L8 3.5" stroke="#1a1a1a" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const [userEmail, setUserEmail] = useState('')
  const [fullName, setFullName]   = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [professionalOpen, setProfessionalOpen] = useState(false)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      const meta = data.user.user_metadata ?? {}
      setUserEmail(data.user.email ?? '')
      setFullName(meta.full_name ?? meta.name ?? '')
      setAvatarUrl(meta.avatar_url ?? meta.picture ?? null)
      setLoading(false)
    })
  }, [router])

  useMobileLoadingGate('settings', loading)

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="p-4 md:p-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-lg sm:text-2xl font-bold text-[#1a1a1a]">Settings</h1>
        <button onClick={signOut} className={btn.danger}>
          Sign out
        </button>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Account */}
        <div className={`${card} p-6`}>
          <h3 className={sectionTitle}>Account</h3>
          <div className="flex items-center gap-4 mb-5">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={fullName || userEmail}
                width={56}
                height={56}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#E8266F] text-white flex items-center justify-center text-lg font-bold flex-shrink-0">
                {(fullName || userEmail).charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-[#1a1a1a] font-semibold">{fullName || '—'}</p>
              <p className="text-sm text-gray-400">{userEmail}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <span className={labelCls}>Full Name</span>
              <p className="text-[#1a1a1a] font-medium">{fullName || '—'}</p>
            </div>
            <div>
              <span className={labelCls}>Email</span>
              <p className="text-[#1a1a1a] font-medium">{userEmail}</p>
            </div>
          </div>
        </div>

        {/* Professional Details -- used on generated documents like the
            evaluation Cover Letter (designation + phone under your name).
            On mobile a dropdown here pushed the rest of the page down
            awkwardly, so it's its own page there instead; desktop keeps the
            inline collapse, closed by default so it's not all exposed. */}
        <Link
          href="/dashboard/settings/professional"
          className={`${card} md:hidden flex items-center justify-between p-6`}
        >
          <h3 className="text-sm font-bold text-[#1a1a1a] uppercase tracking-wide">Professional Details</h3>
          <ChevronIcon open={false} />
        </Link>

        <div className={`${card} overflow-hidden hidden md:block`}>
          <button
            type="button"
            onClick={() => setProfessionalOpen(o => !o)}
            aria-expanded={professionalOpen}
            className="w-full flex items-center justify-between p-6 text-left"
          >
            <h3 className="text-sm font-bold text-[#1a1a1a] uppercase tracking-wide">Professional Details</h3>
            <ChevronIcon open={professionalOpen} />
          </button>
          {professionalOpen && (
            <div className="px-6 pb-6">
              <ProfessionalDetailsForm />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
