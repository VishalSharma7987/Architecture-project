import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUTOSAVE_KEY,
  LEGACY_PROJECTS_KEY,
  PROJECT_INDEX_KEY,
  PROJECT_KEY_PREFIX,
  __resetMigrationGuard,
  deleteProject,
  isProjectStorageKey,
  listProjects,
  loadProject,
  saveProject,
} from './storage'
import { serializeDesign } from './schema'
import type { DesignDocument } from './schema'
import { rectangleWalls } from '../test/fixtures'

/**
 * A stored project, at whatever fidelity the test needs.
 *
 * `serializeDesign` rather than a literal, so these documents stay valid as the
 * schema moves — a fixture that drifts out of the parser's contract would make
 * these tests pass for the wrong reason.
 */
function doc(name: string, wallCount = 1): DesignDocument {
  return serializeDesign({
    name,
    viewMode: '2d',
    // Sliced from a real fixture so the walls carry every field the schema
    // requires; `rectangleWalls` closes at four, which is as many as any of
    // these cases needs.
    walls: rectangleWalls().slice(0, wallCount),
  })
}

const keysWithPrefix = () =>
  Object.keys(localStorage).filter((k) => k.startsWith(PROJECT_KEY_PREFIX))

beforeEach(() => {
  localStorage.clear()
  // Migration runs once per module, not once per store — each case needs it
  // armed again or only the first would exercise it.
  __resetMigrationGuard()
})

describe('per-project storage keys', () => {
  it('round-trips a project', () => {
    expect(saveProject(doc('Villa', 3)).ok).toBe(true)
    expect(loadProject('Villa')?.walls).toHaveLength(3)
    expect(listProjects().map((p) => p.name)).toEqual(['Villa'])
  })

  it('gives each project its own key', () => {
    saveProject(doc('Villa'))
    saveProject(doc('Bungalow'))
    expect(keysWithPrefix()).toHaveLength(2)
  })

  it('round-trips a name that needs escaping in a storage key', () => {
    // A name is user input: it can contain the separator, spaces, or unicode.
    const odd = 'Plot 7 / Phase-2 · भवन'
    saveProject(doc(odd, 2))
    expect(loadProject(odd)?.walls).toHaveLength(2)
    expect(listProjects().map((p) => p.name)).toEqual([odd])
  })

  it('deletes only the named project', () => {
    saveProject(doc('Villa'))
    saveProject(doc('Bungalow'))
    deleteProject('Villa')
    expect(listProjects().map((p) => p.name)).toEqual(['Bungalow'])
    expect(loadProject('Bungalow')).not.toBeNull()
  })
})

/**
 * ★ F1 — the regression this whole change exists for.
 *
 * The old layer was read-all → mutate-one → write-all, and `readProjects`
 * dropped every entry `parseDesign` rejected. So saving ANY project rewrote the
 * blob without the casualties, and autosave ran that path every four seconds.
 * An unreadable project — a document written by a newer build, or one corrupted
 * byte — was destroyed within one autosave tick, silently and unrecoverably.
 */
describe('★ an unreadable project survives its neighbours', () => {
  /**
   * Seeded through the LEGACY blob, and asserted by scanning every stored
   * value rather than a known key.
   *
   * Both choices are deliberate. Seeding the way the old build stored things
   * means these tests exercise the destruction path on the old code instead of
   * writing to a key it never touched — a test that cannot fail against the
   * bug it names proves nothing (SD5). Asserting layout-independently means
   * they keep their meaning through this migration and the next one: the claim
   * is "the user's project still exists", not "it is at this key".
   */
  const FUTURE = '"version":999'

  const seedUnreadableAlongside = (readable: string) => {
    localStorage.setItem(
      LEGACY_PROJECTS_KEY,
      JSON.stringify({
        [readable]: doc(readable),
        FromFuture: { ...doc('FromFuture'), version: 999 },
      }),
    )
  }

  /** Is the document still anywhere in storage, under any key? */
  const stillStored = (marker: string) =>
    Object.keys(localStorage).some((k) =>
      (localStorage.getItem(k) ?? '').includes(marker),
    )

  it('saving another project does not destroy it', () => {
    seedUnreadableAlongside('Villa')
    saveProject(doc('Villa', 2))

    expect(stillStored(FUTURE), 'the unreadable project must still be on disk').toBe(
      true,
    )
  })

  it('deleting another project does not destroy it', () => {
    seedUnreadableAlongside('Villa')
    deleteProject('Villa')

    expect(stillStored(FUTURE)).toBe(true)
  })

  it('survives a hundred autosave-shaped saves', () => {
    seedUnreadableAlongside('Villa')
    // Autosave calls saveProject on a 4s timer for the whole session, so the
    // old code had a hundred chances to drop it and needed only one.
    for (let i = 0; i < 100; i++) saveProject(doc('Villa', i % 5))

    expect(stillStored(FUTURE)).toBe(true)
  })

  it('is hidden from the list rather than deleted', () => {
    seedUnreadableAlongside('Villa')

    // Not listed — nothing can be done with a document this build cannot read.
    expect(listProjects().map((p) => p.name)).toEqual(['Villa'])
    // But still there, so a build that understands it can open it again.
    expect(stillStored(FUTURE)).toBe(true)
  })

  it('a corrupt entry is not contagious', () => {
    localStorage.setItem(PROJECT_KEY_PREFIX + 'Broken', '{not json')
    saveProject(doc('Villa', 2))

    expect(listProjects().map((p) => p.name)).toEqual(['Villa'])
    expect(loadProject('Villa')?.walls).toHaveLength(2)
    expect(localStorage.getItem(PROJECT_KEY_PREFIX + 'Broken')).toBe('{not json')
  })
})

