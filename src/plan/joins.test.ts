import { describe, expect, it } from 'vitest'
import { detectRoomsUncached } from './rooms'
import { JOIN_TOLERANCE } from '../units/tolerance'
import type { Wall } from '../store/useDesignStore'

/**
 * Session 2 — the seven fixtures from the room-detection diagnostic.
 *
 * A real 30-wall plan reported ONE room and 176 sq ft on a ~870 sq ft
 * building. These reproduce the failure at each magnitude, and they are here
 * as a permanent regression floor: they are the shapes that actually shipped
 * broken, not shapes invented to exercise a branch.
 *
 * ── Every assertion is a COUNT and an AREA ──
 * Never `rooms.length > 0`. Six of these seven fixtures would pass that, and
 * so would the bug. This project has now found six tests that were green while
 * proving nothing; this comment is the seventh time it has been worth saying.
 *
 * ── The cascade being pinned ──
 * A near-miss endpoint makes a graph node degree-1, `pruneDangles` deletes its
 * edge, that drops a neighbour to degree-1, and it iterates to a fixed point.
 * So the damage is not proportional to the error: one bad joint costs one room
 * (E), five cost four (B, D), and the instrumented run that opened this
 * session watched ±4 mm of endpoint jitter delete every edge in the graph.
 *
 * ── Demonstrated red (SD5) ──
 * With `JOIN_TOLERANCE` put back to its old 1 mm, fixture C reports
 *
 *   expected 1 to be 5
 *
 * — the four-millimetre near-miss pruning four of the five spaces away. The
 * other seven fixtures stay green, which is what says the weld is what moved
 * and not the traversal.
 */

/** The ft-in drawing grid, which is what the editor snaps to. */
const G = 0.1524

/** 64 x 54 grid cells: 9.7536 m x 8.2296 m, about 32'0" x 27'0". */
const SHELL = { w: 64, d: 54 }
const FULL_AREA = SHELL.w * G * (SHELL.d * G)

const wall = (id: string, ax: number, az: number, bx: number, bz: number, t: number): Wall => ({
  id,
  start: { x: ax * G, z: az * G },
  end: { x: bx * G, z: bz * G },
  height: 3,
  thickness: t,
  openings: [],
  material: 'white-paint',
})

/**
 * Shell plus five partitions dividing it into five spaces.
 *
 * `pullBack` moves every partition endpoint that meets the shell inward by
 * that many metres — modelling a user who clicked the wall's visible FACE
 * instead of its invisible centreline, which is the most plausible real-world
 * generator of the failure.
 */
function plan(pullBack = 0): Wall[] {
  const S = 0.2
  const P = 0.1
  const p = pullBack
  return [
    wall('s1', 0, 0, SHELL.w, 0, S),
    wall('s2', SHELL.w, 0, SHELL.w, SHELL.d, S),
    wall('s3', SHELL.w, SHELL.d, 0, SHELL.d, S),
    wall('s4', 0, SHELL.d, 0, 0, S),
    { ...wall('p1', 24, 0, 24, 30, P), start: { x: 24 * G, z: p } },
    { ...wall('p2', 0, 30, 24, 30, P), start: { x: p, z: 30 * G } },
    { ...wall('p3', 44, 0, 44, 30, P), start: { x: 44 * G, z: p } },
    { ...wall('p4', 24, 30, SHELL.w, 30, P), end: { x: SHELL.w * G - p, z: 30 * G } },
    { ...wall('p5', 30, 30, 30, SHELL.d, P), end: { x: 30 * G, z: SHELL.d * G - p } },
  ]
}


const measure = (walls: Wall[]) => {
  const rooms = detectRoomsUncached(walls)
  return { count: rooms.length, area: rooms.reduce((s, r) => s + r.area, 0) }
}

