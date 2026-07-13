import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyGoogleIdToken } from '@/lib/google-signin'
import { supabaseAdmin } from '@/lib/supabase-admin'

const ALLOWED_DOMAIN = 'shelley.co.za'

export async function POST(request: NextRequest) {
  const { idToken } = await request.json()
  if (!idToken) {
    return NextResponse.json({ error: 'Missing ID token.' }, { status: 400 })
  }

  let payload
  try {
    payload = await verifyGoogleIdToken(idToken)
  } catch {
    return NextResponse.json({ error: 'Invalid Google token.' }, { status: 400 })
  }

  if (!payload?.email) {
    return NextResponse.json({ error: 'Invalid Google token.' }, { status: 400 })
  }

  const emailDomain = payload.email.split('@')[1]?.toLowerCase()
  const hdMatches    = payload.hd === ALLOWED_DOMAIN
  const emailMatches = emailDomain === ALLOWED_DOMAIN

  if (!payload.email_verified || !hdMatches || !emailMatches) {
    return NextResponse.json(
      { error: `Access restricted to @${ALLOWED_DOMAIN} company accounts.` },
      { status: 403 },
    )
  }

  // Verification passed — exchange the Google ID token for a real Supabase session
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  })

  if (error || !data.session) {
    return NextResponse.json({ error: error?.message ?? 'Sign-in failed.' }, { status: 400 })
  }

  // Persist the verified name/photo ourselves — signInWithIdToken doesn't
  // reliably populate user_metadata from the Google token on its own.
  let metadataError: string | null = null
  if (data.user) {
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
      user_metadata: {
        full_name:  payload.name,
        avatar_url: payload.picture,
      },
    })
    if (updateError) metadataError = updateError.message
  }

  return NextResponse.json({
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    full_name:     payload.name ?? null,
    avatar_url:    payload.picture ?? null,
    metadataError,
  })
}
