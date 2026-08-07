import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ensureWatchChannel } from '@/lib/calendar-watch'

// Google Calendar watch channels expire (typically within about a week).
// This runs on a daily schedule (see vercel.json) and re-creates any
// channel within 2 days of expiring, so the automatic Calendar ->
// evaluation sync never silently goes stale.
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
  const { data: expiring } = await supabaseAdmin
    .from('user_calendar_watch_channels')
    .select('user_id')
    .lt('expiration', soon)

  const results = await Promise.all((expiring ?? []).map(row => ensureWatchChannel(row.user_id)))

  return NextResponse.json({
    checked: expiring?.length ?? 0,
    renewed: results.filter(r => r.ok).length,
  })
}
