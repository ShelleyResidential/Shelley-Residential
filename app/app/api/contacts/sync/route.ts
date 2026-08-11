import { NextRequest, NextResponse } from 'next/server'
import { syncContactsForUser } from '@/lib/contacts-sync'

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
