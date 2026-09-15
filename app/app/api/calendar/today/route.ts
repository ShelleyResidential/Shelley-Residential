import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listEventsForRange, type CalendarEventDetail } from '@/lib/google-calendar'
import { getValidAccessToken } from '@/lib/calendar-tokens'

// Powers the dashboard's "Today's Briefing" -- the signed-in agent's own
// Google Calendar for today, turned into a day-at-a-glance list. Every
// event on the calendar is included (a true day-at-a-glance, not just
// what this app created); events this app DID create (evaluation and
// presentation appointments -- see /api/calendar/sync and
// /api/calendar/sync-presentation) are additionally enriched with the
// seller/property context by matching the calendar event id back to the
// evaluations table.

function capitalizeWords(text: string): string {
  return text.replace(/\b\w/g, c => c.toUpperCase())
}

type PropertyInfo = {
  property_type: string | null
  unit_number: string | null
  complex_or_building_name: string | null
  street_number: string | null
  street_name: string | null
  suburb: string | null
  city: string | null
} | null

function formatAddress(prop: PropertyInfo): string {
  if (!prop) return 'Unknown address'
  const street = [prop.street_number, prop.street_name].filter(Boolean).join(' ')
  if (prop.property_type === 'sectional_title' && prop.unit_number) {
    const unit = [`Unit ${prop.unit_number}`, prop.complex_or_building_name ? capitalizeWords(prop.complex_or_building_name) : null].filter(Boolean).join(' ')
    return [unit, prop.suburb].filter(Boolean).join(', ')
  }
  return [street, prop.suburb].filter(Boolean).join(', ') || 'Unknown address'
}

type ContactRow = {
  is_primary: boolean
  sort_order: number | null
  contacts: { first_name: string; last_name: string; phone_number: string | null } | null
  picklist_options: { label: string } | null
}

function resolveSeller(rows: ContactRow[] | null | undefined) {
  const sorted = [...(rows ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const seller = sorted.find(c => c.picklist_options?.label === 'Seller') ?? sorted.find(c => c.is_primary) ?? sorted[0]
  if (!seller?.contacts) return null
  return {
    name: [seller.contacts.first_name, seller.contacts.last_name].filter(Boolean).join(' '),
    phone: seller.contacts.phone_number,
  }
}

export type BriefingEvent = {
  id: string
  title: string
  startTime: string | null   // ISO, null for all-day
  endTime: string | null
  allDay: boolean
  location: string | null
  htmlLink: string | null
  kind: 'evaluation' | 'presentation' | 'other'
  evaluationId?: string
  address?: string
  sellerName?: string
  sellerPhone?: string | null
}

export async function POST(request: NextRequest) {
  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) {
    // Every agent signs in with Google, which is what grants this token in
    // the first place -- a missing one means something's actually wrong
    // (revoked access, or a very old session), not just "not connected
    // yet". Surface it rather than pretending there's nothing to show.
    return NextResponse.json({ connected: false, events: [] })
  }

  // "Today" in Africa/Johannesburg terms, regardless of where this route
  // actually runs -- built with an explicit +02:00 offset so the window
  // means the same instant either way.
  const sastNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Johannesburg' }))
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = `${sastNow.getFullYear()}-${pad(sastNow.getMonth() + 1)}-${pad(sastNow.getDate())}`
  const timeMin = `${dateStr}T00:00:00+02:00`
  const timeMax = `${dateStr}T23:59:59+02:00`

  const { items, error } = await listEventsForRange(accessToken, timeMin, timeMax)
  if (error) {
    return NextResponse.json({ connected: true, events: [], error: error.message }, { status: 500 })
  }

  const confirmed = items.filter((e: CalendarEventDetail) => e.status !== 'cancelled')
  const eventIds = confirmed.map(e => e.id).filter(Boolean)

  const evalSelect = `
    id, google_calendar_event_id, presentation_google_calendar_event_id,
    properties (property_type, unit_number, complex_or_building_name, street_number, street_name, suburb, city),
    evaluation_contacts (
      is_primary, sort_order,
      contacts (first_name, last_name, phone_number),
      picklist_options:tag_option_id (label)
    )
  `

  const [{ data: evalMatches }, { data: presMatches }] = eventIds.length
    ? await Promise.all([
        supabaseAdmin.from('evaluations').select(evalSelect).in('google_calendar_event_id', eventIds),
        supabaseAdmin.from('evaluations').select(evalSelect).in('presentation_google_calendar_event_id', eventIds),
      ])
    : [{ data: [] }, { data: [] }]

  type EvalMatch = {
    id: string
    google_calendar_event_id: string | null
    presentation_google_calendar_event_id: string | null
    properties: PropertyInfo
    evaluation_contacts: ContactRow[]
  }

  const byEvalEventId = new Map<string, EvalMatch>()
  for (const row of (evalMatches ?? []) as unknown as EvalMatch[]) {
    if (row.google_calendar_event_id) byEvalEventId.set(row.google_calendar_event_id, row)
  }
  const byPresEventId = new Map<string, EvalMatch>()
  for (const row of (presMatches ?? []) as unknown as EvalMatch[]) {
    if (row.presentation_google_calendar_event_id) byPresEventId.set(row.presentation_google_calendar_event_id, row)
  }

  const events: BriefingEvent[] = confirmed.map(e => {
    const allDay = !e.start?.dateTime
    const base = {
      id: e.id,
      title: e.summary || '(No title)',
      startTime: e.start?.dateTime ?? null,
      endTime: e.end?.dateTime ?? null,
      allDay,
      location: e.location ?? null,
      htmlLink: e.htmlLink ?? null,
    }

    const evalRow = byEvalEventId.get(e.id)
    if (evalRow) {
      const seller = resolveSeller(evalRow.evaluation_contacts)
      return {
        ...base, kind: 'evaluation' as const, evaluationId: evalRow.id,
        address: formatAddress(evalRow.properties),
        sellerName: seller?.name, sellerPhone: seller?.phone,
      }
    }
    const presRow = byPresEventId.get(e.id)
    if (presRow) {
      const seller = resolveSeller(presRow.evaluation_contacts)
      return {
        ...base, kind: 'presentation' as const, evaluationId: presRow.id,
        address: formatAddress(presRow.properties),
        sellerName: seller?.name, sellerPhone: seller?.phone,
      }
    }
    return { ...base, kind: 'other' as const }
  })

  // All-day events first (they don't have a time to sort by), then
  // chronological.
  events.sort((a, b) => {
    if (a.allDay && !b.allDay) return -1
    if (!a.allDay && b.allDay) return 1
    return (a.startTime ?? '').localeCompare(b.startTime ?? '')
  })

  return NextResponse.json({ connected: true, events })
}
