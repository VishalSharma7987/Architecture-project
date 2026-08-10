import { parseDesign, type DesignDocument } from './schema'

/**
 * Projects are stored ONE PER KEY, with a rebuildable index beside them.
 *
 * They used to share a single `space-design.projects.v1` blob, and every save
 * was read-all → mutate-one → write-all. Two things followed from that, both
 * bad:
 *
 *   1. the read validated every stored project and kept only the ones that
 *      parsed, so the write-back silently ERASED any project this build could
 *      not read — a document written by a newer build, or one corrupted byte.
 *      Autosave runs that path every four seconds, so the window between "a
 *      project becomes unreadable" and "it is gone for good" was one tick, with
 *      no user action and no message;
 *   2. saving one project cost a full parse and re-serialise of every OTHER
 *      project, synchronously on the main thread, on that same timer.
 *
 * Per-key storage fixes both structurally rather than by being careful: writing
 * one project cannot touch another's bytes, and the cost of a save no longer
 * depends on how many projects the user has kept.
 */
export const PROJECT_KEY_PREFIX = 'space-design.project.v1.'

/**
 * Summaries, so listing does not have to parse every project.
 *
 * A CACHE, never the source of truth. The projects themselves are the record;
 * this exists only to keep `listProjects` cheap. It is rebuilt from the stored
 * projects whenever it is missing, corrupt, or incomplete, and a failed write
 * to it is not a failed save. Treating it as authoritative would reintroduce
 * exactly the bug above by another route — a project missing from the index
 * would be invisible, and invisible is one step from deleted.
 */
export const PROJECT_INDEX_KEY = 'space-design.projects.index.v1'

/** The single blob projects used to live in. Migrated away from, then removed. */
export const LEGACY_PROJECTS_KEY = 'space-design.projects.v1'

export const AUTOSAVE_KEY = 'space-design.autosave.v1'

/**
 * Does a `storage` event from another tab concern a design we are holding?
 *
 * Exported so `useAutosave`'s cross-tab listener does not have to know the key
 * layout — which now has a prefix in it, and would otherwise be a second place
 * to update every time the scheme moves.
 */
export const isProjectStorageKey = (key: string | null): boolean =>
  key === AUTOSAVE_KEY ||
  key === PROJECT_INDEX_KEY ||
  key === LEGACY_PROJECTS_KEY ||
  (key !== null && key.startsWith(PROJECT_KEY_PREFIX))

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

function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing useful to do; the entry simply outlives this attempt.
  }
}

/**
 * A project's key. The name is percent-encoded, so a name containing the
 * prefix, a dot, or anything else cannot collide with another project's key or
 * be mistaken for one.
 */
const projectKey = (name: string) => PROJECT_KEY_PREFIX + encodeURIComponent(name)

/** Every stored project name, read from the keys themselves. Authoritative. */
function storedNames(): string[] {
  const names: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key === null || !key.startsWith(PROJECT_KEY_PREFIX)) continue
      try {
        names.push(decodeURIComponent(key.slice(PROJECT_KEY_PREFIX.length)))
      } catch {
        // A key we cannot decode is not one we wrote. Leave it alone.
      }
    }
  } catch {
    return []
  }
  return names
}

/* ─── migration ─────────────────────────────────────────────────────────── */

/**
 * Moves an existing user's projects out of the legacy blob, one key each.
 *
 * Deliberately NOT a validating pass. Every entry is carried across exactly as
 * stored, including the ones `parseDesign` would reject — those are precisely
 * the documents the old code destroyed, and a migration that dropped them would
 * be the same bug wearing a different hat. An entry already stored under the
 * new scheme wins, so a re-run cannot roll a project backwards.
 *
 * Runs once per session, before the first read or write.
 */
let migrated = false

/** For tests, which need each case to start from a clean module. */
export const __resetMigrationGuard = () => {
  migrated = false
}

function migrateLegacyProjects(): void {
  if (migrated) return
  migrated = true

  const raw = readRaw(LEGACY_PROJECTS_KEY)
  if (raw === null) return

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Unreadable as a whole. Leave it: it is the only copy, and a later build
    // may make sense of it. Removing it here would be the destructive habit
    // this module exists to break.
    return
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    removeRaw(LEGACY_PROJECTS_KEY)
    return
  }

  let moved = true
  for (const [name, value] of Object.entries(parsed)) {
    if (readRaw(projectKey(name)) !== null) continue
    const result = writeRaw(projectKey(name), JSON.stringify(value))
    // Out of quota mid-migration: keep the blob so nothing is stranded.
    if (!result.ok) moved = false
  }

  if (moved) removeRaw(LEGACY_PROJECTS_KEY)
}

