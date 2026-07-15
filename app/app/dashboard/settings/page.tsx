'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { card, btn, sectionTitle, label as labelCls } from '@/lib/styles'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function SettingsPage() {
  const router = useRouter()
  const [userEmail, setUserEmail] = useState('')
  const [fullName, setFullName]   = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      const meta = data.user.user_metadata ?? {}
      setUserEmail(data.user.email ?? '')
      setFullName(meta.full_name ?? meta.name ?? '')
      setAvatarUrl(meta.avatar_url ?? meta.picture ?? null)
    })
  }, [router])

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="p-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-[#1a1a1a]">Settings</h1>
        <button onClick={signOut} className={btn.danger}>
          Sign out
        </button>
      </div>

      <div className="max-w-2xl">
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
      </div>
    </div>
  )
}
