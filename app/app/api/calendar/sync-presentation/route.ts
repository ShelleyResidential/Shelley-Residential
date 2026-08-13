import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { upsertCalendarEvent } from '@/lib/google-calendar'
import { getValidAccessToken } from '@/lib/calendar-tokens'

const PARTNERS_EMAIL = 'Partners@shelley.co.za'

// Same pattern as /api/calendar/sync, but for the Presentation Date and
// Time -- its own calendar event, separate from the evaluation appointment
// one. Status 6 "Presentation Ready" needs this AND the Mandate Pack both
// complete (see lib/pipeline.ts:checkPresentationReadyGate).
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

  const { data: ev } = await supabaseAdmin
    .from('evaluations')
    .select(`
      presentation_scheduled_at, presentation_google_calendar_event_id,
      properties (property_type, unit_number, complex_or_building_name, street_number, street_name, suburb, city, google_maps_url)
    `)
    .eq('id', evaluationId)
    .single()

  if (!ev?.presentation_scheduled_at) {
    return NextResponse.json({ error: 'Evaluation has no Presentation Date set.' }, { status: 400 })
  }

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

  // Same wall-clock convention as the evaluation appointment event -- no
  // timezone conversion, literal Africa/Johannesburg local time.
  const start = new Date(ev.presentation_scheduled_at).toISOString().slice(0, 19)
  const end   = new Date(new Date(ev.presentation_scheduled_at).getTime() + 45 * 60 * 1000).toISOString().slice(0, 19)

  const calEvent = await upsertCalendarEvent(
    accessToken,
    {
      summary:     `Presentation | ${title}`,
      description: 'Seller presentation for this evaluation.',
      location:    mapsLink ?? (mapAddress || title),
      start,
      end,
      attendees: [PARTNERS_EMAIL],
    },
    (ev as Record<string, unknown>).presentation_google_calendar_event_id as string | null,
  )

  if (calEvent.error) {
    return NextResponse.json({ error: calEvent.error.message }, { status: 500 })
  }

  await supabaseAdmin.from('evaluations').update({
    presentation_google_calendar_event_id: calEvent.id,
    presentation_calendar_event_link:      calEvent.htmlLink,
  }).eq('id', evaluationId)

  // Mark the "Presentation Scheduled" step and re-check whether Presentation
  // Ready (this + Mandate Pack) is now satisfied.
  await supabaseAdmin.from('evaluation_pipeline_steps').update({
    status: 'complete', is_complete: true,
    completed_at: new Date().toISOString(), completed_by_user_id: userId,
  }).eq('evaluation_id', evaluationId).eq('step_key', 'presentation_scheduled')

  const { data: steps } = await supabaseAdmin
    .from('evaluation_pipeline_steps')
    .select('step_key, status')
    .eq('evaluation_id', evaluationId)
    .in('step_key', ['mandate_pack_prepared', 'presentation_scheduled'])

  const allComplete = ['mandate_pack_prepared', 'presentation_scheduled']
    .every(k => (steps ?? []).find(s => s.step_key === k)?.status === 'complete')

  if (allComplete) {
    const { data: current } = await supabaseAdmin.from('evaluations').select('status').eq('id', evaluationId).single()
    const STATUS_RANK: Record<string, number> = { new: 0, scheduled: 1, prepared: 2, inspected: 3, evaluated: 4, presentation_ready: 5, presented: 6, closed: 7 }
    if (current && (STATUS_RANK['presentation_ready'] > (STATUS_RANK[current.status] ?? -1))) {
      await supabaseAdmin.from('evaluations').update({ status: 'presentation_ready' }).eq('id', evaluationId)
    }
  }

  return NextResponse.json({ link: calEvent.htmlLink, eventId: calEvent.id })
}