/* ─── the index ─────────────────────────────────────────────────────────── */

type IndexEntry = { savedAt: string; wallCount: number }

function readIndex(): Record<string, IndexEntry> {
  const raw = readRaw(PROJECT_INDEX_KEY)
  if (!raw) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }

    const out: Record<string, IndexEntry> = {}
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== 'object' || value === null) continue
      const { savedAt, wallCount } = value as Partial<IndexEntry>
      if (typeof savedAt !== 'string' || typeof wallCount !== 'number') continue
      out[name] = { savedAt, wallCount }
    }
    return out
  } catch {
    return {}
  }
}

/** Best-effort: the index is a cache, so failing to write it is not an error. */
function writeIndex(index: Record<string, IndexEntry>): void {
  writeRaw(PROJECT_INDEX_KEY, JSON.stringify(index))
}

/* ─── the API ───────────────────────────────────────────────────────────── */

/**
 * Every readable project, newest first.
 *
 * Names come from the keys, never from the index — so a project the index has
 * forgotten is still listed, and an index entry with no project behind it is
 * ignored. Anything the index does not already summarise is parsed once, here,
 * and written back so the next call does not have to.
 *
 * A project this build cannot parse is omitted from the list, because there is
 * nothing the user could do with it. It is NOT removed from storage: a build
 * that understands it must still find it there.
 */
export function listProjects(): ProjectSummary[] {
  migrateLegacyProjects()

  const index = readIndex()
  const rebuilt: Record<string, IndexEntry> = {}
  const summaries: ProjectSummary[] = []

  for (const name of storedNames()) {
    const cached = index[name]
    if (cached) {
      rebuilt[name] = cached
      summaries.push({ name, ...cached })
      continue
    }

    // Not in the index: parse this one project to summarise it.
    const doc = readProject(name)
    if (!doc) continue
    const entry = { savedAt: doc.savedAt, wallCount: doc.walls.length }
    rebuilt[name] = entry
    summaries.push({ name, ...entry })
  }

  // Persist the repaired index, but only when it actually differs — listing is
  // called on every menu open and should not write for nothing.
  if (JSON.stringify(rebuilt) !== JSON.stringify(index)) writeIndex(rebuilt)

  return summaries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** One project, validated. Null when it is absent or this build cannot read it. */
function readProject(name: string): DesignDocument | null {
  const raw = readRaw(projectKey(name))
  if (raw === null) return null

  try {
    const result = parseDesign(JSON.parse(raw))
    return result.ok ? result.doc : null
  } catch {
    return null
  }
}

export function loadProject(name: string): DesignDocument | null {
  migrateLegacyProjects()
  return readProject(name)
}

/**
 * Writes one project and updates its index entry.
 *
 * Touches exactly two keys whatever else is stored, which is the whole point:
 * this runs on the autosave timer, and it used to cost a parse and a
 * re-serialise of every project the user had ever saved.
 */
export function saveProject(doc: DesignDocument): StorageResult {
  migrateLegacyProjects()

  const result = writeRaw(projectKey(doc.name), JSON.stringify(doc))
  if (!result.ok) return result

  // The project is saved; the index is only a summary of it. If this write
  // fails the entry is rebuilt on the next listing.
  const index = readIndex()
  index[doc.name] = { savedAt: doc.savedAt, wallCount: doc.walls.length }
  writeIndex(index)

  return { ok: true }
}

export function deleteProject(name: string): StorageResult {
  migrateLegacyProjects()

  removeRaw(projectKey(name))

  const index = readIndex()
  delete index[name]
  writeIndex(index)

  return { ok: true }
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
  removeRaw(AUTOSAVE_KEY)
}

/* ─── the boot guard ────────────────────────────────────────────────────── */

/**
 * Raised while a draft is being restored, lowered once the app has mounted.
 *
 * Autosave persists whatever is open, including a document that goes on to
 * throw during render. The restore path then loads it again on the next boot,
 * so the crash repeats on every reload and the user cannot get back in — the
 * app is bricked by its own draft, with no error boundary reachable in time to
 * say so. That is the difference between one bad session and a dead install.
 *
 * The signal works because of when React runs effects: only after the whole
 * tree has committed. A throw during render means no effect runs, so the flag
 * this stores is still set when the page loads again — which is exactly the
 * question "did the last boot finish?".
 */
export const BOOT_KEY = 'space-design.boot.v1'

/** Did the previous boot begin restoring a draft and never finish mounting? */
export const lastBootFailed = (): boolean => readRaw(BOOT_KEY) !== null

export function bootStarted(): void {
  writeRaw(BOOT_KEY, new Date().toISOString())
}

export function bootCompleted(): void {
  removeRaw(BOOT_KEY)
}
