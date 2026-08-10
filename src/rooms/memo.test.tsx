import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildAreaStatement } from '../export/statement'
import {
  detectRooms,
  detectRoomsUncached,
  resetRoomCaches,
  roomCacheStats,
  totalFloorArea,
} from '../plan/rooms'
import { InspectorPanel } from '../components/InspectorPanel'
import { RoomSchedulePanel } from '../components/RoomSchedulePanel'
import { StatusBar } from '../components/StatusBar'
import { VastuPanel } from '../components/VastuPanel'
import { allFloors, useDesignStore } from '../store/useDesignStore'
import type { RoomLabel } from '../store/useDesignStore'
import { rectangleWalls, resetStore } from '../test/fixtures'
import { resolveRooms, resolveRoomsUncached } from './resolve'

/**
 * B8 — the shared room-resolution memoisation point.
 *
 * §9.2 budgets *"room recompute after one wall edit — < 50 ms, **once**"*. At
 * 500 walls a single `resolveRooms` is 19.78 ms, so the millisecond half of
 * that budget was already met. The violation was the word *once*: every
 * consumer held its own `useMemo` over the same pure function and recomputed
 * independently on every edit.
 *
 * These tests are about the COUNT, not the clock. A timing test would be bound
 * to the machine; a call count is not, and it is the thing the budget's second
 * clause actually says.
 */

/** A plan with two rooms, enough for every consumer to have something to show. */
function twoRoomPlan() {
  const walls = [
    ...rectangleWalls(8, 4),
    {
      ...rectangleWalls(1, 1)[0],
      id: 'partition',
      start: { x: 4, z: 0 },
      end: { x: 4, z: 4 },
    },
  ]
  useDesignStore.setState({ walls })
  useDesignStore.getState().nameRoom({ x: 2, z: 2 }, 'living')
  useDesignStore.getState().nameRoom({ x: 6, z: 2 }, 'kitchen')
  return useDesignStore.getState()
}

beforeEach(() => {
  resetStore()
  resetRoomCaches()
})
afterEach(() => {
  resetStore()
  resetRoomCaches()
})

describe('★ N mounted consumers trigger exactly one detection', () => {
  /**
   * The real components, rendered together, exactly as `App` mounts them.
   *
   * `FloorPlanEditor` and `RoomLabels` are excluded deliberately: both need a
   * canvas or a WebGL context, and neither adds anything to the count that the
   * four below do not already establish. `benchmarks.md` records that the two
   * of them are mutually exclusive anyway — `FloorPlanEditor` is 2D-only,
   * `RoomLabels` is 3D-only, and `App` renders one branch or the other.
   *
   * Demonstrated red (SD5): with the two `WeakMap` lookups bypassed so every
   * call recomputes, this reported `expected 5 to be 1` — one traversal for
   * `StatusBar`, one for `InspectorPanel`, two for `RoomSchedulePanel` (its own
   * plus the one inside `buildAreaStatement`), and one for `VastuPanel`.
   */
  it('four panels and one edit cost one traversal of the edited plan', () => {
    twoRoomPlan()
    // A room selection, so the inspector renders its room branch rather than
    // returning null — an inspector showing nothing resolves nothing.
    useDesignStore.getState().select({ kind: 'room', anchor: { x: 2, z: 2 } })
    useDesignStore.getState().setRoomPanelOpen(true)
    useDesignStore.getState().setVastuPanelOpen(true)
    resetRoomCaches()

    render(
      <>
        <StatusBar />
        <InspectorPanel />
        <RoomSchedulePanel />
        <VastuPanel />
      </>,
    )

    const { walls, roomLabels } = useDesignStore.getState()
    const runsAfterRender = roomCacheStats.detectRuns

    // THE assertion: asking again is a HIT, so the four consumers between them
    // traversed this plan exactly once.
    detectRooms(walls)
    resolveRooms(walls, roomLabels)
    expect(
      roomCacheStats.detectRuns,
      `the edited plan was traversed more than once: ${roomCacheStats.detectRuns} ` +
        `runs, ${roomCacheStats.detectHits} hits`,
    ).toBe(runsAfterRender)

    // Sharing is real, not an artefact of nothing having rendered. The counter
    // that shows it is `resolveHits`, not `detectHits`: three of the four
    // consumers are served by the RESOLVE cache and never reach detection at
    // all, which is the outer cache doing its job.
    //
    //   StatusBar   → totalFloorArea → detectRooms   miss (the one traversal)
    //   Inspector   → resolveRooms                   resolve miss, detect HIT
    //   RoomPanel   → resolveRooms                   resolve HIT
    //   RoomPanel   → buildAreaStatement (floor 0)   resolve HIT
    //   VastuPanel  → resolveRooms                   resolve HIT
    expect(roomCacheStats.resolveHits).toBeGreaterThanOrEqual(3)
    expect(roomCacheStats.detectHits).toBeGreaterThanOrEqual(1)

    // Total runs are one per DISTINCT walls array, not one per consumer. There
    // are three: the edited plan, and the two empty upper storeys that
    // `buildAreaStatement` walks inside RoomSchedulePanel. Both of those are
    // `[]`, so their traversal returns immediately — they are separate array
    // identities, not separate work.
    expect(roomCacheStats.detectRuns).toBe(3)
    expect(useDesignStore.getState().floors[1].walls).toHaveLength(0)
    expect(useDesignStore.getState().floors[2].walls).toHaveLength(0)
  })

  it('★ StatusBar shares the cache, though it goes in through totalFloorArea', () => {
    // The consumer `benchmarks.md` missed. `App` renders it as
    // `chrome && <StatusBar/>`, so it is mounted in BOTH branches, always — and
    // it reaches detection by a different door than the panels do.
    twoRoomPlan()
    resetRoomCaches()

    const { walls, roomLabels } = useDesignStore.getState()
    resolveRooms(walls, roomLabels)
    const runsAfterPanel = roomCacheStats.detectRuns

    totalFloorArea(walls)

    expect(roomCacheStats.detectRuns).toBe(runsAfterPanel)
    expect(roomCacheStats.detectHits).toBeGreaterThan(0)
  })

  it('★ the area statement shares it too, for the storey that is open', () => {
    // `RoomSchedulePanel` resolves the active floor directly AND again inside
    // `buildAreaStatement`, where `allFloors` has substituted the live arrays
    // into `floors[activeFloor]`. Two traversals of the same walls per edit,
    // which is the duplicate the baseline does not count.
    twoRoomPlan()
    resetRoomCaches()

    const state = useDesignStore.getState()
    resolveRooms(state.walls, state.roomLabels)
    const runsAfterPanel = roomCacheStats.detectRuns

    buildAreaStatement({
      projectName: null,
      date: '',
      floors: allFloors(state),
      plot: null,
      northOffset: 0,
      plotFacing: 'N',
      constructionRate: 0,
    })

    // The two empty upper storeys resolve once each and are cheap; the active
    // floor — the expensive one — is served from cache.
    expect(roomCacheStats.detectRuns - runsAfterPanel).toBeLessThanOrEqual(2)
    expect(roomCacheStats.resolveHits).toBeGreaterThan(0)
  })
})

