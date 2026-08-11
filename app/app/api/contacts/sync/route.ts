import { NextRequest, NextResponse } from 'next/server'
import { syncContactsPage } from '@/lib/contacts-sync'

// Manual "Sync Contacts" button. Processes ONE page (~200 contacts) per
// call and hands back nextPageToken -- the client loops this until it's
// empty, so a personal account with thousands of contacts still finishes
// completely, just across several quick requests instead of one that would
// risk exceeding Vercel's 10s Hobby-plan function limit.
export async function POST(request: NextRequest) {
  const { userId, pageToken } = await request.json()
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const result = await syncContactsPage(userId, pageToken ?? null)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Sync failed' }, { status: 400 })
  }

  return NextResponse.json({
    created: result.created,
    updated: result.updated,
    nextPageToken: result.nextPageToken ?? null,
  })
}
