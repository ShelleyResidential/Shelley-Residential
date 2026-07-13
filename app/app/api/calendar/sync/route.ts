import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshAccessToken, upsertCalendarEvent } from '@/lib/google-calendar'

export async function POST(request: NextRequest) {
  const { evaluationId, userId } = await request.json()

  if (!evaluationId || !userId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Get stored tokens
  const { data: tokenRow } = await supabaseAdmin
    .from('user_google_tokens')
    .select('access_token, refresh_token, token_expiry')
    .eq('user_id', userId)
    .single()

  if (!tokenRow) {
    return NextResponse.json(
      { error: 'Google Calendar not connected. Go to Settings to connect it.' },
      { status: 400 },
    )
  }

  // Refresh access token if expired (within 60 s of expiry)
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

  // Get evaluation details
  const { data: ev } = await supabaseAdmin
    .from('evaluations')
    .select(`
      scheduled_at, google_calendar_event_id,
      properties (property_type, unit_number, complex_or_building_name, street_number, street_name, suburb),
      lead_source_picklist:lead_source_option_id (label),
      evaluation_contacts (
        is_primary,
        contacts (first_name, last_name)
      )
    `)
    .eq('id', evaluationId)
    .single()

  if (!ev?.scheduled_at) {
    return NextResponse.json({ error: 'Evaluation has no scheduled date set.' }, { status: 400 })
  }

  // Build human-readable address
  const prop = ev.properties as Record<string, string | null> | null
  let address = 'Unknown address'
  if (prop) {
    if (prop.property_type === 'sectional_title' && prop.unit_number) {
      address = `Unit ${prop.unit_number}${prop.complex_or_building_name ? ' ' + prop.complex_or_building_name : ''}${prop.suburb ? ', ' + prop.suburb : ''}`
    } else {
      address = [prop.street_number, prop.street_name, prop.suburb].filter(Boolean).join(' ') || 'Unknown address'
    }
  }

  const contacts    = (ev.evaluation_contacts as { is_primary: boolean; contacts: { first_name: string; last_name: string } | null }[]) ?? []
  const primary     = contacts.find(c => c.is_primary) ?? contacts[0]
  const contactName = primary?.contacts ? `${primary.contacts.first_name} ${primary.contacts.last_name}`.trim() : ''
  const leadSource  = (ev.lead_source_picklist as { label: string } | null)?.label ?? ''

  const start = new Date(ev.scheduled_at).toISOString()
  const end   = new Date(new Date(ev.scheduled_at).getTime() + 60 * 60 * 1000).toISOString()

  const calEvent = await upsertCalendarEvent(
    accessToken,
    {
      summary:     `Evaluation — ${address}`,
      description: [contactName && `Contact: ${contactName}`, leadSource && `Source: ${leadSource}`].filter(Boolean).join('\n'),
      location:    address,
      start,
      end,
    },
    (ev as Record<string, unknown>).google_calendar_event_id as string | null,
  )

  if (calEvent.error) {
    return NextResponse.json({ error: calEvent.error.message }, { status: 500 })
  }

  // Persist event ID and link back onto the evaluation
  await supabaseAdmin.from('evaluations').update({
    google_calendar_event_id: calEvent.id,
    calendar_event_link:      calEvent.htmlLink,
  }).eq('id', evaluationId)

  return NextResponse.json({ link: calEvent.htmlLink, eventId: calEvent.id })
}
