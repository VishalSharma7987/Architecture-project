import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findLooseJoints } from './repairJoints'
import { HISTORY_COALESCE_MS } from '../store/history'
import { drawPlan } from './draw'
import { createViewport } from './viewport'
import { recorder } from '../test/canvasRecorder'
import { resetStore } from '../test/fixtures'
import {
  moveWallEndpointIn,
  useDesignStore,
  type Point,
  type Wall,
} from '../store/useDesignStore'

/**
 * B30 — moving a wall endpoint.
 *
 * ── Session 2's finding, and why this shares its implementation ──
 * `setWallLength` was a MODEL-CORRUPTING operation: it moved one wall and left
 * the neighbour resting on its old endpoint behind, breaking every join at
 * that end. The cascade that fixed it —
 *
 *   1 wall at the moving end   → move it
 *   2 walls (a simple corner)  → move both
 *   >= 3 walls                 → refuse, and say why
 *
 * — now lives once, in `moveWallEndpointIn`, and BOTH `setWallLength` and the
 * drag handles go through it. A second cascade would be a second chance to
 * reintroduce exactly the bug Session 2 spent a session removing.
 *
 * ── What makes each test capable of going red ──
 * Named per test. The recurring trap in this project is a fixture symmetric in
 * the property under test (SD25), so every fixture below is built so that the
 * right answer and the wrong answer are different values.
 */

const wall = (id: string, ax: number, az: number, bx: number, bz: number): Wall => ({
  id,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  height: 3,
  thickness: 0.23,
  openings: [],
  material: 'white-paint',
  type: 'shell' as const,
})

/**
 * An L. `n` runs east and `e` runs south from the SAME corner at (5,0).
 *
 * Asymmetric in the property under test throughout: the shared corner is at
 * one END of one wall and the START of the other, so a cascade that only ever
 * looked at `end` — which is all `setWallLength` ever needed — would move the
 * wrong endpoint of `e` and the corner would come apart.
 */
const CORNER: Wall[] = [wall('n', 0, 0, 5, 0), wall('e', 5, 0, 5, 4)]

/** Three walls meeting at (5,0): the case with no correct answer. */
const JUNCTION: Wall[] = [...CORNER, wall('x', 5, 0, 9, -3)]

const at = (walls: Wall[], id: string) => walls.find((w) => w.id === id)!

/* ─── ★ the corner stays shut ────────────────────────────────────────────── */

