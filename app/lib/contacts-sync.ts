import { supabaseAdmin } from '@/lib/supabase-admin'
import { getValidAccessToken } from '@/lib/calendar-tokens'
import { fetchGoogleContactsPage } from '@/lib/google-contacts'
import { normalizeToE164 } from '@/lib/phone'

type SyncPageResult = { ok: boolean; created: number; updated: number; nextPageToken?: string; error?: string }

// Syncs ONE page (~200) of a user's Google contacts into our contacts
// table, owned by that user (so "Captured By" on a synced contact shows
// the person whose phone/Google account it came from). Safe to call
// repeatedly -- each Google contact is matched by its stable resourceName
// (see the unique index on (created_by, google_resource_name)), so
// re-syncing updates the same row instead of creating a duplicate.
//
// Deliberately scoped to one page per call rather than "sync everything" --
// see fetchGoogleContactsPage for why. Callers loop this until
// nextPageToken comes back empty.
export async function syncContactsPage(userId: string, pageToken?: string | null): Promise<SyncPageResult> {
  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) return { ok: false, created: 0, updated: 0, error: 'Google account not connected' }

  const { contacts: googleContacts, nextPageToken, error } = await fetchGoogleContactsPage(accessToken, pageToken)
  if (error) return { ok: false, created: 0, updated: 0, error }
  if (googleContacts.length === 0) return { ok: true, created: 0, updated: 0, nextPageToken }

  const resourceNames = googleContacts.map(c => c.resourceName)

  // Fields we must never clobber on a re-sync -- they're either edited by
  // hand in the app or set once at creation, not something Google knows
  // about, so preserve whatever's already there.
  const { data: existingRows } = await supabaseAdmin
    .from('contacts')
    .select('google_resource_name, status, marital_status, contact_preference')
    .eq('created_by', userId)
    .in('google_resource_name', resourceNames)

  const existingByResource = new Map((existingRows ?? []).map(r => [r.google_resource_name as string, r]))

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
      // Google hands back whatever format the source phone/contact used --
      // normalized to E.164 here so a sync can never violate the
      // contacts.phone_number CHECK constraint (or hand the WhatsApp
      // reminder workflow an unusable number). A contact with no usable
      // number (ambiguous format, USSD code, etc.) just gets phone_number
      // null rather than blocking the whole sync.
      phone_number:         normalizeToE164(gc.phone),
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

  const { error: upsertError } = await supabaseAdmin
    .from('contacts')
    .upsert(rows, { onConflict: 'created_by,google_resource_name' })

  if (upsertError) return { ok: false, created: 0, updated: 0, error: upsertError.message }

  const created = rows.filter(r => !existingByResource.has(r.google_resource_name)).length
  return { ok: true, created, updated: rows.length - created, nextPageToken }
}
