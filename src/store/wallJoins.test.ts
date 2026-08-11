import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesignStore } from './useDesignStore'
import { detectRoomsUncached } from '../plan/rooms'
import { resetStore } from '../test/fixtures'
import { provenance } from './provenance'
import type { Point } from './useDesignStore'

/**
 * Session 2 — `setWallLength` no longer detaches the wall it was joined to.
 *
 * It computed `end := start + unit * length` and wrote ONE wall. The wall that
 * shared the old endpoint stayed where it was, so typing a length in the
 * inspector silently opened a corner — and an open corner cascades through
 * `pruneDangles` and costs a room. It was the only store action that broke a
 * join, and it broke one every time it ran on a corner.
 */

const AT = (x: number, z: number): Point => ({ x, z })

/** L-shaped pair sharing one corner at (4, 0). */
function corner() {
  const { addWall } = useDesignStore.getState()
  const a = addWall(AT(0, 0), AT(4, 0), { provenance: provenance.manual() })!
  const b = addWall(AT(4, 0), AT(4, 3), { provenance: provenance.manual() })!
  return { a, b }
}

const wallById = (id: string) => {
  const found = useDesignStore.getState().walls.find((w) => w.id === id)
  if (!found) throw new Error(`no wall ${id}`)
  return found
}

/** Closes the undo burst — see `history.test.ts`. */
const settle = () => vi.advanceTimersByTime(250)

beforeEach(() => {
  vi.useFakeTimers()
  resetStore()
})
afterEach(() => {
  vi.useRealTimers()
  resetStore()
})

describe('★ setWallLength — the join follows', () => {
  /**
   * ★ Demonstrated red (SD5) by putting back the old single-wall write.
   * Four tests failed, and the set of four is the evidence:
   *
   *   expected { x: 4, z: +0 } to deeply equal { x: 6, z: +0 }   (the neighbour)
   *   expected 12 to be close to 15                              (the room)
   *   expected { x: 4.005, z: +0 } to deeply equal { x: 6, z: 0 }(the weld)
   *   expected { x: 4, z: +0 } to deeply equal { x: 6, z: +0 }   (the undo)
   *
   * Wall B's start stayed at the OLD corner while A's end moved to the new
   * one — a 2 m gap that no renderer drew and no test noticed. The refusal
   * and history tests stayed green, which says the break was the write and
   * not the rule around it.
   */
  it('★ drags the neighbour that shared the moved endpoint', () => {
    const { a, b } = corner()
    expect(useDesignStore.getState().setWallLength(a, 6)).toBe(true)

    expect(wallById(a).end).toEqual({ x: 6, z: 0 })
    // The corner moved WITH it, rather than being left behind.
    expect(wallById(b).start).toEqual({ x: 6, z: 0 })
    // …and the far end of the neighbour did not move.
    expect(wallById(b).end).toEqual({ x: 4, z: 3 })
  })

  it('★ keeps the room closed, which is the point of the whole change', () => {
    // A closed rectangle. Resizing one side must leave four rooms' worth of
    // topology intact — one room, non-zero area — not an open loop.
    const { addWall } = useDesignStore.getState()
    const ids = [
      addWall(AT(0, 0), AT(4, 0), { provenance: provenance.manual() })!,
      addWall(AT(4, 0), AT(4, 3), { provenance: provenance.manual() })!,
      addWall(AT(4, 3), AT(0, 3), { provenance: provenance.manual() })!,
      addWall(AT(0, 3), AT(0, 0), { provenance: provenance.manual() })!,
    ]
    expect(detectRoomsUncached(useDesignStore.getState().walls)).toHaveLength(1)

    useDesignStore.getState().setWallLength(ids[0], 6)

    const rooms = detectRoomsUncached(useDesignStore.getState().walls)
    // Count AND area. `rooms.length === 1` alone would pass on a plan whose
    // area had collapsed to a sliver.
    expect(rooms).toHaveLength(1)
    // A TRAPEZOID, not a 6x3 rectangle: only the corner at (4,0) moved, so the
    // ring is (0,0) (6,0) (4,3) (0,3) and the shoelace gives 15. That is the
    // honest result of dragging one corner, and asserting 18 here would have
    // been asserting a wall that nothing moved.
    expect(rooms[0].area).toBeCloseTo(15, 6)
  })

  it('leaves a free end alone — nothing to preserve', () => {
    const { addWall } = useDesignStore.getState()
    const solo = addWall(AT(0, 0), AT(4, 0), { provenance: provenance.manual() })!
    expect(useDesignStore.getState().setWallLength(solo, 6)).toBe(true)
    expect(wallById(solo).end).toEqual({ x: 6, z: 0 })
  })

  it('★ refuses where three or more walls meet, rather than guessing', () => {
    // A through-wall stored as two collinear segments, plus a spur — the
    // 3-way case. Dragging all three would visibly bend the through-wall;
    // dragging none detaches the spur. There is no correct move, so the
    // action declines and the inspector says why.
    const { addWall, setWallLength } = useDesignStore.getState()
    const spur = addWall(AT(0, 0), AT(4, 0), { provenance: provenance.manual() })!
    addWall(AT(4, -3), AT(4, 0), { provenance: provenance.manual() })
    addWall(AT(4, 0), AT(4, 3), { provenance: provenance.manual() })

    const before = wallById(spur).end
    expect(setWallLength(spur, 6)).toBe(false)
    // Refused means UNCHANGED — not partly applied.
    expect(wallById(spur).end).toEqual(before)
  })

  it('refuses a wall that does not exist, and a zero-length one', () => {
    expect(useDesignStore.getState().setWallLength('nope', 6)).toBe(false)
  })

  it('joins within the weld tolerance count, exact coordinates are not required', () => {
    // The editor and `detectRooms` must agree about what a corner is. 5 mm is
    // inside JOIN_TOLERANCE, so this is one corner to both.
    const { addWall, setWallLength } = useDesignStore.getState()
    const a = addWall(AT(0, 0), AT(4, 0), { provenance: provenance.manual() })!
    const b = addWall(AT(4.005, 0), AT(4.005, 3), { provenance: provenance.manual() })!

    expect(setWallLength(a, 6)).toBe(true)
    expect(wallById(b).start).toEqual({ x: 6, z: 0 })
  })
})