describe('★ B30 — dragging a shared corner takes the neighbour with it', () => {
  /**
   * ★ ACCEPTANCE 2, and the headline.
   *
   * ── The move is 100 mm, and that is not timidity ──
   * `findLooseJoints` detects NEAR-MISSES, not disconnections: `mergeReach` is
   * `REPAIR_EXTEND` (160 mm) for perpendicular walls, so two endpoints further
   * apart than that are not a loose joint at all — they are simply two
   * endpoints. Dragging the corner 1.5 m and abandoning the neighbour
   * therefore reports ZERO loose joints, and a test written that way would
   * have been green against the very corruption it was meant to catch.
   *
   * **That is worth stating on its own: nothing in the codebase flags a corner
   * that has been pulled fully apart.** The loose-joint scan is the wrong
   * instrument beyond 160 mm, and the exactness test below is what covers the
   * large move.
   *
   * Asymmetric in: 100 mm is inside the near-miss band and outside
   * `JOIN_TOLERANCE` (15 mm), so the naive move is detectable and the cascaded
   * one is exactly closed. Under 15 mm both would read as joined.
   */
  it('★ leaves 0 loose joints where leaving the neighbour behind leaves some', () => {
    const to = { x: 5.1, z: 0.04 } // 108 mm from the old corner
    const result = moveWallEndpointIn(CORNER, 'n', 'end', to)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(findLooseJoints(result.walls)).toHaveLength(0)
    expect([...result.movedWallIds].sort()).toEqual(['e', 'n'])

    // The baseline this is a delta against: the same move with the cascade
    // skipped, which is precisely what `setWallLength` used to do.
    const naive = CORNER.map((w) => (w.id === 'n' ? { ...w, end: to } : w))
    expect(findLooseJoints(naive).length).toBeGreaterThan(0)
  })

  /**
   * The large move, where the loose-joint scan goes blind. Asserted as a
   * DISCONNECTION — the two endpoints are no longer the same coordinate —
   * because that is the property that matters and the only one still visible
   * at this distance.
   */
  it('a big drag would separate the corner outright, and does not', () => {
    const to = { x: 6.54, z: 1.04 } // 1.5 m away, well past `REPAIR_EXTEND`
    const naive = CORNER.map((w) => (w.id === 'n' ? { ...w, end: to } : w))

    // The instrument that misses it, recorded so nobody trusts it here again.
    expect(findLooseJoints(naive)).toHaveLength(0)
    expect(at(naive, 'n').end).not.toEqual(at(naive, 'e').start)

    const result = moveWallEndpointIn(CORNER, 'n', 'end', to)
    if (!result.ok) throw new Error('expected the move to be allowed')
    expect(at(result.walls, 'n').end).toEqual(at(result.walls, 'e').start)
  })

  /**
   * ★ "exactly closed — toBe, not toBeCloseTo". A tolerance loose enough to be
   * worth writing would accept the 1–152 mm gaps Session 1 measured as the
   * reason rooms fail to close, so the corner is asserted bit-for-bit.
   */
  it('★ the corner is BIT-IDENTICAL, not merely within a tolerance', () => {
    const to = { x: 6.54, z: 1.04 }
    const result = moveWallEndpointIn(CORNER, 'n', 'end', to)
    if (!result.ok) throw new Error('expected the move to be allowed')

    const moved = at(result.walls, 'n').end
    const neighbour = at(result.walls, 'e').start

    expect(neighbour.x).toBe(moved.x)
    expect(neighbour.z).toBe(moved.z)
    expect(Object.is(neighbour.x, to.x)).toBe(true)
  })

  /**
   * The neighbour shares the corner as its START. Asymmetric in: `e.end` is at
   * (5,4) and must NOT move — a cascade that patched the wrong end would leave
   * `e.start` behind and swing its far end instead.
   */
  it('moves the neighbour by the end that actually touches, not by `end`', () => {
    const result = moveWallEndpointIn(CORNER, 'n', 'end', { x: 6.54, z: 1.04 })
    if (!result.ok) throw new Error('expected the move to be allowed')

    expect(at(result.walls, 'e').start).toEqual({ x: 6.54, z: 1.04 })
    expect(at(result.walls, 'e').end).toEqual({ x: 5, z: 4 })
  })

  /**
   * ACCEPTANCE 1. Asymmetric in: `n.start` is free — nothing else rests on
   * (0,0) — so exactly one wall may move. A fixture where every endpoint was
   * shared could not tell "moves the free one only" from "moves everything".
   */
  it('moves one wall only when the endpoint is free', () => {
    const result = moveWallEndpointIn(CORNER, 'n', 'start', { x: -1.04, z: 0.04 })
    if (!result.ok) throw new Error('expected the move to be allowed')

    expect(result.movedWallIds).toEqual(['n'])
    expect(at(result.walls, 'e')).toEqual(at(CORNER, 'e'))
  })
})

/* ─── the junction refuses ───────────────────────────────────────────────── */

describe('★ B30 — three walls meeting refuses, and says how many', () => {
  /**
   * ★ ACCEPTANCE 3. Asymmetric in: the SAME wall, the SAME endpoint, the SAME
   * target — only a third wall is added. So the pair of assertions can only
   * both hold if the count is what decides, which is the cascade rule.
   */
  it('★ allows the move at 2 walls and refuses it at 3, committing nothing', () => {
    const to = { x: 6.54, z: 1.04 }

    expect(moveWallEndpointIn(CORNER, 'n', 'end', to).ok).toBe(true)

    const refused = moveWallEndpointIn(JUNCTION, 'n', 'end', to)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toBe('junction')
    // The COUNT, so the message can name it rather than say "cannot move".
    expect(refused.attached).toBe(3)
  })

  it('refuses a wall that is not there rather than throwing', () => {
    const result = moveWallEndpointIn(CORNER, 'ghost', 'end', { x: 1, z: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no-wall')
  })
})

/* ─── ★ one drag is one undo step ────────────────────────────────────────── */

describe('★ B30 — one drag is one undo step', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
    useDesignStore.setState({ walls: CORNER.map((w) => ({ ...w })), past: [], future: [] })
  })
  afterEach(() => vi.useRealTimers())

  /**
   * ★ Asserted as a COUNT of history entries, not by waiting on the recorder's
   * 200 ms coalescing window. §4 invariant 1 warns that the window is a timing
   * accident, and a test that leaned on it would pass on a fast machine and
   * fail on a slow one.
   *
   * Capable of going red: the editor previews the drag PURELY and writes once
   * on pointer-up. Wiring it per-pointermove instead would make this the
   * number of moves — the simulation below performs eight.
   */
  it('★ eight pointer-moves then a drop record exactly one step', () => {
    // The recorder coalesces edits within `HISTORY_COALESCE_MS`, and the setup
    // above is itself an edit. Waiting the window out is NOT the thing §4
    // invariant 1 warns against — relying on it to merge a drag would be. Here
    // it is closed deliberately so the measurement starts from a settled
    // baseline instead of sharing a burst with the fixture.
    vi.advanceTimersByTime(HISTORY_COALESCE_MS + 50)
    const before = useDesignStore.getState().past.length

    // The drag: eight pure previews, exactly as `onPointerMove` computes them,
    // and not one of them touches the store.
    let preview: Wall[] | null = null
    for (let i = 1; i <= 8; i++) {
      const result = moveWallEndpointIn(
        useDesignStore.getState().walls,
        'n',
        'end',
        { x: 5 + i * 0.1, z: i * 0.1 },
      )
      preview = result.ok ? result.walls : null
    }
    expect(useDesignStore.getState().past.length).toBe(before)

    // The drop: the one write.
    const moved = preview!.find((w) => w.id === 'n')!
    useDesignStore.getState().moveWallEndpoint('n', 'end', moved.end)

    expect(useDesignStore.getState().past.length).toBe(before + 1)
    expect(findLooseJoints(useDesignStore.getState().walls)).toHaveLength(0)
  })

  it('one undo puts both walls back', () => {
    // Both bursts closed explicitly — the fixture's, so the move does not join
    // it, and the move's, so `undo` steps back over the move rather than over
    // both together. Undo must not depend on how fast the machine ran.
    vi.advanceTimersByTime(HISTORY_COALESCE_MS + 50)
    const original = useDesignStore.getState().walls.map((w) => ({ ...w }))

    useDesignStore.getState().moveWallEndpoint('n', 'end', { x: 6.54, z: 1.04 })
    vi.advanceTimersByTime(HISTORY_COALESCE_MS + 50)
    useDesignStore.getState().undo()

    const after = useDesignStore.getState().walls
    expect(after.find((w) => w.id === 'n')!.end).toEqual(original[0].end)
    expect(after.find((w) => w.id === 'e')!.start).toEqual(original[1].start)
  })
})

