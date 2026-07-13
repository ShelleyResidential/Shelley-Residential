const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_BASE    = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

export function buildGoogleAuthUrl(state: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/calendar.events',
    access_type:   'offline',
    prompt:        'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// Combined sign-in + Calendar consent — used by the login flow so Calendar
// access is granted automatically as part of signing in with Google.
export function buildGoogleLoginAuthUrl(state: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'openid email profile https://www.googleapis.com/auth/calendar.events',
    access_type:   'offline',
    prompt:        'consent',
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
  event: { summary: string; description: string; location: string; start: string; end: string },
  existingEventId?: string | null,
) {
  const body = {
    summary:     event.summary,
    description: event.description,
    location:    event.location,
    start: { dateTime: event.start, timeZone: 'Africa/Johannesburg' },
    end:   { dateTime: event.end,   timeZone: 'Africa/Johannesburg' },
  }
  const url    = existingEventId ? `${CALENDAR_BASE}/${existingEventId}` : CALENDAR_BASE
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
