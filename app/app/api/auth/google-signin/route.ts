import { NextRequest, NextResponse } from 'next/server'
import { buildGoogleLoginAuthUrl } from '@/lib/google-calendar'

export async function GET(request: NextRequest) {
  const nonce       = crypto.randomUUID()
  const appUrl      = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectUri = `${appUrl}/api/auth/google-signin/callback`
  // Only set by the callback route, the one time it detects this account
  // is missing a scope it hasn't granted yet -- forces the full permission
  // screen for that one top-up login instead of every login going forward.
  const forceConsent = request.nextUrl.searchParams.get('force') === '1'
  const authUrl       = buildGoogleLoginAuthUrl(nonce, redirectUri, forceConsent)

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
