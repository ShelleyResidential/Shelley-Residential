const PEOPLE_CONNECTIONS_URL = 'https://people.googleapis.com/v1/people/me/connections'
const PERSON_FIELDS = 'names,nicknames,emailAddresses,phoneNumbers,organizations,birthdays'

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
  names?: { givenName?: string; familyName?: string; honorificPrefix?: string; metadata?: { primary?: boolean } }[]
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

  const firstName = name?.givenName?.trim() || null
  const lastName  = name?.familyName?.trim() || null

  // Nothing usable to save as a contact -- Google phone contacts saved as
  // just a bare number with no name still need at least one identifying
  // field, otherwise there's nothing to show anywhere in the app.
  if (!firstName && !lastName && !phone?.value && !email?.value) return null

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

// Pulls every contact in the user's "My Contacts" -- paginated, since a
// personal Google account can easily have hundreds to thousands saved.
export async function fetchAllGoogleContacts(accessToken: string): Promise<{ contacts: GoogleContact[]; error?: string }> {
  const contacts: GoogleContact[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      personFields: PERSON_FIELDS,
      pageSize:     '1000',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res  = await fetch(`${PEOPLE_CONNECTIONS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const json = await res.json()
    if (json.error) return { contacts, error: json.error.message }

    for (const person of (json.connections ?? []) as PersonResource[]) {
      const normalized = normalize(person)
      if (normalized) contacts.push(normalized)
    }

    pageToken = json.nextPageToken
  } while (pageToken)

  return { contacts }
}
