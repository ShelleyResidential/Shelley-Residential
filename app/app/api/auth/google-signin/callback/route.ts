import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exchangeCodeForTokens } from '@/lib/google-calendar'
import { verifyGoogleIdToken } from '@/lib/google-signin'
import { supabaseAdmin } from '@/lib/supabase-admin'

const ALLOWED_DOMAIN = 'shelley.co.za'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  if (error || !code || !state) {
    return NextResponse.redirect(`${appUrl}/?error=google_denied`)
  }

  const storedNonce = request.cookies.get('google_login_nonce')?.value
  if (!storedNonce || storedNonce !== state) {
    return NextResponse.redirect(`${appUrl}/?error=invalid_state`)
  }

  const redirectUri = `${appUrl}/api/auth/google-signin/callback`
  const tokens = await exchangeCodeForTokens(code, redirectUri)

  if (tokens.error || !tokens.id_token) {
    return NextResponse.redirect(`${appUrl}/?error=token_exchange`)
  }

  let payload
  try {
    payload = await verifyGoogleIdToken(tokens.id_token)
  } catch {
    return NextResponse.redirect(`${appUrl}/?error=invalid_token`)
  }

  if (!payload?.email) {
    return NextResponse.redirect(`${appUrl}/?error=invalid_token`)
  }

  const emailDomain = payload.email.split('@')[1]?.toLowerCase()
  const hdMatches    = payload.hd === ALLOWED_DOMAIN
  const emailMatches = emailDomain === ALLOWED_DOMAIN

  if (!payload.email_verified || !hdMatches || !emailMatches) {
    const response = NextResponse.redirect(`${appUrl}/?error=restricted_domain`)
    response.cookies.set('google_login_nonce', '', { maxAge: 0, path: '/' })
    return response
  }

  // Verification passed — exchange the Google ID token for a real Supabase session
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data, error: signInError } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: tokens.id_token,
  })

  if (signInError || !data.session || !data.user) {
    return NextResponse.redirect(`${appUrl}/?error=signin_failed`)
  }

  // Persist verified name/photo
  const { error: metaError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
    user_metadata: {
      full_name:  payload.name,
      avatar_url: payload.picture,
    },
  })
  if (metaError) console.error('Failed to persist Google profile metadata:', metaError.message)

  // Store Calendar tokens automatically — this is the "auto-connect" step
  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await supabaseAdmin.from('user_google_tokens').upsert(
    {
      user_id:       data.user.id,
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expiry:  expiry,
    },
    { onConflict: 'user_id' },
  )

  const response = NextResponse.redirect(
    `${appUrl}/auth/complete#access_token=${encodeURIComponent(data.session.access_token)}&refresh_token=${encodeURIComponent(data.session.refresh_token)}`,
  )
  response.cookies.set('google_login_nonce', '', { maxAge: 0, path: '/' })
  return response
}
