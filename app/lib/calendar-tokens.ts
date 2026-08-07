import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshAccessToken } from '@/lib/google-calendar'

// Fetches a user's stored Google access token, transparently refreshing it
// via the stored refresh_token if it's within 60s of expiry (or already
// expired). Shared by every route that calls the Calendar API on a user's
// behalf: manual event sync, watch-channel setup/renewal, and the webhook.
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const { data: tokenRow } = await supabaseAdmin
    .from('user_google_tokens')
    .select('access_token, refresh_token, token_expiry')
    .eq('user_id', userId)
    .single()

  if (!tokenRow) return null

  let accessToken = tokenRow.access_token
  const expiryMs  = tokenRow.token_expiry ? new Date(tokenRow.token_expiry).getTime() : 0
  if (Date.now() >= expiryMs - 60_000 && tokenRow.refresh_token) {
    const refreshed = await refreshAccessToken(tokenRow.refresh_token)
    if (!refreshed.error) {
      accessToken = refreshed.access_token
      await supabaseAdmin.from('user_google_tokens').update({
        access_token: refreshed.access_token,
        token_expiry: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      }).eq('user_id', userId)
    }
  }
  return accessToken
}
