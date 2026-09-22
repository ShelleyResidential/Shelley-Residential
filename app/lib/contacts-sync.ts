import { supabaseAdmin } from '@/lib/supabase-admin'
import { getValidAccessToken } from '@/lib/calendar-tokens'
import { fetchGoogleContactsPage } from '@/lib/google-contacts'
import { normalizeToE164 } from '@/lib/phone'

type SyncPageResult = { ok: boolean; created: number; updated: number; skipped: number; nextPageToken?: string; error?: string }

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
  if (!accessToken) return { ok: false, created: 0, updated: 0, skipped: 0, error: 'Google account not connected' }

  const { contacts: googleContacts, nextPageToken, error } = await fetchGoogleContactsPage(accessToken, pageToken)
  if (error) return { ok: false, created: 0, updated: 0, skipped: 0, error }
  if (googleContacts.length === 0) return { ok: true, created: 0, updated: 0, skipped: 0, nextPageToken }

  const resourceNames = googleContacts.map(c => c.resourceName)
  const normalizedPhones = [...new Set(
    googleContacts.map(c => normalizeToE164(c.phone)).filter((p): p is string => !!p)
  )]

  const [{ data: existingRows }, { data: phoneOwnerRows }] = await Promise.all([
    // Fields we must never clobber on a re-sync -- they're either edited by
    // hand in the app or set once at creation, not something Google knows
    // about, so preserve whatever's already there.
    supabaseAdmin
      .from('contacts')
      .select('google_resource_name, status, marital_status, contact_preference, phone_number')
      .eq('created_by', userId)
      .in('google_resource_name', resourceNames),
    // Who (if anyone) already has a contact with each of these phone
    // numbers, regardless of agent -- phone numbers are globally unique
    // across the whole table, so this is at most one owner per number.
    normalizedPhones.length
      ? supabaseAdmin.from('contacts').select('phone_number, created_by').in('phone_number', normalizedPhones)
      : Promise.resolve({ data: [] as { phone_number: string; created_by: string | null }[] }),
  ])

  const existingByResource = new Map((existingRows ?? []).map(r => [r.google_resource_name as string, r]))
  const ownerByPhone = new Map((phoneOwnerRows ?? []).map(r => [r.phone_number as string, r.created_by]))

  let skipped = 0
  const rows: Record<string, unknown>[] = []

  for (const gc of googleContacts) {
    const existing = existingByResource.get(gc.resourceName)
    // Google hands back whatever format the source phone/contact used --
    // normalized to E.164 here so a sync can never violate the
    // contacts.phone_number CHECK constraint (or hand the WhatsApp
    // reminder workflow an unusable number). A contact with no usable
    // number (ambiguous format, USSD code, etc.) just gets phone_number
    // null rather than blocking the whole sync.
    const normalizedPhone = normalizeToE164(gc.phone)
    const ownerId = normalizedPhone ? ownerByPhone.get(normalizedPhone) : undefined
    const heldByAnotherAgent = !!ownerId && ownerId !== userId

    // This agent doesn't have this Google contact yet, and someone else
    // already has a contact with the exact same phone number -- skip
    // instead of creating a second row for the same real person. This is
    // the single biggest source of duplicate contacts: two agents both
    // having the same client saved in their own phone's Google Contacts.
    if (!existing && heldByAnotherAgent) {
      skipped++
      continue
    }

    const fullName = [gc.firstName, gc.lastName].filter(Boolean).join(' ')
    rows.push({
      created_by:           userId,
      agent_id:             userId,
      google_resource_name: gc.resourceName,
      google_synced_at:     new Date().toISOString(),
      title:                gc.title,
      first_name:           gc.firstName ?? '',
      last_name:            gc.lastName ?? '',
      name:                 fullName || gc.phone || gc.email || 'Unnamed contact',
      // Same rule applies to an update on an already-synced contact -- if
      // Google's copy of the number now matches someone else's contact,
      // keep whatever's on file rather than overwrite it into a duplicate.
      phone_number:         heldByAnotherAgent ? (existing?.phone_number ?? null) : normalizedPhone,
      email_address:        gc.email,
      company_name:         gc.companyName,
      occupation:           gc.occupation,
      birthday:             gc.birthday,
      // Preserve manually-set values across a re-sync; only default them on
      // first creation.
      status:              existing?.status ?? 'Active',
      marital_status:      existing?.marital_status ?? null,
      contact_preference:  existing?.contact_preference ?? null,
    })
  }

  if (rows.length === 0) {
    return { ok: true, created: 0, updated: 0, skipped, nextPageToken }
  }

  const { error: upsertError } = await supabaseAdmin
    .from('contacts')
    .upsert(rows, { onConflict: 'created_by,google_resource_name' })

  if (upsertError) return { ok: false, created: 0, updated: 0, skipped: 0, error: upsertError.message }

  const created = rows.filter(r => !existingByResource.has(r.google_resource_name as string)).length
  return { ok: true, created, updated: rows.length - created, skipped, nextPageToken }
}