/* ─── setWallLength still goes through the same cascade ──────────────────── */

describe('B30 — setWallLength and the drag share one cascade', () => {
  beforeEach(() => {
    resetStore()
    useDesignStore.setState({ walls: JUNCTION.map((w) => ({ ...w })), past: [], future: [] })
  })

  /**
   * The regression this extraction could have caused. Asymmetric in: the same
   * store, the same wall, one call typed and one dragged — both must refuse,
   * and refuse for the same reason, or the two paths have drifted.
   */
  it('both refuse the same junction', () => {
    expect(useDesignStore.getState().setWallLength('n', 7)).toBe(false)
    expect(useDesignStore.getState().moveWallEndpoint('n', 'end', { x: 7, z: 0 }).ok).toBe(
      false,
    )
    // And nothing moved.
    expect(useDesignStore.getState().walls.find((w) => w.id === 'n')!.end).toEqual({
      x: 5,
      z: 0,
    })
  })
})

/* ─── the handles are on screen ──────────────────────────────────────────── */

describe('★ B30 — the handles and the refusal are drawn', () => {
  const REFUSAL = '3 walls meet here — move them apart first'

  const scene = (
    handles: { wallId: string; blocked: number; which?: 'start' | 'end' } | null,
  ) => ({
    width: 800,
    height: 600,
    viewport: createViewport(),
    walls: CORNER,
    furniture: [],
    rooms: [],
    selection: null,
    units: 'm' as const,
    anchor: null,
    cursor: null as Point | null,
    showCursor: false,
    handles,
  })

  const calls = (
    handles: { wallId: string; blocked: number; which?: 'start' | 'end' } | null,
  ) => {
    const ctx = recorder({ text: true })
    drawPlan(ctx, scene(handles))
    return ctx.calls
  }

  /**
   * ★ Findings 32, 33 and B28's own indicator: this project ships mechanisms
   * nothing calls, and B29 shipped a field test that was green with the field
   * switched off. Positive delta against the same scene with no handles.
   */
  it('★ draws two handles on the selected wall, and none without one', () => {
    const without = calls(null).filter((c) => c.op === 'arc').length
    const shown = calls({ wallId: 'n', blocked: 0 }).filter((c) => c.op === 'arc').length

    // Two endpoints, each traced twice — halo then face.
    expect(shown - without).toBe(4)
  })

  /**
   * The refusal has to READ as a refusal. Asserted on the drawn STRING, which
   * is the thing a user actually reads — B29's lesson, where a test that could
   * not see the text passed with the feature switched off.
   */
  it('★ says how many walls meet, in words, when blocked', () => {
    // The scene draws other text — dimension strings — so this is a delta on
    // the ONE string that matters rather than a count of every label.
    const idle = calls({ wallId: 'n', blocked: 0 })
      .filter((c) => c.op === 'fillText')
      .map((c) => c.text)
    const blocked = calls({ wallId: 'n', blocked: 3, which: 'end' })
      .filter((c) => c.op === 'fillText')
      .map((c) => c.text)

    expect(idle).not.toContain(REFUSAL)
    expect(blocked).toContain(REFUSAL)
    expect(blocked.length - idle.length).toBe(1)
  })
})