/**
 * ★ The index is a cache. Anything that treats it as the source of truth
 * reintroduces F1 by another route: a project missing from the index would be
 * invisible, and an index write that failed would lose it.
 */
describe('★ the index is rebuildable and is not the source of truth', () => {
  it('lists projects after the index is deleted', () => {
    saveProject(doc('Villa', 3))
    saveProject(doc('Bungalow', 4))
    localStorage.removeItem(PROJECT_INDEX_KEY)

    const listed = listProjects()
    expect(listed.map((p) => p.name).sort()).toEqual(['Bungalow', 'Villa'])
    expect(listed.find((p) => p.name === 'Villa')?.wallCount).toBe(3)
  })

  it('lists projects after the index is corrupted', () => {
    saveProject(doc('Villa', 3))
    localStorage.setItem(PROJECT_INDEX_KEY, 'not json at all')

    expect(listProjects().map((p) => p.name)).toEqual(['Villa'])
  })

  it('rebuilds the index as a side effect of listing', () => {
    saveProject(doc('Villa', 3))
    localStorage.removeItem(PROJECT_INDEX_KEY)
    listProjects()

    expect(localStorage.getItem(PROJECT_INDEX_KEY)).not.toBeNull()
  })

  it('ignores an index entry for a project that no longer exists', () => {
    saveProject(doc('Villa'))
    localStorage.setItem(
      PROJECT_INDEX_KEY,
      JSON.stringify({ Ghost: { savedAt: '2026-01-01T00:00:00.000Z', wallCount: 9 } }),
    )

    expect(listProjects().map((p) => p.name)).toEqual(['Villa'])
  })
})

/**
 * ★ Existing users have their projects in the legacy blob. Migration must move
 * every one of them — including the ones this build cannot parse, which are
 * exactly the ones the old code was destroying.
 */
describe('★ migration from the single projects blob', () => {
  it('moves every project out of the blob and removes it', () => {
    localStorage.setItem(
      LEGACY_PROJECTS_KEY,
      JSON.stringify({ Villa: doc('Villa', 3), Bungalow: doc('Bungalow', 4) }),
    )

    const listed = listProjects()
    expect(listed.map((p) => p.name).sort()).toEqual(['Bungalow', 'Villa'])
    expect(loadProject('Villa')?.walls).toHaveLength(3)
    expect(localStorage.getItem(LEGACY_PROJECTS_KEY)).toBeNull()
  })

  it('carries across an entry it cannot parse instead of dropping it', () => {
    localStorage.setItem(
      LEGACY_PROJECTS_KEY,
      JSON.stringify({
        Villa: doc('Villa'),
        FromFuture: { ...doc('FromFuture'), version: 999 },
      }),
    )

    listProjects()
    const raw = localStorage.getItem(PROJECT_KEY_PREFIX + 'FromFuture')
    expect(raw, 'migration must not be a filter').not.toBeNull()
    expect(JSON.parse(raw!).version).toBe(999)
  })

  it('does not clobber a project already stored under the new scheme', () => {
    saveProject(doc('Villa', 4))
    localStorage.setItem(LEGACY_PROJECTS_KEY, JSON.stringify({ Villa: doc('Villa', 2) }))

    listProjects()
    expect(loadProject('Villa')?.walls, 'the newer per-key copy wins').toHaveLength(4)
  })

  it('is a no-op when there is no blob', () => {
    saveProject(doc('Villa'))
    expect(listProjects().map((p) => p.name)).toEqual(['Villa'])
  })

  it('survives a blob that is not an object', () => {
    localStorage.setItem(LEGACY_PROJECTS_KEY, '["nope"]')
    expect(listProjects()).toEqual([])
  })
})

describe('cross-tab key recognition', () => {
  it('recognises every key a project write touches', () => {
    expect(isProjectStorageKey(AUTOSAVE_KEY)).toBe(true)
    expect(isProjectStorageKey(PROJECT_INDEX_KEY)).toBe(true)
    expect(isProjectStorageKey(PROJECT_KEY_PREFIX + 'Villa')).toBe(true)
    expect(isProjectStorageKey(LEGACY_PROJECTS_KEY)).toBe(true)
  })

  it('ignores keys belonging to something else on the origin', () => {
    expect(isProjectStorageKey('theme')).toBe(false)
    expect(isProjectStorageKey(null)).toBe(false)
  })
})