describe('★ room detection — the seven diagnostic fixtures', () => {
  it('A · exact centrelines resolve every space', () => {
    const { count, area } = measure(plan(0))
    expect(count).toBe(5)
    expect(area).toBeCloseTo(FULL_AREA, 6)
  })

  it('★ C · a 4 mm near-miss now resolves, and did not before', () => {
    // Modelled as a PULL-BACK, not as jitter. The first draft of this test
    // jittered every endpoint by ±4 mm and passed at a 1 mm weld — because
    // jittered walls still CROSS, and `splitAtIntersections` cuts at a
    // crossing whatever the tolerance is. It exercised nothing. A partition
    // pulled 4 mm short of the shell touches nothing, which is precisely the
    // case the weld governs.
    const { count, area } = measure(plan(0.004))
    expect(count).toBe(5)
    // The partitions are 4 mm shorter, so the divisions move by a hair; the
    // shell is untouched, so the total is unchanged.
    expect(area).toBeCloseTo(FULL_AREA, 6)
  })

  it('E · one partition 50 mm short costs exactly one room', () => {
    const walls = plan(0)
    walls[4] = { ...walls[4], start: { x: walls[4].start.x, z: 0.05 } }
    const { count, area } = measure(walls)
    expect(count).toBe(4)
    // The shell still closes, so the total is unchanged — only the division
    // is lost. That is the signature of a single pruned partition.
    expect(area).toBeCloseTo(FULL_AREA, 6)
  })

  it('F · one shell corner 50 mm apart opens the outer loop', () => {
    const walls = plan(0)
    walls[0] = { ...walls[0], end: { x: SHELL.w * G - 0.05, z: 0 } }
    const { count, area } = measure(walls)
    expect(count).toBe(4)
    // Distinct from E: here the TOTAL drops, because the outer face is gone.
    expect(area).toBeLessThan(FULL_AREA)
    expect(area).toBeCloseTo(66.29, 1)
  })

  it('G · a typed length that moves an endpoint alone breaks the join', () => {
    // What `setWallLength` did before this session: end := start + unit*len,
    // with the wall that shared the old endpoint left where it was.
    const walls = plan(0)
    walls[0] = { ...walls[0], end: { x: 9.6, z: 0 } }
    const { count, area } = measure(walls)
    expect(count).toBe(4)
    expect(area).toBeCloseTo(66.29, 1)
  })

  it('★ D · partitions drawn to the wall FACE collapse the plan to one room', () => {
    // 100 mm — half of the 200 mm shell. The user clicked what they could see.
    const { count, area } = measure(plan(0.1))
    expect(count).toBe(1)
    // The shell survives, so the ONE room is the whole building undivided.
    // This is the symptom the diagnostic was opened for.
    expect(area).toBeCloseTo(FULL_AREA, 6)
  })

  it('★ B · partitions one grid cell short collapse it the same way', () => {
    const { count, area } = measure(plan(G))
    expect(count).toBe(1)
    expect(area).toBeCloseTo(FULL_AREA, 6)
  })

  it('★ the weld does NOT close a gap wider than itself', () => {
    // The guard on the guard. If someone later raises JOIN_TOLERANCE to
    // "fix" B and D, this fails — which is the intended alarm, because a
    // tolerance that large fuses two legally distinct walls and merges two
    // real rooms silently. See `units/tolerance.ts`.
    expect(JOIN_TOLERANCE).toBeLessThan(0.02) // thinnest legal wall
    expect(JOIN_TOLERANCE).toBeLessThan(G / 4) // stays predictable on the grid

    // Probed with a PULL-BACK, not with jitter. Jittered walls still cross
    // each other, and `splitAtIntersections` cuts at a crossing whatever the
    // tolerance is — so jitter tests the wrong thing above the weld. A
    // partition pulled short of the shell touches nothing, which is exactly
    // the case the tolerance governs.
    const justInside = measure(plan(JOIN_TOLERANCE * 0.5))
    const justOutside = measure(plan(JOIN_TOLERANCE * 2))
    expect(justInside.count).toBe(5)
    expect(justOutside.count).toBe(1)
  })
})
