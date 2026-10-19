import { supabaseAdmin } from '@/lib/supabase-admin'

type EvRow = {
  id: string
  scheduled_at: string | null
  seller_google_calendar_event_id: string | null
  sellers_agent_user_id: string | null
  evaluation_contacts: {
    is_primary: boolean
    sort_order: number | null
    contact_id: string
    picklist_options: { label: string } | null
  }[]
}

// An evaluation can be scheduled before the seller's email is known -- the
// internal Partners invite goes out, the seller's doesn't. Once an email is
// finally added to that seller, this finds every scheduled evaluation the
// contact is the seller on that never got a seller invite, and runs the
// normal calendar sync for each so the invite goes out. Same seller pick
// order as the sync route: Seller tag, then primary, then first contact.
export async function sendPendingSellerInvites(contactId: string, fallbackUserId: string | null, origin: string): Promise<number> {
  const { data: links } = await supabaseAdmin
    .from('evaluation_contacts').select('evaluation_id').eq('contact_id', contactId)
  const evaluationIds = [...new Set((links ?? []).map(l => l.evaluation_id as string))]
  if (evaluationIds.length === 0) return 0

  const { data: evaluations } = await supabaseAdmin
    .from('evaluations')
    .select(`
      id, scheduled_at, seller_google_calendar_event_id, sellers_agent_user_id,
      evaluation_contacts (is_primary, sort_order, contact_id, picklist_options:tag_option_id (label))
    `)
    .in('id', evaluationIds)
    .not('scheduled_at', 'is', null)
    .is('seller_google_calendar_event_id', null)

  let sent = 0
  for (const ev of (evaluations ?? []) as unknown as EvRow[]) {
    const rows = [...ev.evaluation_contacts].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const seller = rows.find(r => r.picklist_options?.label === 'Seller') ?? rows.find(r => r.is_primary) ?? rows[0]
    if (seller?.contact_id !== contactId) continue

    const userIds = [ev.sellers_agent_user_id, fallbackUserId].filter((u, i, a): u is string => !!u && a.indexOf(u) === i)
    for (const userId of userIds) {
      const res = await fetch(`${origin}/api/calendar/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evaluationId: ev.id, userId }),
      }).catch(() => null)
      if (res?.ok) { sent++; break }
    }
  }
  return sent
}
