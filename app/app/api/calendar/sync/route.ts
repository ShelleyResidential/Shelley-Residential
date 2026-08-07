import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { upsertCalendarEvent } from '@/lib/google-calendar'
import { getValidAccessToken } from '@/lib/calendar-tokens'
import { ensureWatchChannel, hasWatchChannel } from '@/lib/calendar-watch'

const PARTNERS_EMAIL = 'Partners@shelley.co.za'

export async function POST(request: NextRequest) {
  const { evaluationId, userId } = await request.json()

  if (!evaluationId || !userId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Google Calendar not connected. Go to Settings to connect it.' },
      { status: 400 },
    )
  }

  // Get evaluation details
  const { data: ev } = await supabaseAdmin
    .from('evaluations')
    .select(`
      scheduled_at, google_calendar_event_id,
      motivation_for_selling_notes, selling_timeline_notes,
      lead_generated_by, lead_source_other_text, sellers_agent_user_id,
      properties (property_type, unit_number, complex_or_building_name, street_number, street_name, suburb, city, google_maps_url),
      lead_source_picklist:lead_source_option_id (label),
      evaluation_contacts (
        is_primary, sort_order,
        contacts (first_name, last_name, phone_number, email_address),
        picklist_options:tag_option_id (label)
      )
    `)
    .eq('id', evaluationId)
    .single()

  if (!ev?.scheduled_at) {
    return NextResponse.json({ error: 'Evaluation has no scheduled date set.' }, { status: 400 })
  }

  // Build a short heading (unit + complex + suburb) for the event title, and
  // a separate street-based address for the Maps link -- a unit/complex name
  // alone doesn't reliably geocode.
  type PropertyInfo = {
    property_type: string | null
    unit_number: string | null
    complex_or_building_name: string | null
    street_number: string | null
    street_name: string | null
    suburb: string | null
    city: string | null
    google_maps_url: string | null
  }
  function capitalizeWords(text: string): string {
    return text.replace(/\b\w/g, c => c.toUpperCase())
  }
  const prop = ev.properties as unknown as PropertyInfo | null
  let title = 'Unknown address'
  let mapAddress = ''
  if (prop) {
    const street = [prop.street_number, prop.street_name].filter(Boolean).join(' ')
    // Space-joined and including the city, matching the address format used
    // for the "View Maps" navigation link elsewhere in the app.
    mapAddress = [street, prop.suburb, prop.city].filter(Boolean).join(' ')
    if (prop.property_type === 'sectional_title' && prop.unit_number) {
      const unit = [`Unit ${prop.unit_number}`, prop.complex_or_building_name ? capitalizeWords(prop.complex_or_building_name) : null].filter(Boolean).join(' ')
      title = [unit, prop.suburb].filter(Boolean).join(', ')
    } else {
      title = [street, prop.suburb].filter(Boolean).join(', ') || 'Unknown address'
    }
  }
  const mapsLink = prop?.google_maps_url
    || (mapAddress ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapAddress)}` : null)

  // ── Description: one bold-headed section per evaluation detail. Any
  // section with no underlying value must literally say "left blank".
  function section(heading: string, lines: string[]): string {
    const body = lines.filter(Boolean).length > 0 ? lines.filter(Boolean).join('\n') : 'left blank'
    return `<b>${heading}</b>\n${body}`
  }

  const leadGeneratedByLabel = ev.lead_generated_by === 'seller_agent_partner'
    ? 'Agent'
    : ev.lead_generated_by === 'shelley_residential'
      ? 'Shelley Residential'
      : ''
  const leadSourceLabel = ev.lead_source_other_text
    ?? (ev.lead_source_picklist as unknown as { label: string } | null)?.label
    ?? ''

  type ContactRow = {
    is_primary: boolean
    sort_order: number | null
    contacts: { first_name: string; last_name: string; phone_number: string | null; email_address: string | null } | null
    picklist_options: { label: string } | null
  }
  const contactRows = ((ev.evaluation_contacts as unknown as ContactRow[]) ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const contactLines = contactRows.flatMap(row => {
    if (!row.contacts) return []
    const name       = [row.contacts.first_name, row.contacts.last_name].filter(Boolean).join(' ')
    const tag        = row.picklist_options?.label ?? ''
    const phoneEmail = [row.contacts.phone_number, row.contacts.email_address].filter(Boolean).join(' | ')
    return [name, tag, phoneEmail].filter(Boolean)
  })

  const { data: agentProfile } = ev.sellers_agent_user_id
    ? await supabaseAdmin.from('profiles').select('full_name, email').eq('id', ev.sellers_agent_user_id).single()
    : { data: null }
  const agentName = agentProfile?.full_name ?? agentProfile?.email ?? ''

  const description = [
    section('Motivation for Selling', [ev.motivation_for_selling_notes ?? '']),
    section('Selling Timeline',       [ev.selling_timeline_notes ?? '']),
    section('Lead Generated By',      [leadGeneratedByLabel]),
    section('Lead Source',            [leadSourceLabel]),
    section('Contact Details',        contactLines),
    section('Agent',                  [agentName]),
  ].join('\n\n')

  // scheduled_at's digits are captured and displayed everywhere else in the
  // app (see EvaluationForm's schedDate/schedTime fields) as literal
  // Johannesburg wall-clock time, with no timezone conversion. Google
  // Calendar's `dateTime` must therefore be sent WITHOUT a UTC "Z" suffix --
  // otherwise Google treats it as a true UTC instant and, paired with
  // timeZone: 'Africa/Johannesburg', shifts the displayed time by +2 hours.
  // Duration is always fixed at 45 minutes, regardless of any other setting.
  const start = new Date(ev.scheduled_at).toISOString().slice(0, 19)
  const end   = new Date(new Date(ev.scheduled_at).getTime() + 45 * 60 * 1000).toISOString().slice(0, 19)

  const calEvent = await upsertCalendarEvent(
    accessToken,
    {
      summary:     `Evaluation | ${title}`,
      description,
      location:    mapsLink ?? (mapAddress || title),
      start,
      end,
      attendees: [PARTNERS_EMAIL],
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

  // The "Scheduled" status only fires once the calendar event has actually
  // been sent -- never override a manually-chosen or already-progressed
  // status, so this only ever promotes from 'new'.
  await supabaseAdmin.from('evaluations').update({
    status: 'scheduled',
  }).eq('id', evaluationId).eq('status', 'new')

  // Fallback for users who connected Google Calendar before automatic
  // Calendar -> evaluation sync existed: the normal path sets this up on
  // login (see google-signin/callback), so this only ever runs once per
  // user -- awaited because a fire-and-forget promise isn't guaranteed to
  // finish once a serverless response has been sent.
  if (!(await hasWatchChannel(userId))) {
    try {
      await ensureWatchChannel(userId)
    } catch (err) {
      console.error('Failed to set up calendar watch channel:', err)
    }
  }

  return NextResponse.json({ link: calEvent.htmlLink, eventId: calEvent.id })
}
