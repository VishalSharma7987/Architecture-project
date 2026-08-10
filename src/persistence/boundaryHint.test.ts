import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetRoomCaches, roomCacheStats } from '../plan/rooms'
import { resolveRooms, withBoundaryHints } from '../rooms/resolve'
import { rectangleWalls, resetStore } from '../test/fixtures'
import { provenance } from '../store/provenance'
import { useDesignStore, type RoomLabel } from '../store/useDesignStore'
import { parseDesign, serializeDesign } from './schema'

/**
 * B7.5 — `boundaryHint` is written at SERIALIZE time and read at PARSE time.
 *
 * Never during editing, never during a render. That is the load-bearing
 * constraint, and these tests are what hold it: writing it from inside
 * `resolveRooms` would replace `roomLabels`, so B8's cache would never hit, the
 * write would trigger a render that resolves that writes, and `designChanged` —
 * a pure reference compare — would log an undo step per resolve.
 *
 * No pass-2 matching here. That is B7.6.
 */

const AT = '2026-08-10T00:00:00.000Z'

beforeEach(() => {
  resetStore()
  resetRoomCaches()
})
afterEach(() => {
  resetStore()
  resetRoomCaches()
})

const KITCHEN: RoomLabel = {
  id: 'label-kitchen',
  type: 'kitchen',
  anchor: { x: 2, z: 1.5 },
}

const saved = (walls = rectangleWalls(), labels = [KITCHEN]) =>
  serializeDesign({ name: 'x', walls, roomLabels: labels, viewMode: '2d', savedAt: AT })

describe('★ B7.5 — the hint round-trips', () => {
  it('a saved label carries the polygon it resolved to', () => {
    const doc = saved()
    const hint = doc.rooms[0].boundaryHint

    expect(hint).toBeDefined()
    expect(hint).toHaveLength(4)
    // The 4 x 3 rectangle's own corners, on the wall centrelines.
    const xs = hint!.map((p) => p.x).sort((a, b) => a - b)
    const zs = hint!.map((p) => p.z).sort((a, b) => a - b)
    expect(xs).toEqual([0, 0, 4, 4])
    expect(zs).toEqual([0, 0, 3, 3])
  })

  it('★ survives a full save → load cycle', () => {
    const doc = saved()
    const result = parseDesign(JSON.parse(JSON.stringify(doc)))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.rooms[0].boundaryHint).toEqual(doc.rooms[0].boundaryHint)
  })

  it('a detached label keeps the hint it already had', () => {
    // The hint is the ONLY record of where the room used to be, so it is what
    // B7.6 will re-attach from. Blanking it on save would throw that away
    // exactly when it becomes useful.
    // Far away and far too small to re-attach — B7.6's pass 2 must not claim
    // it, or this stops testing what it says it tests.
    const withHint: RoomLabel = {
      ...KITCHEN,
      anchor: { x: 40, z: 40 },
      boundaryHint: [
        { x: 40, z: 40 },
        { x: 41, z: 40 },
        { x: 41, z: 41 },
        { x: 40, z: 41 },
      ],
    }
    const doc = saved(rectangleWalls(), [withHint])

    expect(doc.rooms[0].boundaryHint).toEqual(withHint.boundaryHint)
  })
})

describe('★ B7.5 — the hint costs B8 nothing', () => {
  it('★ serialising does not lower the memo hit rate', () => {
    const walls = rectangleWalls()
    const labels = [KITCHEN]
    resetRoomCaches()

    // Warm the cache exactly as a mounted panel would.
    resolveRooms(walls, labels)
    const runsAfterRender = roomCacheStats.resolveRuns
    const detectAfterRender = roomCacheStats.detectRuns

    serializeDesign({ name: 'x', walls, roomLabels: labels, viewMode: '2d' })

    expect(
      roomCacheStats.resolveRuns,
      'the save re-resolved instead of hitting the cache',
    ).toBe(runsAfterRender)
    expect(roomCacheStats.detectRuns).toBe(detectAfterRender)
    expect(roomCacheStats.resolveHits).toBeGreaterThan(0)
  })

  it('an unhinted save is one resolve, not one per floor', () => {
    const walls = rectangleWalls()
    const labels = [KITCHEN]
    resetRoomCaches()

    serializeDesign({
      name: 'x',
      walls,
      roomLabels: labels,
      viewMode: '2d',
      // Two more storeys in the document. Only the active one is hinted, so
      // these cost nothing — which is what keeps autosave inside §9.2.
      floors: useDesignStore.getState().floors,
    })

    expect(roomCacheStats.resolveRuns).toBe(1)
    expect(roomCacheStats.detectRuns).toBe(1)
  })

  it('costs nothing at all when there are no names', () => {
    resetRoomCaches()
    serializeDesign({ name: 'x', walls: rectangleWalls(), viewMode: '2d' })

    expect(roomCacheStats.resolveRuns).toBe(0)
    expect(roomCacheStats.detectRuns).toBe(0)
  })
})

