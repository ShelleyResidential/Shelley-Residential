const PEOPLE_BASE_URL         = 'https://people.googleapis.com/v1'
const PEOPLE_CONNECTIONS_URL  = `${PEOPLE_BASE_URL}/people/me/connections`
const PERSON_FIELDS = 'names,nicknames,emailAddresses,phoneNumbers,organizations,birthdays'
// Only the fields we ever write back -- kept separate from PERSON_FIELDS
// (which also reads nicknames, something we have no app-side field for and
// so never push).
const WRITABLE_PERSON_FIELDS = 'names,phoneNumbers,emailAddresses,organizations,birthdays'

export type GoogleContact = {
  resourceName:  string
  title:         string | null
  firstName:     string | null
  lastName:      string | null
  phone:         string | null
  email:         string | null
  companyName:   string | null
  occupation:    string | null
  birthday:      string | null // ISO 'YYYY-MM-DD', only when Google has a full date incl. year
}

type PersonResource = {
  resourceName: string
  names?: { givenName?: string; middleName?: string; familyName?: string; honorificPrefix?: string; metadata?: { primary?: boolean } }[]
  emailAddresses?: { value?: string; metadata?: { primary?: boolean } }[]
  phoneNumbers?: { value?: string; metadata?: { primary?: boolean } }[]
  organizations?: { name?: string; title?: string; metadata?: { primary?: boolean } }[]
  birthdays?: { date?: { year?: number; month?: number; day?: number } }[]
}

function primaryOrFirst<T extends { metadata?: { primary?: boolean } }>(items: T[] | undefined): T | undefined {
  if (!items || items.length === 0) return undefined
  return items.find(i => i.metadata?.primary) ?? items[0]
}

function normalize(person: PersonResource): GoogleContact | null {
  const name    = primaryOrFirst(person.names)
  const email   = primaryOrFirst(person.emailAddresses)
  const phone   = primaryOrFirst(person.phoneNumbers)
  const org     = primaryOrFirst(person.organizations)
  const bday    = person.birthdays?.[0]?.date

  // Our schema has no middle-name column -- fold it into first name (e.g.
  // "Test" + "Contact" -> "Test Contact") rather than silently dropping it,
  // which is what happens when Google splits a full name like
  // "Test Contact V2" into given="Test", middle="Contact", family="V2".
  const firstName = [name?.givenName?.trim(), name?.middleName?.trim()].filter(Boolean).join(' ') || null
  const lastName  = name?.familyName?.trim() || null

  // A contact must have both a name and a phone number to be worth
  // anything in the app -- skip anything Google has as just a bare number
  // with no name, or a name with no number, rather than saving a record
  // nobody can actually use to reach the person.
  if ((!firstName && !lastName) || !phone?.value?.trim()) return null

  const birthday = bday?.year && bday.month && bday.day
    ? `${bday.year}-${String(bday.month).padStart(2, '0')}-${String(bday.day).padStart(2, '0')}`
    : null

  return {
    resourceName: person.resourceName,
    title:        name?.honorificPrefix?.trim() || null,
    firstName,
    lastName,
    phone:        phone?.value?.trim() || null,
    email:        email?.value?.trim() || null,
    companyName:  org?.name?.trim() || null,
    occupation:   org?.title?.trim() || null,
    birthday,
  }
}

// Pulls ONE page of the user's "My Contacts" (~150-200 people). Deliberately
// not looped internally into "fetch everything" -- on Vercel Hobby, a
// serverless function hard-stops at 10 seconds, and a personal account can
// have thousands of contacts, so paginating through all of them plus
// writing each page to the database can blow past that limit and get
// silently killed mid-sync. The caller (a client-side loop for the manual
// button, or a time-budgeted loop for the cron) drives the pagination
// across many short calls instead of one long one.
export async function fetchGoogleContactsPage(
  accessToken: string,
  pageToken?: string | null,
): Promise<{ contacts: GoogleContact[]; nextPageToken?: string; error?: string }> {
  const params = new URLSearchParams({
    personFields: PERSON_FIELDS,
    pageSize:     '200',
  })
  if (pageToken) params.set('pageToken', pageToken)

  const res  = await fetch(`${PEOPLE_CONNECTIONS_URL}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const json = await res.json()
  if (json.error) return { contacts: [], error: json.error.message }

  const contacts: GoogleContact[] = []
  for (const person of (json.connections ?? []) as PersonResource[]) {
    const normalized = normalize(person)
    if (normalized) contacts.push(normalized)
  }

  return { contacts, nextPageToken: json.nextPageToken }
}

export type ContactPushFields = {
  title:        string | null
  firstName:    string | null
  lastName:     string | null
  phone:        string | null
  email:        string | null
  companyName:  string | null
  occupation:   string | null
  birthday:     string | null // ISO 'YYYY-MM-DD'
}

// Pushes an app-side edit back out to the matching Google Contact, so the
// two stay in sync instead of the app being a one-way mirror of Google.
// Google requires the contact's current etag on every write (optimistic
// concurrency) -- fetched fresh right here rather than cached anywhere, so
// a write from elsewhere (the person's phone, Google Contacts itself)
// never causes this update to fail with a stale-etag error.
export async function updateGoogleContact(
  accessToken: string,
  resourceName: string,
  fields: ContactPushFields,
): Promise<{ ok: boolean; error?: string }> {
  const getRes  = await fetch(`${PEOPLE_BASE_URL}/${resourceName}?personFields=metadata`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const person = await getRes.json()
  if (person.error) return { ok: false, error: person.error.message }

  let birthdays: { date: { year: number; month: number; day: number } }[] = []
  if (fields.birthday) {
    const [year, month, day] = fields.birthday.split('-').map(Number)
    birthdays = [{ date: { year, month, day } }]
  }

  const body = {
    etag: person.etag,
    names: [{
      givenName:       fields.firstName ?? '',
      familyName:      fields.lastName ?? '',
      honorificPrefix: fields.title ?? '',
    }],
    phoneNumbers:   fields.phone ? [{ value: fields.phone }] : [],
    emailAddresses: fields.email ? [{ value: fields.email }] : [],
    organizations: (fields.companyName || fields.occupation)
      ? [{ name: fields.companyName ?? '', title: fields.occupation ?? '' }]
      : [],
    birthdays,
  }

  const params = new URLSearchParams({ updatePersonFields: WRITABLE_PERSON_FIELDS })
  const res = await fetch(`${PEOPLE_BASE_URL}/${resourceName}:updateContact?${params}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (json.error) return { ok: false, error: json.error.message }
  return { ok: true }
}
