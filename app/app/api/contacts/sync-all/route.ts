import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { syncContactsForUser } from '@/lib/contacts-sync'

// Every connected user is synced concurrently, and any one of them could
// have a large personal contact list -- same headroom as the manual sync
// route, for the same reason.
export const maxDuration = 300

// Daily cron (see vercel.json) -- syncs Google Contacts for every user who
// has Google Calendar/Contacts connected, so everyone's contacts stay
// current without anyone having to remember to click "Sync Contacts".
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: connected } = await supabaseAdmin.from('user_google_tokens').select('user_id')

  const results = await Promise.all(
    (connected ?? []).map(async row => ({ userId: row.user_id, ...(await syncContactsForUser(row.user_id)) }))
  )

  return NextResponse.json({
    usersChecked: results.length,
    created: results.reduce((sum, r) => sum + r.created, 0),
    updated: results.reduce((sum, r) => sum + r.updated, 0),
    failures: results.filter(r => !r.ok).map(r => ({ userId: r.userId, error: r.error })),
  })
}
