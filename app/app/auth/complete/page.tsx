'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function AuthCompletePage() {
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    const params = new URLSearchParams(hash)
    const accessToken  = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    // TEMP-DEBUG: remove after diagnosing missing photo
    console.log('google sign-in debug:', {
      name:    params.get('debug_name'),
      picture: params.get('debug_picture'),
    })

    if (!accessToken || !refreshToken) {
      router.replace('/?error=signin_failed')
      return
    }

    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError(sessionError.message)
          return
        }
        router.replace('/dashboard')
      })
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <p className="text-sm text-gray-400">
        {error ? `Sign-in failed: ${error}` : 'Signing in…'}
      </p>
    </div>
  )
}
