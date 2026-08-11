const GOOGLE_TOKEN_URL   = 'https://oauth2.googleapis.com/token'
const CALENDAR_BASE      = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const CALENDAR_CHANNELS_STOP_URL = 'https://www.googleapis.com/calendar/v3/channels/stop'

// Combined sign-in + Calendar consent — used by the login flow so Calendar
// access is granted automatically as part of signing in with Google.
export function buildGoogleLoginAuthUrl(state: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/contacts.readonly',
    access_type:   'offline',
    prompt:        'select_account',
    hd:            'shelley.co.za',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  })
  return res.json() as Promise<{
    access_token: string; refresh_token?: string; id_token?: string; expires_in: number; error?: string
  }>
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token:  refreshToken,
      client_id:      process.env.GOOGLE_CLIENT_ID!,
      client_secret:  process.env.GOOGLE_CLIENT_SECRET!,
      grant_type:     'refresh_token',
    }),
  })
  return res.json() as Promise<{ access_token: string; expires_in: number; error?: string }>
}

export async function upsertCalendarEvent(
  accessToken: string,
  event: { summary: string; description: string; location: string; start: string; end: string; attendees?: string[] },
  existingEventId?: string | null,
) {
  const body = {
    summary:     event.summary,
    description: event.description,
    location:    event.location,
    start: { dateTime: event.start, timeZone: 'Africa/Johannesburg' },
    end:   { dateTime: event.end,   timeZone: 'Africa/Johannesburg' },
    ...(event.attendees && event.attendees.length > 0
      ? { attendees: event.attendees.map(email => ({ email })) }
      : {}),
  }
  const base   = existingEventId ? `${CALENDAR_BASE}/${existingEventId}` : CALENDAR_BASE
  // sendUpdates=all so attendees actually receive the invite email.
  const url    = `${base}?sendUpdates=all`
  const method = existingEventId ? 'PUT' : 'POST'
  const res = await fetch(url, {
    method,
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return res.json() as Promise<{ id: string; htmlLink: string; error?: { message: string } }>
}

export async function getCalendarEvent(accessToken: string, eventId: string) {
  const res = await fetch(`${CALENDAR_BASE}/${eventId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return res.json() as Promise<{
    id: string
    start?: { dateTime?: string; date?: string }
    error?: { message: string }
  }>
}

// ── Push notifications (watch channel) ──────────────────────────
// Lets Google tell us the moment something changes on a user's calendar
// (e.g. an evaluation's event gets dragged to a new time), instead of only
// ever syncing app -> Calendar. See app/lib/calendar-watch.ts for the
// orchestration (token lookup, DB bookkeeping, renewal).
export async function watchCalendarEvents(
  accessToken: string,
  channelId: string,
  channelToken: string,
  webhookUrl: string,
) {
  const res = await fetch(`${CALENDAR_BASE}/watch`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id:      channelId,
      type:    'web_hook',
      address: webhookUrl,
      token:   channelToken,
    }),
  })
  return res.json() as Promise<{
    resourceId?: string
    expiration?: string
    error?: { message: string }
  }>
}

export async function stopWatchChannel(accessToken: string, channelId: string, resourceId: string) {
  await fetch(CALENDAR_CHANNELS_STOP_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: channelId, resourceId }),
  })
}

type CalendarEventSummary = {
  id: string
  status: string
  start?: { dateTime?: string; date?: string }
}

// Pulls everything that changed since `syncToken` (or, with no token yet,
// establishes a fresh baseline by listing everything currently on the
// calendar). Always uses the same parameters either way -- Google requires
// that for a sync token to stay valid across calls.
export async function listChangedEvents(accessToken: string, syncToken?: string | null) {
  const items: CalendarEventSummary[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | undefined
  let error: { message: string; code?: number } | undefined

  do {
    const params = new URLSearchParams({ singleEvents: 'true' })
    if (syncToken) params.set('syncToken', syncToken)
    if (pageToken) params.set('pageToken', pageToken)

    const res  = await fetch(`${CALENDAR_BASE}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const json = await res.json()
    if (json.error) { error = { message: json.error.message, code: res.status }; break }

    items.push(...(json.items ?? []))
    pageToken     = json.nextPageToken
    nextSyncToken = json.nextSyncToken
  } while (pageToken)

  return { items, nextSyncToken, error }
}
