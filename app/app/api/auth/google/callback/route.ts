import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/google-calendar'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  if (error || !code || !state) {
    return NextResponse.redirect(`${appUrl}/dashboard/settings?error=google_denied`)
  }

  const [nonce, userId] = state.split('|')
  const storedNonce = request.cookies.get('google_oauth_nonce')?.value

  if (!storedNonce || storedNonce !== nonce || !userId) {
    return NextResponse.redirect(`${appUrl}/dashboard/settings?error=invalid_state`)
  }

  const redirectUri = `${appUrl}/api/auth/google/callback`
  const tokens = await exchangeCodeForTokens(code, redirectUri)

  if (tokens.error) {
    return NextResponse.redirect(`${appUrl}/dashboard/settings?error=token_exchange`)
  }

  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await supabaseAdmin.from('user_google_tokens').upsert(
    {
      user_id:       userId,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expiry:  expiry,
    },
    { onConflict: 'user_id' },
  )

  const response = NextResponse.redirect(`${appUrl}/dashboard/settings?connected=true`)
  response.cookies.set('google_oauth_nonce', '', { maxAge: 0, path: '/' })
  return response
}