describe('the cache is keyed on identity, and invalidates with it', () => {
  it('recomputes when a wall edit replaces the array', () => {
    twoRoomPlan()
    resetRoomCaches()

    const before = useDesignStore.getState()
    resolveRooms(before.walls, before.roomLabels)
    expect(roomCacheStats.detectRuns).toBe(1)

    useDesignStore.getState().addWall({ x: 0, z: 0 }, { x: 0, z: -3 })

    const after = useDesignStore.getState()
    expect(after.walls).not.toBe(before.walls)
    resolveRooms(after.walls, after.roomLabels)
    expect(roomCacheStats.detectRuns).toBe(2)
  })

  it('★ naming a room re-resolves but does NOT re-detect', () => {
    // The two-level key earning its keep: `nameRoom` replaces `roomLabels` and
    // leaves `walls` alone, so the cheap half re-runs and the expensive half
    // does not.
    twoRoomPlan()
    resetRoomCaches()

    const before = useDesignStore.getState()
    resolveRooms(before.walls, before.roomLabels)
    expect(roomCacheStats.detectRuns).toBe(1)
    expect(roomCacheStats.resolveRuns).toBe(1)

    useDesignStore.getState().nameRoom({ x: 6, z: 2 }, 'dining')

    const after = useDesignStore.getState()
    expect(after.walls).toBe(before.walls)
    expect(after.roomLabels).not.toBe(before.roomLabels)

    resolveRooms(after.walls, after.roomLabels)
    expect(roomCacheStats.resolveRuns).toBe(2)
    expect(roomCacheStats.detectRuns, 'the walls did not move').toBe(1)
  })

  it('a no-op patch does not invalidate — 13d and B8 reinforce each other', () => {
    // `patchWall` returns the ORIGINAL array when no wall matches, so a write
    // racing a delete neither records history nor busts this cache.
    twoRoomPlan()
    resetRoomCaches()

    const state = useDesignStore.getState()
    resolveRooms(state.walls, state.roomLabels)
    useDesignStore.getState().updateWall('gone', { height: 2.4 })

    const after = useDesignStore.getState()
    resolveRooms(after.walls, after.roomLabels)
    expect(roomCacheStats.detectRuns).toBe(1)
  })

  it('holds every storey at once, not just the last one asked for', () => {
    // `export/statement.ts` walks all three floors in order. A single-entry
    // cache would thrash; the WeakMap does not.
    const a = rectangleWalls(4, 3)
    const b = rectangleWalls(6, 5)
    const c = rectangleWalls(8, 7)
    resetRoomCaches()

    for (const walls of [a, b, c]) resolveRooms(walls, [])
    expect(roomCacheStats.detectRuns).toBe(3)

    // Coming back to the first one is still a hit.
    for (const walls of [a, b, c]) resolveRooms(walls, [])
    expect(roomCacheStats.detectRuns).toBe(3)
    expect(roomCacheStats.detectHits).toBe(3)
  })
})

