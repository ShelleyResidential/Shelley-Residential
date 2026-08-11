import { NextRequest, NextResponse } from 'next/server'
import { syncContactsForUser } from '@/lib/contacts-sync'

// A large personal contact list (thousands of entries, paginated from
// Google plus chunked reads/writes to Supabase) can take longer than the
// platform's default function timeout -- ask for more headroom. Vercel
// caps this to whatever the plan actually allows, so it's a no-op on plans
// that don't support the full 300s.
export const maxDuration = 300

// Manual "Sync Contacts" button -- pulls the requesting user's Google
// contacts into the system immediately, instead of waiting for the daily
// automatic sync (see /api/contacts/sync-all).
export async function POST(request: NextRequest) {
  const { userId } = await request.json()
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const result = await syncContactsForUser(userId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Sync failed' }, { status: 400 })
  }

  return NextResponse.json({ created: result.created, updated: result.updated })
}
