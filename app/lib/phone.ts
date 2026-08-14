// Shared phone-number handling: normalize whatever format a source hands us
// (Google Contacts, manual entry) down to E.164 for storage, and format an
// E.164 value back to a friendly local display for South African numbers,
// so the app never shows a "+27" prefix in front of every number.
//
// Used by: the Google Contacts sync (lib/contacts-sync.ts), the Settings
// page's phone field, and anywhere a contact/agent phone number is
// rendered read-only (Contacts list, Contact Details, etc).

// Strips whitespace/punctuation AND invisible Unicode directional marks
// (U+200E/200F/202A-202E) that some phones/OSes silently insert into
// copy-pasted numbers.
function clean(raw: string): string {
  return raw.replace(/[\s\-().‎‏‪-‮]/g, '')
}

// Returns a valid E.164 string, or null if the input isn't usable as a
// phone number at all (a USSD code, an incomplete number with no country
// signal, empty). Never guesses a country code beyond South Africa (+27)
// for a bare leading-0 local number -- anything else ambiguous is
// deliberately left unset rather than risk messaging the wrong number.
export function normalizeToE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = clean(raw)

  if (cleaned.startsWith('+')) {
    return /^\+[1-9]\d{6,14}$/.test(cleaned) ? cleaned : null
  }
  // International dialing prefix ("00" + country code) instead of "+".
  if (/^00\d{7,}$/.test(cleaned)) {
    const withPlus = '+' + cleaned.slice(2)
    return /^\+[1-9]\d{6,14}$/.test(withPlus) ? withPlus : null
  }
  // South African local format: leading 0 + 9 digits (10 digits total).
  if (/^0\d{9}$/.test(cleaned)) {
    return '+27' + cleaned.slice(1)
  }
  return null
}

const E164_PATTERN = /^\+[1-9]\d{6,14}$/

export function isValidE164(value: string | null | undefined): boolean {
  return !!value && E164_PATTERN.test(value)
}

// E.164 -> friendly display. South African numbers (+27) show as the
// familiar local "0XX XXX XXXX" -- everyone here reads a Shelley Residential
// contact's number that way, not as an international dial string. Any
// other country code is shown as international (nothing else to fall back
// to without knowing that country's local convention).
export function formatPhoneDisplay(value: string | null | undefined): string {
  if (!value) return '—'
  if (value.startsWith('+27')) {
    const local = '0' + value.slice(3) // +27821234567 -> 0821234567
    if (/^0\d{9}$/.test(local)) {
      return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
    }
  }
  return value
}
