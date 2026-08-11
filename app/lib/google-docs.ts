const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DOCS_BASE_URL    = 'https://docs.googleapis.com/v1/documents'

// Copies an existing Drive file (the cover letter template) into a new
// file the caller owns -- required before editing it, since we never want
// to touch the shared template itself.
export async function copyDriveFile(accessToken: string, fileId: string, name: string) {
  const res = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/copy`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  return res.json() as Promise<{ id: string; error?: { message: string } }>
}

// Fills every {{merge_field}} in a Doc via a single batchUpdate -- e.g.
// { '{{agent_name}}': 'Josh Buitendach' }.
export async function replaceTextInDoc(accessToken: string, documentId: string, replacements: Record<string, string>) {
  const requests = Object.entries(replacements).map(([placeholder, value]) => ({
    replaceAllText: {
      containsText: { text: placeholder, matchCase: true },
      replaceText:  value,
    },
  }))
  const res = await fetch(`${DOCS_BASE_URL}/${encodeURIComponent(documentId)}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  })
  const json = await res.json()
  return json.error ? { error: json.error as { message: string } } : {}
}

export async function exportDocAsPdf(accessToken: string, fileId: string): Promise<{ bytes?: ArrayBuffer; error?: string }> {
  const res = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}/export?mimeType=application%2Fpdf`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as { error?: { message?: string } }
    return { error: json.error?.message ?? `PDF export failed (${res.status})` }
  }
  return { bytes: await res.arrayBuffer() }
}

// Best-effort cleanup of the intermediate Doc copy once its PDF has been
// exported into our own storage -- failures here are never fatal to the
// overall generation.
export async function deleteDriveFile(accessToken: string, fileId: string) {
  try {
    await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    // ignore -- an orphaned Doc copy in Drive is a minor cleanup issue, not
    // worth failing the whole generation over.
  }
}
