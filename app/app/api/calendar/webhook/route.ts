import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getValidAccessToken } from '@/lib/calendar-tokens'
import { listChangedEvents } from '@/lib/google-calendar'

// Google Calendar push notifications carry no body -- just headers
// announcing that *something* changed on a watched calendar. We look up
// which user's channel this is, pull the incremental diff via the stored
// sync token, and update any evaluation whose linked event moved or was
// cancelled. This is what makes Calendar -> evaluation sync automatic: an
// agent dragging an event to a new time in Google Calendar now updates the
// Evaluation Date and Time on its own, with no action needed in the app.
export async function POST(request: NextRequest) {
  const channelId     = request.headers.get('x-goog-channel-id')
  const channelToken  = request.headers.get('x-goog-channel-token')
  const resourceState = request.headers.get('x-goog-resource-state')

  if (!channelId || !channelToken) {
    return NextResponse.json({ error: 'Missing channel headers' }, { status: 400 })
  }

  const { data: channel } = await supabaseAdmin
    .from('user_calendar_watch_channels')
    .select('user_id, sync_token, channel_token')
    .eq('channel_id', channelId)
    .maybeSingle()

  // Unknown channel, or the token doesn't match what we handed Google when
  // creating it -- reject rather than trust an unverified caller (Google
  // doesn't sign these requests, so this token is the only proof it's us).
  if (!channel || channel.channel_token !== channelToken) {
    return NextResponse.json({ error: 'Unknown channel' }, { status: 404 })
  }

  // "sync" is the one-time handshake Google sends the moment a channel is
  // created -- nothing has actually changed yet.
  if (resourceState === 'sync') {
    return NextResponse.json({ ok: true })
  }

  const accessToken = await getValidAccessToken(channel.user_id)
  if (!accessToken) return NextResponse.json({ ok: true }) // token gone; nothing we can do

  let result = await listChangedEvents(accessToken, channel.sync_token)

  // Expired/invalid sync token -- reset the baseline and skip this round's
  // diff. The next real change is caught normally from here on.
  if (result.error?.code === 410) {
    result = await listChangedEvents(accessToken, null)
    await supabaseAdmin.from('user_calendar_watch_channels')
      .update({ sync_token: result.nextSyncToken ?? null })
      .eq('channel_id', channelId)
    return NextResponse.json({ ok: true, resynced: true })
  }

  if (result.error) {
    // Let Google retry with backoff rather than silently dropping a real
    // change on a transient failure.
    return NextResponse.json({ error: result.error.message }, { status: 500 })
  }

  for (const item of result.items) {
    if (item.status === 'cancelled') {
      await supabaseAdmin.from('evaluations')
        .update({ google_calendar_event_id: null, calendar_event_link: null })
        .eq('google_calendar_event_id', item.id)
      continue
    }

    const dateTime = item.start?.dateTime
    if (!dateTime) continue // all-day event, or one without a time -- not one of ours

    // Same convention used when we write the event (see calendar/sync):
    // store the literal local wall-clock digits Google hands back, not a
    // UTC-converted instant. Africa/Johannesburg has no DST, so the
    // "+02:00" offset Google always returns for our events is a constant --
    // we don't even need to read it, just the digits before it.
    const literal = dateTime.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)?.[0]
    if (!literal) continue

    const { data: ev } = await supabaseAdmin
      .from('evaluations')
      .select('id, scheduled_at')
      .eq('google_calendar_event_id', item.id)
      .maybeSingle()

    if (!ev) continue // this event isn't linked to an evaluation

    if (ev.scheduled_at?.slice(0, 16) === literal) continue // no actual change

    await supabaseAdmin.from('evaluations')
      .update({ scheduled_at: `${literal}:00` })
      .eq('id', ev.id)
  }

  if (result.nextSyncToken) {
    await supabaseAdmin.from('user_calendar_watch_channels')
      .update({ sync_token: result.nextSyncToken })
      .eq('channel_id', channelId)
  }

  return NextResponse.json({ ok: true })
}