describe('★ memoising changed nothing about the answer', () => {
  const PLANS: [name: string, walls: ReturnType<typeof rectangleWalls>][] = [
    ['a single rectangle', rectangleWalls(4, 3)],
    ['a wide room', rectangleWalls(12, 2)],
    ['an empty plan', []],
  ]

  for (const [name, walls] of PLANS) {
    it(`detectRooms matches detectRoomsUncached — ${name}`, () => {
      resetRoomCaches()
      expect(detectRooms(walls)).toEqual(detectRoomsUncached(walls))
    })

    it(`resolveRooms matches resolveRoomsUncached — ${name}`, () => {
      resetRoomCaches()
      expect(resolveRooms(walls, [])).toEqual(resolveRoomsUncached(walls, []))
    })
  }

  it('a partitioned plan resolves labels identically', () => {
    const state = twoRoomPlan()
    resetRoomCaches()
    expect(resolveRooms(state.walls, state.roomLabels)).toEqual(
      resolveRoomsUncached(state.walls, state.roomLabels),
    )
  })

  it('★ the uncached entry points really are uncached', () => {
    // Regression: `resolveRoomsUncached` called the MEMOISED `detectRooms`, so
    // it silently measured and tested a WeakMap. The benchmark caught it —
    // resolve came back at 0.25 ms against detect at 19.8 ms for the same
    // plan, which cannot be true of a function that calls it. Nothing else
    // would have: every result was still correct.
    const walls = rectangleWalls()
    const labels: RoomLabel[] = []
    resetRoomCaches()

    detectRoomsUncached(walls)
    resolveRoomsUncached(walls, labels)
    resolveRoomsUncached(walls, labels)

    expect(roomCacheStats.detectRuns, 'uncached callers must not populate the cache').toBe(0)
    expect(roomCacheStats.detectHits, 'uncached callers must not read the cache').toBe(0)
    expect(roomCacheStats.resolveRuns).toBe(0)
    expect(roomCacheStats.resolveHits).toBe(0)

    // ...and the memoised one still shares detection across a label change,
    // which is the reason it must NOT delegate to the uncached path.
    resolveRooms(walls, [])
    resolveRooms(walls, [{ id: 'l', type: 'bedroom', anchor: { x: 2, z: 2 } }])
    expect(roomCacheStats.resolveRuns, 'two label sets, two resolutions').toBe(2)
    expect(roomCacheStats.detectRuns, 'but only one traversal').toBe(1)
  })

  it('hands back the SAME array, so a downstream useMemo can hold', () => {
    const walls = rectangleWalls()
    // Hoisted deliberately: two `[]` literals are two identities, and the
    // cache is keyed on identity. That is the contract, not a limitation —
    // the store hands out one stable `roomLabels` reference per generation.
    const labels: RoomLabel[] = []
    resetRoomCaches()

    expect(resolveRooms(walls, labels)).toBe(resolveRooms(walls, labels))
    expect(detectRooms(walls)).toBe(detectRooms(walls))
  })

  it('two distinct empty label arrays are two keys, by design', () => {
    const walls = rectangleWalls()
    resetRoomCaches()

    resolveRooms(walls, [])
    resolveRooms(walls, [])

    // Two resolve passes, because the labels differed by identity...
    expect(roomCacheStats.resolveRuns).toBe(2)
    // ...but only ONE traversal, because the walls did not. This is why the
    // key is two-level.
    expect(roomCacheStats.detectRuns).toBe(1)
  })
})

describe('★ the shared array is not mutated by its consumers', () => {
  it('the room schedule and Vastu panels copy before sorting', () => {
    twoRoomPlan()
    useDesignStore.getState().setRoomPanelOpen(true)
    useDesignStore.getState().setVastuPanelOpen(true)
    resetRoomCaches()

    const state = useDesignStore.getState()
    const shared = resolveRooms(state.walls, state.roomLabels)
    const orderBefore = shared.map((r) => r.area)

    render(
      <>
        <RoomSchedulePanel />
        <VastuPanel />
      </>,
    )

    expect(
      resolveRooms(state.walls, state.roomLabels).map((r) => r.area),
      'a panel sorted the shared array in place',
    ).toEqual(orderBefore)
  })
})
