import { NextRequest, NextResponse } from 'next/server'
import { getUnreadInboxCount } from '@/lib/google-gmail'
import { getValidAccessToken } from '@/lib/calendar-tokens'

// Powers the dashboard's unread-email count next to Today's Briefing.
export async function POST(request: NextRequest) {
  const { userId } = await request.json()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) {
    return NextResponse.json({ connected: false, count: null })
  }

  const { count, error } = await getUnreadInboxCount(accessToken)
  if (error) {
    return NextResponse.json({ connected: true, count: null, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ connected: true, count })
}
