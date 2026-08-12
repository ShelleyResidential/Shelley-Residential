import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getValidAccessToken } from '@/lib/calendar-tokens'
import { updateGoogleContact } from '@/lib/google-contacts'

// The subset of a contact's fields that also live in Google Contacts --
// editing any of these on a Google-linked contact needs to push out to
// Google too, not just save locally. (status/marital_status/contact_preference
// etc. are app-only and never touch Google -- same split contacts-sync.ts
// uses for the sync running the other way.)
const GOOGLE_OWNED_FIELDS = [
  'title', 'first_name', 'last_name', 'phone_number',
  'email_address', 'company_name', 'occupation', 'birthday',
] as const

type GoogleOwnedField = typeof GOOGLE_OWNED_FIELDS[number]
type ExistingRow = Record<GoogleOwnedField, string | null> & { google_resource_name: string | null; created_by: string | null }

// Saves an edited contact. If it's linked to a Google Contact and the edit
// touches a field Google also knows about, pushes that change out to
// Google first -- best-effort, so a failed push (token expired, account
// disconnected) doesn't block saving locally, it's just surfaced back to
// the caller as a warning instead of silently disappearing. Otherwise the
// next scheduled Google->app sync would revert the edit right back, since
// it always trusts Google's copy for these fields.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const updates = await request.json()

  const { data: existing } = await supabaseAdmin
    .from('contacts')
    .select(`google_resource_name, created_by, ${GOOGLE_OWNED_FIELDS.join(', ')}`)
    .eq('id', id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  const existingRow = existing as unknown as ExistingRow

  let googlePushError: string | null = null

  const touchesGoogleField = GOOGLE_OWNED_FIELDS.some(f => f in updates && updates[f] !== existingRow[f])

  if (existingRow.google_resource_name && existingRow.created_by && touchesGoogleField) {
    const accessToken = await getValidAccessToken(existingRow.created_by)
    if (!accessToken) {
      googlePushError = "This contact's Google account isn't connected, so the change wasn't pushed to Google Contacts."
    } else {
      const merged = (f: GoogleOwnedField) => (f in updates ? updates[f] : existingRow[f])
      const result = await updateGoogleContact(accessToken, existingRow.google_resource_name, {
        title:       merged('title'),
        firstName:   merged('first_name'),
        lastName:    merged('last_name'),
        phone:       merged('phone_number'),
        email:       merged('email_address'),
        companyName: merged('company_name'),
        occupation:  merged('occupation'),
        birthday:    merged('birthday'),
      })
      if (!result.ok) googlePushError = `Saved here, but couldn't update Google Contacts: ${result.error}`
    }
  }

  const { error: dbError } = await supabaseAdmin.from('contacts').update(updates).eq('id', id)
  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, googlePushError })
}
