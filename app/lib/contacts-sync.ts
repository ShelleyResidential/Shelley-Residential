import { supabaseAdmin } from '@/lib/supabase-admin'
import { getValidAccessToken } from '@/lib/calendar-tokens'
import { fetchAllGoogleContacts } from '@/lib/google-contacts'

const CHUNK_SIZE = 500

type SyncResult = { ok: boolean; created: number; updated: number; error?: string }

// Pulls every contact from a user's @shelley.co.za Google account and
// mirrors it into our contacts table, owned by that user (so "Captured By"
// on a synced contact shows the person whose phone/Google account it came
// from). Safe to call repeatedly -- each Google contact is matched by its
// stable resourceName (see the unique index on (created_by,
// google_resource_name)), so re-syncing updates the same row instead of
// creating a duplicate every time.
export async function syncContactsForUser(userId: string): Promise<SyncResult> {
  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) return { ok: false, created: 0, updated: 0, error: 'Google account not connected' }

  const { contacts: googleContacts, error } = await fetchAllGoogleContacts(accessToken)
  if (error) return { ok: false, created: 0, updated: 0, error }
  if (googleContacts.length === 0) return { ok: true, created: 0, updated: 0 }

  const resourceNames = googleContacts.map(c => c.resourceName)

  // Fields we must never clobber on a re-sync -- they're either edited by
  // hand in the app or set once at creation, not something Google knows
  // about, so preserve whatever's already there. Chunked: a large personal
  // contact list (thousands of entries) would otherwise build a single
  // .in() filter long enough to get rejected outright.
  const existingByResource = new Map<string, { status: string | null; marital_status: string | null; contact_preference: string | null }>()
  for (let i = 0; i < resourceNames.length; i += CHUNK_SIZE) {
    const chunk = resourceNames.slice(i, i + CHUNK_SIZE)
    const { data: existingRows } = await supabaseAdmin
      .from('contacts')
      .select('google_resource_name, status, marital_status, contact_preference')
      .eq('created_by', userId)
      .in('google_resource_name', chunk)

    for (const row of existingRows ?? []) {
      existingByResource.set(row.google_resource_name as string, row)
    }
  }

  const rows = googleContacts.map(gc => {
    const existing = existingByResource.get(gc.resourceName)
    const fullName = [gc.firstName, gc.lastName].filter(Boolean).join(' ')
    return {
      created_by:           userId,
      agent_id:             userId,
      google_resource_name: gc.resourceName,
      google_synced_at:     new Date().toISOString(),
      title:                gc.title,
      first_name:           gc.firstName ?? '',
      last_name:            gc.lastName ?? '',
      name:                 fullName || gc.phone || gc.email || 'Unnamed contact',
      phone_number:         gc.phone,
      email_address:        gc.email,
      company_name:         gc.companyName,
      occupation:           gc.occupation,
      birthday:             gc.birthday,
      // Preserve manually-set values across a re-sync; only default them on
      // first creation.
      status:              existing?.status ?? 'Active',
      marital_status:      existing?.marital_status ?? null,
      contact_preference:  existing?.contact_preference ?? null,
    }
  })

  // Chunked so a large contact list never lands in a single oversized
  // request -- and counted so that if one chunk fails partway through, the
  // caller still learns how much of a big sync actually landed rather than
  // losing that entirely.
  let created = 0
  let updated = 0
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)

    const { error: upsertError } = await supabaseAdmin
      .from('contacts')
      .upsert(chunk, { onConflict: 'created_by,google_resource_name' })

    if (upsertError) {
      return { ok: false, created, updated, error: `${upsertError.message} (after ${created + updated} of ${rows.length} synced)` }
    }

    for (const r of chunk) {
      if (existingByResource.has(r.google_resource_name)) updated++
      else created++
    }
  }

  return { ok: true, created, updated }
}
