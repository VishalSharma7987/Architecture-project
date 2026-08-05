import { parseDesign, type DesignDocument, type ParseResult } from './schema'

/** Turns a project name into something safe to use as a filename. */
export function toFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'design'}.json`
}

/** Triggers a browser download of the document as pretty-printed JSON. */
export function downloadDesign(doc: DesignDocument): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = toFileName(doc.name)
  anchor.click()

  // Without this the blob is pinned in memory for the life of the document.
  URL.revokeObjectURL(url)
}

/** Reads and validates a user-chosen .json file. */
export async function readDesignFile(file: File): Promise<ParseResult> {
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, error: 'Could not read that file.' }
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }

  return parseDesign(json)
}
