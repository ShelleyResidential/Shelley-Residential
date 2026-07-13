import { NextRequest, NextResponse } from 'next/server'
import { buildGoogleAuthUrl } from '@/lib/google-calendar'

export async function GET(request: NextRequest) {
  const uid = request.nextUrl.searchParams.get('uid')
  if (!uid) return NextResponse.json({ error: 'Missing uid' }, { status: 400 })

  const nonce       = crypto.randomUUID()
  const state       = `${nonce}|${uid}`
  const appUrl      = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const redirectUri = `${appUrl}/api/auth/google/callback`
  const authUrl     = buildGoogleAuthUrl(state, redirectUri)

  const response = NextResponse.redirect(authUrl)
  response.cookies.set('google_oauth_nonce', nonce, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   600,
    sameSite: 'lax',
    path:     '/',
  })
  return response
}
