import { parseDesign, type DesignDocument } from './schema'

const PROJECTS_KEY = 'space-design.projects.v1'
const AUTOSAVE_KEY = 'space-design.autosave.v1'

export type ProjectSummary = {
  name: string
  savedAt: string
  wallCount: number
}

export type StorageResult = { ok: true } | { ok: false; error: string }

/**
 * localStorage throws in more cases than people expect — disabled cookies,
 * Safari private browsing, and quota exhaustion all raise. Every access goes
 * through these wrappers so a storage failure degrades to "not saved" instead
 * of taking down the app.
 */
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): StorageResult {
  try {
    localStorage.setItem(key, value)
    return { ok: true }
  } catch (error) {
    const quota =
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
    return {
      ok: false,
      error: quota
        ? 'Browser storage is full — export to JSON instead.'
        : 'Browser storage is unavailable.',
    }
  }
}

/** All stored projects, keyed by name. Unreadable entries are dropped. */
function readProjects(): Record<string, DesignDocument> {
  const raw = readRaw(PROJECTS_KEY)
  if (!raw) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }

    const out: Record<string, DesignDocument> = {}
    for (const [name, value] of Object.entries(parsed)) {
      // Storage is validated like any other input: it may have been written by
      // an older version, or edited by hand in devtools.
      const result = parseDesign(value)
      if (result.ok) out[name] = result.doc
    }
    return out
  } catch {
    return {}
  }
}

export function listProjects(): ProjectSummary[] {
  return Object.entries(readProjects())
    .map(([name, doc]) => ({
      name,
      savedAt: doc.savedAt,
      wallCount: doc.walls.length,
    }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export function saveProject(doc: DesignDocument): StorageResult {
  const projects = readProjects()
  projects[doc.name] = doc
  return writeRaw(PROJECTS_KEY, JSON.stringify(projects))
}

export function loadProject(name: string): DesignDocument | null {
  return readProjects()[name] ?? null
}

export function deleteProject(name: string): StorageResult {
  const projects = readProjects()
  delete projects[name]
  return writeRaw(PROJECTS_KEY, JSON.stringify(projects))
}

export type AutosaveEntry = {
  /** Null when the draft has never been saved under a name. */
  name: string | null
  doc: DesignDocument
}

export function readAutosave(): AutosaveEntry | null {
  const raw = readRaw(AUTOSAVE_KEY)
  if (!raw) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const entry = parsed as { name?: unknown; doc?: unknown }
    const result = parseDesign(entry.doc)
    if (!result.ok) return null

    return {
      name: typeof entry.name === 'string' ? entry.name : null,
      doc: result.doc,
    }
  } catch {
    return null
  }
}

export function writeAutosave(entry: AutosaveEntry): StorageResult {
  return writeRaw(AUTOSAVE_KEY, JSON.stringify(entry))
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY)
  } catch {
    // Nothing useful to do — the draft simply outlives this session.
  }
}