describe('★ B7.5 — nothing is written during editing', () => {
  it('★ editing never puts a hint into the store', () => {
    useDesignStore.setState({ walls: rectangleWalls(), roomLabels: [KITCHEN] })

    const store = useDesignStore.getState()
    store.addWall({ x: 0, z: 0 }, { x: 0, z: 3 }, { provenance: provenance.manual() })
    store.updateRoomLabel(KITCHEN.id, { name: 'Scullery' })
    resolveRooms(
      useDesignStore.getState().walls,
      useDesignStore.getState().roomLabels,
    )

    for (const label of useDesignStore.getState().roomLabels) {
      expect(
        label.boundaryHint,
        'a hint in the store means something wrote one outside a save',
      ).toBeUndefined()
    }
  })

  it('★ serialising the same state twice records no undo step', () => {
    useDesignStore.setState({ walls: rectangleWalls(), roomLabels: [KITCHEN] })
    const before = useDesignStore.getState().roomLabels
    const steps = useDesignStore.getState().past.length

    serializeDesign({
      name: 'x',
      walls: useDesignStore.getState().walls,
      roomLabels: useDesignStore.getState().roomLabels,
      viewMode: '2d',
    })

    // `designChanged` is a pure reference compare (§4 invariant 1). If a save
    // handed the store a new `roomLabels` array, every autosave tick would push
    // a history step the user never made.
    expect(useDesignStore.getState().roomLabels).toBe(before)
    expect(useDesignStore.getState().past.length).toBe(steps)
  })

  it('withBoundaryHints returns the SAME array when no hint would change', () => {
    const walls = rectangleWalls()
    const once = withBoundaryHints(walls, [KITCHEN])
    expect(once).not.toBe(KITCHEN)

    // Second pass over an already-hinted set: same polygons, same identities,
    // so the array itself must come back unchanged.
    expect(withBoundaryHints(walls, once)).toBe(once)
  })

  it('returns the input untouched when there are no labels', () => {
    const empty: RoomLabel[] = []
    expect(withBoundaryHints(rectangleWalls(), empty)).toBe(empty)
  })
})

describe('B7.5 — parseBoundaryHint is defensive', () => {
  const load = (boundaryHint: unknown) =>
    parseDesign({
      version: 3,
      name: 'x',
      savedAt: AT,
      settings: { viewMode: '2d' },
      walls: [],
      rooms: [{ ...KITCHEN, boundaryHint }],
    })

  it('drops a ring with fewer than three points', () => {
    for (const junk of [[], [{ x: 0, z: 0 }], [{ x: 0, z: 0 }, { x: 1, z: 1 }]]) {
      const result = load(junk)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // A hint that cannot bound anything is worse than none: B7.6's matcher
      // would still try to use it.
      expect(result.doc.rooms[0].boundaryHint).toBeUndefined()
    }
  })

  it('★ drops the whole ring when any point is unusable', () => {
    const result = load([
      { x: 0, z: 0 },
      // oxlint-disable-next-line no-loss-of-precision
      { x: 1e999, z: 0 },
      { x: 4, z: 3 },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // All or nothing. `1e999` parses to Infinity, and §3 protects `parseDesign`
    // precisely so that never reaches geometry — a ring with a hole punched in
    // it describes a shape the user never had.
    expect(result.doc.rooms[0].boundaryHint).toBeUndefined()
  })

  it('survives a hint that is not an array', () => {
    for (const junk of [null, 7, 'square', { x: 0, z: 0 }]) {
      const result = load(junk)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.doc.rooms[0].boundaryHint).toBeUndefined()
    }
  })
})