describe('★ setWallLength — one edit, one undo step', () => {
  /**
   * ★ The requirement that must not rest on a timing accident.
   *
   * The recorder coalesces edits within `HISTORY_COALESCE_MS` (200 ms), so two
   * separate writes would USUALLY look like one step — and would split into
   * two on a slow machine, or under a debugger, or if that constant ever
   * changed. Both walls move inside a single `set`, so there is one state
   * transition and therefore one snapshot, by construction rather than by luck.
   *
   * Demonstrated red by writing the neighbour in a second `set`:
   * `expected 2 to be 1`.
   */
  it('★ records exactly one history step for the wall and its neighbour', () => {
    const { a } = corner()
    settle()
    const before = useDesignStore.getState().past.length

    useDesignStore.getState().setWallLength(a, 6)
    settle()

    expect(useDesignStore.getState().past.length).toBe(before + 1)
  })

  it('★ one undo restores BOTH walls', () => {
    const { a, b } = corner()
    settle()

    useDesignStore.getState().setWallLength(a, 6)
    settle()
    expect(wallById(b).start).toEqual({ x: 6, z: 0 })

    useDesignStore.getState().undo()

    // Both, from one undo. If the neighbour were a second step this would
    // still show the moved corner.
    expect(wallById(a).end).toEqual({ x: 4, z: 0 })
    expect(wallById(b).start).toEqual({ x: 4, z: 0 })
  })

  it('a refusal records no history step at all', () => {
    const { addWall, setWallLength } = useDesignStore.getState()
    const spur = addWall(AT(0, 0), AT(4, 0), { provenance: provenance.manual() })!
    addWall(AT(4, -3), AT(4, 0), { provenance: provenance.manual() })
    addWall(AT(4, 0), AT(4, 3), { provenance: provenance.manual() })
    settle()
    const before = useDesignStore.getState().past.length

    setWallLength(spur, 6)
    settle()

    // §10 rule 10: a write that changes nothing must not allocate a new array
    // and leave the user a ⌘Z that visibly does nothing.
    expect(useDesignStore.getState().past.length).toBe(before)
  })
})
