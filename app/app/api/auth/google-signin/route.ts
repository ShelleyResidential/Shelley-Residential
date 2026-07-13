import { NextResponse } from 'next/server'
import { buildGoogleLoginAuthUrl } from '@/lib/google-calendar'

export async function GET() {
  const nonce       = crypto.randomUUID()
  const appUrl      = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectUri = `${appUrl}/api/auth/google-signin/callback`
  const authUrl     = buildGoogleLoginAuthUrl(nonce, redirectUri)

  const response = NextResponse.redirect(authUrl)
  response.cookies.set('google_login_nonce', nonce, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   600,
    sameSite: 'lax',
    path:     '/',
  })
  return response
}
