'use client'

import { useState, useEffect, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { card, btn, sectionTitle, label as labelCls } from '@/lib/styles'
import { useRouter, useSearchParams } from 'next/navigation'

function SettingsContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [userId, setUserId]           = useState<string | null>(null)
  const [userEmail, setUserEmail]     = useState('')
  const [connected, setConnected]     = useState(false)
  const [loading, setLoading]         = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [message, setMessage]         = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUserId(data.user.id)
      setUserEmail(data.user.email ?? '')

      supabase.from('user_google_tokens')
        .select('id')
        .eq('user_id', data.user.id)
        .maybeSingle()
        .then(({ data: t }) => {
          setConnected(!!t)
          setLoading(false)
        })
    })
  }, [router])

  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      setConnected(true)
      setMessage({ type: 'success', text: 'Google Calendar connected successfully.' })
    } else if (searchParams.get('error') === 'google_denied') {
      setMessage({ type: 'error', text: 'Google Calendar connection was cancelled.' })
    } else if (searchParams.get('error')) {
      setMessage({ type: 'error', text: 'Failed to connect Google Calendar. Please try again.' })
    }
  }, [searchParams])

  function connectGoogle() {
    if (!userId) return
    window.location.href = `/api/auth/google?uid=${userId}`
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  async function disconnectGoogle() {
    if (!userId) return
    setDisconnecting(true)
    await supabase.from('user_google_tokens').delete().eq('user_id', userId)
    setConnected(false)
    setDisconnecting(false)
    setMessage({ type: 'success', text: 'Google Calendar disconnected.' })
  }

  return (
    <div className="p-10 max-w-2xl">
      <button onClick={signOut} className={`${btn.danger} mb-6`}>
        Sign out
      </button>

      <h1 className="text-2xl font-bold text-[#1a1a1a] mb-8">Settings</h1>

      {message && (
        <div className={`mb-6 px-4 py-3 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
        }`}>
          {message.text}
        </div>
      )}

      {/* Account */}
      <div className={`${card} p-6 mb-4`}>
        <h3 className={sectionTitle}>Account</h3>
        <div className="text-sm text-gray-600">
          <span className={labelCls}>Email</span>
          <p className="text-[#1a1a1a] font-medium">{userEmail}</p>
        </div>
      </div>

      {/* Google Calendar */}
      <div className={`${card} p-6`}>
        <h3 className={sectionTitle}>Google Calendar</h3>
        <p className="text-sm text-gray-500 mb-5">
          When connected, you can sync evaluation appointments to your Google Calendar directly from the evaluation page.
        </p>

        {loading ? (
          <p className="text-sm text-gray-400">Checking connection…</p>
        ) : connected ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              <span className="text-sm font-medium text-[#1a1a1a]">Connected</span>
            </div>
            <button onClick={disconnectGoogle} disabled={disconnecting} className={btn.danger}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <button onClick={connectGoogle} className={btn.primary}>
            Connect Google Calendar
          </button>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-10 text-gray-400 text-sm">Loading…</div>}>
      <SettingsContent />
    </Suspense>
  )
}
