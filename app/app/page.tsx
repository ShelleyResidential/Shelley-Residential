'use client'

import { useState, useEffect, Suspense } from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'

const ERROR_MESSAGES: Record<string, string> = {
  google_denied:     'Google sign-in was cancelled.',
  invalid_state:     'Sign-in session expired. Please try again.',
  token_exchange:     'Failed to complete Google sign-in. Please try again.',
  invalid_token:      'Failed to verify Google sign-in. Please try again.',
  restricted_domain:  'Access restricted to @shelley.co.za company accounts.',
  signin_failed:      'Sign-in failed. Please try again.',
}

function LoginContent() {
  const searchParams = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const err = searchParams.get('error')
    if (err) setError(ERROR_MESSAGES[err] ?? 'Sign-in failed. Please try again.')
  }, [searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-full max-w-md px-4">

        {/* Brand */}
        <div className="text-center mb-10">
          <Image
            src="/logo.png"
            alt="Shelley Residential"
            width={280}
            height={140}
            className="mx-auto"
            priority
          />
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h2 className="text-xl font-semibold text-[#1a1a1a] mb-6">Sign in to your account</h2>

          <a
            href="/api/auth/google-signin"
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg border border-gray-200 text-sm font-medium text-[#1a1a1a] hover:bg-gray-50 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
              <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/>
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59A9 9 0 0 0 .96 4.95L3.97 7.28C4.68 5.16 6.66 3.58 9 3.58z"/>
            </svg>
            Sign in with Google
          </a>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 px-4 py-3 rounded-lg mt-4">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <LoginContent />
    </Suspense>
  )
}
