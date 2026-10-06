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

// ── Structural editing -- enough of the Docs API's document JSON shape to
// walk tables and locate specific paragraphs by their text, so a caller can
// delete exact lines (e.g. unused repeating-section slots) rather than just
// blanking their text, which replaceAllText alone can't do.
type GoogleDocParagraph = { elements?: { textRun?: { content?: string } }[] }
type GoogleDocTableCell = { content?: GoogleDocElement[] }
type GoogleDocTable = { tableRows?: { tableCells?: GoogleDocTableCell[] }[] }
export type GoogleDocElement = {
  startIndex?: number
  endIndex?: number
  paragraph?: GoogleDocParagraph
  table?: GoogleDocTable
}
export type GoogleDoc = { body?: { content?: GoogleDocElement[] } }

export async function getDocument(accessToken: string, documentId: string): Promise<{ document?: GoogleDoc; error?: { message: string } }> {
  const res = await fetch(`${DOCS_BASE_URL}/${encodeURIComponent(documentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const json = await res.json()
  return json.error ? { error: json.error as { message: string } } : { document: json as GoogleDoc }
}

function paragraphText(p: GoogleDocParagraph): string {
  return (p.elements ?? []).map(e => e.textRun?.content ?? '').join('').trim()
}

// Recurses through the document body (including inside tables, since
// that's where every field in this app's templates lives) and returns the
// start/endIndex of every paragraph whose text exactly matches one of
// `texts` -- in document order. endIndex includes the paragraph's own
// trailing newline, so deleting [startIndex, endIndex) collapses the whole
// line rather than leaving an empty one behind.
export function findParagraphsByText(doc: GoogleDoc, texts: string[]): { text: string; startIndex: number; endIndex: number }[] {
  const wanted = new Set(texts)
  const found: { text: string; startIndex: number; endIndex: number }[] = []

  function walk(elements: GoogleDocElement[] | undefined) {
    for (const el of elements ?? []) {
      if (el.paragraph) {
        const text = paragraphText(el.paragraph)
        if (wanted.has(text) && el.startIndex != null && el.endIndex != null) {
          found.push({ text, startIndex: el.startIndex, endIndex: el.endIndex })
        }
      }
      if (el.table) {
        for (const row of el.table.tableRows ?? []) {
          for (const cell of row.tableCells ?? []) {
            walk(cell.content)
          }
        }
      }
    }
  }
  walk(doc.body?.content)
  return found
}

// Deletes a batch of structural ranges (e.g. unused repeating-section
// paragraph lines) in one batchUpdate. `ranges` MUST already be sorted
// highest-startIndex-first by the caller: the Docs API applies batchUpdate
// requests strictly in array order, each re-indexing the document before
// the next is interpreted, so deleting a lower range first would shift the
// indices of higher ranges still queued.
export async function deleteParagraphRanges(accessToken: string, documentId: string, ranges: { startIndex: number; endIndex: number }[]) {
  if (ranges.length === 0) return {}
  const requests = ranges.map(range => ({ deleteContentRange: { range } }))
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
