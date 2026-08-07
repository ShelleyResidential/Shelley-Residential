import { randomUUID, randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getValidAccessToken } from '@/lib/calendar-tokens'
import { watchCalendarEvents, stopWatchChannel, listChangedEvents } from '@/lib/google-calendar'

const WEBHOOK_PATH = '/api/calendar/webhook'

// (Re)establishes a Google Calendar push-notification channel for a user so
// changes made directly in Google Calendar (e.g. dragging an evaluation's
// event to a new time) flow back into the app automatically, instead of the
// sync only ever going app -> Calendar. One channel per user -- calling
// this again (e.g. on renewal, or on a fresh login) replaces the previous
// one.
export async function ensureWatchChannel(userId: string): Promise<{ ok: boolean; error?: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl || appUrl.includes('localhost')) {
    // Google can't deliver push notifications to a local dev URL -- skip
    // quietly rather than fail every login/save in local development.
    return { ok: false, error: 'skipped (no public app URL)' }
  }

  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) return { ok: false, error: 'Google Calendar not connected' }

  const { data: existing } = await supabaseAdmin
    .from('user_calendar_watch_channels')
    .select('channel_id, resource_id')
    .eq('user_id', userId)
    .maybeSingle()

  const channelId    = randomUUID()
  const channelToken = randomBytes(24).toString('hex')

  const result = await watchCalendarEvents(accessToken, channelId, channelToken, `${appUrl}${WEBHOOK_PATH}`)
  if (result.error || !result.resourceId || !result.expiration) {
    return { ok: false, error: result.error?.message ?? 'watch request failed' }
  }

  // Establish a sync-token baseline right away, so the first real
  // notification only has to diff since now rather than list every event
  // on the calendar.
  const initial = await listChangedEvents(accessToken, null)

  await supabaseAdmin.from('user_calendar_watch_channels').upsert(
    {
      user_id:       userId,
      channel_id:    channelId,
      resource_id:   result.resourceId,
      channel_token: channelToken,
      sync_token:    initial.nextSyncToken ?? null,
      expiration:    new Date(Number(result.expiration)).toISOString(),
    },
    { onConflict: 'user_id' },
  )

  // Best-effort: stop the old channel so Google isn't left notifying one we
  // no longer track. Failure here is harmless -- it'll just expire on its
  // own -- so it must never block the new channel from being saved.
  if (existing) {
    stopWatchChannel(accessToken, existing.channel_id, existing.resource_id).catch(() => {})
  }

  return { ok: true }
}

export async function hasWatchChannel(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('user_calendar_watch_channels')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}
