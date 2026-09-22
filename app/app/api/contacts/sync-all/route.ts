import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { syncContactsPage } from '@/lib/contacts-sync'

// Stay well clear of Vercel Hobby's hard 10s function limit -- this cron
// has no browser sitting there to loop requests for it the way the manual
// "Sync Contacts" button does, so it has to police its own time budget and
// simply pick up where it left off on the next scheduled run.
const TIME_BUDGET_MS = 8000

// Daily cron (see vercel.json) -- syncs Google Contacts for every user who
// has Google Calendar/Contacts connected, so everyone's contacts stay
// current without anyone having to remember to click "Sync Contacts".
// Each user's progress through their contact list is saved as a Google
// pageToken (user_google_tokens.contacts_sync_cursor), so a personal
// account too large to finish syncing in one run's time budget just
// continues from where it stopped on the following day's run, rather than
// restarting from scratch or silently only ever covering the first chunk.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  const { data: connected } = await supabaseAdmin
    .from('user_google_tokens')
    .select('user_id, contacts_sync_cursor')

  const results: { userId: string; created: number; updated: number; done: boolean; error?: string }[] = []

  for (const row of connected ?? []) {
    if (Date.now() - start > TIME_BUDGET_MS) break // out of time -- remaining users get picked up next run

    let pageToken = row.contacts_sync_cursor ?? undefined
    let created = 0
    let updated = 0
    let sawError: string | undefined

    while (Date.now() - start < TIME_BUDGET_MS) {
      const page = await syncContactsPage(row.user_id, pageToken)
      if (!page.ok) { sawError = page.error; break }
      created += page.created
      updated += page.updated
      pageToken = page.nextPageToken
      if (!pageToken) break // this user is fully caught up
    }

    // On error, reset rather than get permanently stuck retrying a token
    // Google no longer honours -- the next run starts that user over.
    await supabaseAdmin.from('user_google_tokens')
      .update({ contacts_sync_cursor: sawError ? null : (pageToken ?? null) })
      .eq('user_id', row.user_id)

    results.push({ userId: row.user_id, created, updated, done: !pageToken, error: sawError })
  }

  return NextResponse.json({
    usersProcessed: results.length,
    created: results.reduce((sum, r) => sum + r.created, 0),
    updated: results.reduce((sum, r) => sum + r.updated, 0),
    stillInProgress: results.filter(r => !r.done && !r.error).map(r => r.userId),
    failures: results.filter(r => r.error).map(r => ({ userId: r.userId, error: r.error })),
  })
}
