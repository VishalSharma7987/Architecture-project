import { describe, expect, it } from 'vitest'
import {
  SNAP_RADIUS_PX,
  findSnap,
  resolveWallPoint,
  type SnapResult,
} from './snap'
import { findLooseJoints } from './repairJoints'
import { drawPlan } from './draw'
import { createViewport } from './viewport'
import { recorder } from '../test/canvasRecorder'
import { snapToGrid } from './viewport'
import { GRID_STEP } from '../units/length'
import { JOIN_TOLERANCE } from '../units/tolerance'
import type { Point, Wall } from '../store/useDesignStore'

/**
 * B28 — endpoint snap while drawing.
 *
 * ── The finding this closes ──
 * Session 1 measured why plans fail to enclose rooms: endpoints land **1 to
 * 152 mm apart**. Session 2 established that welding at DETECTION time is the
 * wrong layer, because the model stays wrong and every consumer re-implements
 * the tolerance. Snapping at DRAWING time makes the stored coordinate correct.
 *
 * ── Why a grid-only chain is not the fixture ──
 * The obvious test — draw four walls in a loop and check it closes — CANNOT
 * FAIL, and reaching for it would have been the thirteenth green-but-empty
 * test in this project. `snapToGrid` is self-consistent: every click it
 * produces is a multiple of the cell, so a chain built entirely from grid
 * points closes exactly whether snapping exists or not.
 *
 * The failure only appears when the thing being joined to is NOT on the grid,
 * which is exactly the real case: walls that arrived from an import, or from a
 * typed length, or from any earlier off-grid operation. Every fixture below is
 * therefore built OFF-GRID, and that is what makes the red run red.
 *
 * ── SD25 ──
 * The priority fixtures are asymmetric in the property under test: the
 * centreline projection and the endpoint are DIFFERENT points, and the
 * centreline is the NEARER of the two. A fixture where they coincide could not
 * tell a working priority rule from no rule at all.
 */

/** The drawing grid the editor snaps to: one half-foot, 152.4 mm. */
const CELL = GRID_STEP.ftin.cell
const grid = (p: Point) => snapToGrid(p, CELL)

/** Default viewport scale, so the radius is the one the editor really uses. */
const SCALE = 44
const RADIUS = SNAP_RADIUS_PX / SCALE

const wall = (id: string, ax: number, az: number, bx: number, bz: number): Wall => ({
  id,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  height: 3,
  thickness: 0.23,
  openings: [],
  material: 'white-paint',
})

/** Drawing one wall of a chain: the click resolves, then becomes the anchor. */
const click = (walls: Wall[], world: Point, suppressed = false): SnapResult =>
  resolveWallPoint({ walls, world, grid: grid(world), radius: RADIUS, suppressed })

/* ─── ★ the chain closes ─────────────────────────────────────────────────── */

describe('★ B28 — a chain drawn onto off-grid walls closes exactly', () => {
  /**
   * Three walls already exist at OFF-GRID coordinates — the state an import
   * leaves behind, and step 5 of the import review flow. The user draws the
   * fourth to close the loop, aiming by hand at each end.
   */
  const OFF = 0.04 // 40 mm off the grid, inside one cell
  const A = { x: OFF, z: OFF }
  const B = { x: 5 + OFF, z: OFF }
  const C = { x: 5 + OFF, z: 4 + OFF }
  const D = { x: OFF, z: 4 + OFF }

  const EXISTING = [wall('n', A.x, A.z, B.x, B.z), wall('e', B.x, B.z, C.x, C.z), wall('s', C.x, C.z, D.x, D.z)]

  /** A hand aiming at a corner, missing by 3 cm — well inside the radius. */
  const nearlyD = { x: D.x + 0.03, z: D.z - 0.02 }
  const nearlyA = { x: A.x - 0.025, z: A.z + 0.03 }

  it('★ produces 0 loose joints, where grid-only produces 2', () => {
    const withSnap = [
      ...EXISTING,
      wall('w', click(EXISTING, nearlyD).point.x, click(EXISTING, nearlyD).point.z,
              click(EXISTING, nearlyA).point.x, click(EXISTING, nearlyA).point.z),
    ]
    expect(findLooseJoints(withSnap)).toHaveLength(0)

    // The same two clicks with snapping off — the baseline this is a delta
    // against, not an absence check.
    const gridOnly = [
      ...EXISTING,
      wall('w', grid(nearlyD).x, grid(nearlyD).z, grid(nearlyA).x, grid(nearlyA).z),
    ]
    expect(findLooseJoints(gridOnly).length).toBeGreaterThan(0)
  })

  /**
   * ★ ACCEPTANCE 1: bit-identical, not within a tolerance.
   *
   * `toBe` on each coordinate rather than `toBeCloseTo`. A test that accepted
   * "within a tolerance" would pass against the exact bug this session exists
   * to remove — endpoints 1–152 mm apart are all "close" at any tolerance
   * loose enough to be worth writing.
   */
  it('★ the closing endpoint is BIT-IDENTICAL to the first, not merely near', () => {
    const closed = click(EXISTING, nearlyA).point

    expect(closed.x).toBe(A.x)
    expect(closed.z).toBe(A.z)
    expect(Object.is(closed.x, A.x)).toBe(true)

    // And the grid could not have produced it: it is off-grid by construction.
    expect(grid(A).x).not.toBe(A.x)
  })

  it('the loose joints grid-only leaves are inside the band Session 1 measured', () => {
    const gapD = Math.hypot(grid(nearlyD).x - D.x, grid(nearlyD).z - D.z)
    const gapA = Math.hypot(grid(nearlyA).x - A.x, grid(nearlyA).z - A.z)

    for (const gap of [gapD, gapA]) {
      expect(gap).toBeGreaterThan(JOIN_TOLERANCE) // too far to weld
      expect(gap).toBeLessThan(CELL) // and under one cell — the 1–152 mm band
    }
  })
})

/* ─── ★ snap beats grid ──────────────────────────────────────────────────── */

describe('★ B28 — snap beats grid', () => {
  /**
   * ★ Asymmetric in: whether the target is on the grid. The endpoint is 40 mm
   * off a cell boundary, so rounding and snapping give demonstrably different
   * answers — on an on-grid target the two agree and the test proves nothing.
   */
  it('★ lands on a 40 mm off-grid target exactly, not on the 152.4 mm cell', () => {
    const target = { x: 3 + 0.04, z: 2 + 0.04 }
    const walls = [wall('a', target.x, target.z, target.x + 3, target.z)]
    const aim = { x: target.x + 0.02, z: target.z + 0.02 }

    const snapped = click(walls, aim)
    expect(snapped.point).toEqual(target)
    expect(snapped.target?.kind).toBe('endpoint')

    // The grid's answer, which is what it would have been without this feature.
    const rounded = grid(aim)
    expect(rounded).not.toEqual(target)
    expect(Math.hypot(rounded.x - target.x, rounded.z - target.z)).toBeGreaterThan(0.02)
  })

  it('falls back to the grid when nothing is in range', () => {
    const walls = [wall('a', 20, 20, 23, 20)]
    const aim = { x: 1.01, z: 1.01 }

    const result = click(walls, aim)
    expect(result.target).toBeNull()
    expect(result.point).toEqual(grid(aim))
  })
})

/* ─── the suppression modifier ───────────────────────────────────────────── */

describe('B28 — Alt suppresses the snap', () => {
  const target = { x: 3.04, z: 2.04 }
  const walls = [wall('a', target.x, target.z, target.x + 3, target.z)]
  const aim = { x: target.x + 0.02, z: target.z + 0.02 }

  /**
   * A positive delta: the SAME aim, the SAME walls, one flag. If suppression
   * were wired to nothing both branches would return the snapped point and
   * these two assertions could not both hold.
   */
  it('restores grid-only behaviour, and grid — not a raw coordinate', () => {
    expect(click(walls, aim, false).point).toEqual(target)

    const suppressed = click(walls, aim, true)
    expect(suppressed.target).toBeNull()
    expect(suppressed.point).toEqual(grid(aim))
    // NOT the raw cursor: Alt means "use the grid", never "place it anywhere".
    expect(suppressed.point).not.toEqual(aim)
  })
})

/* ─── priority ───────────────────────────────────────────────────────────── */

describe('★ B28 — priority: endpoint, then midpoint, then centreline', () => {
  /**
   * ★ SD25. The cursor sits 20 mm off the wall's centreline and 60 mm from its
   * endpoint, so the CENTRELINE IS NEARER. Ranking by distance alone would
   * pick it every time — and would do so on every wall, since an endpoint lies
   * on its own centreline and can therefore never be the closer of the two.
   * That is why priority is by kind and not by distance.
   */
  it('★ prefers the endpoint even when the centreline is nearer', () => {
    const walls = [wall('a', 1, 1, 5, 1)]
    const aim = { x: 1.06, z: 1.02 }

    const perpendicular = Math.abs(aim.z - 1)
    const toEndpoint = Math.hypot(aim.x - 1, aim.z - 1)
    expect(perpendicular).toBeLessThan(toEndpoint) // the fixture is asymmetric

    const snap = findSnap(walls, aim, RADIUS)
    expect(snap?.kind).toBe('endpoint')
    expect(snap?.point).toEqual({ x: 1, z: 1 })
  })

  it('prefers the midpoint over the centreline it lies on', () => {
    const walls = [wall('a', 0, 0, 4, 0)]
    const snap = findSnap(walls, { x: 2.01, z: 0.02 }, RADIUS)

    expect(snap?.kind).toBe('midpoint')
    expect(snap?.point).toEqual({ x: 2, z: 0 })
  })

  it('falls to the centreline away from both ends and the middle', () => {
    const walls = [wall('a', 0, 0, 8, 0)]
    const snap = findSnap(walls, { x: 5.5, z: 0.02 }, RADIUS)

    expect(snap?.kind).toBe('centreline')
    expect(snap?.point.z).toBe(0)
    expect(snap?.point.x).toBeCloseTo(5.5, 9)
  })

  it('never proposes a point off the end of a wall', () => {
    const walls = [wall('a', 0, 0, 4, 0)]
    // Beyond the end, within radius of it: the ENDPOINT is the answer, not an
    // extension of the line. Extension snap is a different target and is
    // deliberately not in this session.
    const snap = findSnap(walls, { x: 4.05, z: 0 }, RADIUS)

    expect(snap?.kind).toBe('endpoint')
    expect(snap?.point).toEqual({ x: 4, z: 0 })
  })
})

/* ─── a corner is one target ─────────────────────────────────────────────── */

describe('B28 — two walls meeting at a corner are ONE target', () => {
  /**
   * The decision this pins: the thing worth snapping to is the COORDINATE, not
   * the wall. A third wall drawn to a corner should join both walls already
   * there, and offering two targets at the same place would force a
   * meaningless choice and stack two indicators.
   */
  it('reports one target carrying both wall ids', () => {
    const corner = { x: 2.04, z: 3.04 }
    const walls = [
      wall('a', 0, 3.04, corner.x, corner.z),
      wall('b', corner.x, corner.z, corner.x, 7),
    ]

    const snap = findSnap(walls, { x: corner.x + 0.02, z: corner.z + 0.01 }, RADIUS)

    expect(snap?.kind).toBe('endpoint')
    expect(snap?.point).toEqual(corner)
    expect([...snap!.wallIds].sort()).toEqual(['a', 'b'])
  })
})

/* ─── the radius is in screen pixels ─────────────────────────────────────── */

describe('B28 — the radius is constant on screen, not in the world', () => {
  /**
   * The same wall and the same SCREEN offset at two zooms. If the radius were
   * a world constant the far zoom would snap from much further away in screen
   * terms, which is the behaviour `HIT_TOLERANCE_PX` exists to avoid for
   * picking.
   */
  const walls = [wall('a', 1, 1, 5, 1)]
  const screenOffsetPx = 10 // inside SNAP_RADIUS_PX at any zoom

  for (const scale of [11, 44, 176]) {
    it(`snaps at ${screenOffsetPx} px whether the zoom is ${scale} px/m or not`, () => {
      const offset = screenOffsetPx / scale
      const snap = findSnap(walls, { x: 1 + offset, z: 1 }, SNAP_RADIUS_PX / scale)
      expect(snap?.point).toEqual({ x: 1, z: 1 })
    })
  }

  it('does not snap just outside the radius at any zoom', () => {
    for (const scale of [11, 44, 176]) {
      const offset = (SNAP_RADIUS_PX + 2) / scale
      expect(findSnap(walls, { x: 1 - offset, z: 1 }, SNAP_RADIUS_PX / scale)).toBeNull()
    }
  })
})

/* ─── the indicator reaches the canvas ───────────────────────────────────── */

describe('★ B28 — the indicator is drawn, and is distinct per kind', () => {
  const scene = (snap: SnapResult['target']) => ({
    width: 800,
    height: 600,
    viewport: createViewport(),
    walls: [wall('a', 0, 0, 4, 0)],
    furniture: [],
    rooms: [],
    selection: null,
    units: 'm' as const,
    anchor: null,
    cursor: null,
    showCursor: false,
    snap,
  })

  const calls = (snap: SnapResult['target']) => {
    const ctx = recorder()
    drawPlan(ctx, scene(snap))
    return ctx.calls
  }

  const at = (kind: 'endpoint' | 'midpoint' | 'centreline') => ({
    kind,
    point: { x: 1, z: 1 },
    wallIds: ['a'],
  })

  /**
   * ★ Findings 32 and 33 are both "shipped, tested, and called by nothing".
   * A suite that stopped at the pure module would have made this the third,
   * and the indicator is the half of this feature the user actually sees.
   *
   * A POSITIVE DELTA against the same scene with no snap — not a token search.
   */
  it('★ draws something at the target that is not drawn without one', () => {
    const without = calls(null).length
    for (const kind of ['endpoint', 'midpoint', 'centreline'] as const) {
      expect(calls(at(kind)).length).toBeGreaterThan(without)
    }
  })

  /**
   * Distinct SHAPES, not one marker in three colours — the recorder captures
   * geometry and not style, which is the right thing to pin: a user has to be
   * able to tell the three apart to refuse the one they did not want.
   */
  it('uses a rect for an endpoint, a closed triangle for a midpoint, an arc for a centreline', () => {
    const ops = (kind: 'endpoint' | 'midpoint' | 'centreline') => {
      const base = calls(null)
      return calls(at(kind))
        .slice(base.length)
        .map((c) => c.op)
    }

    expect(ops('endpoint')).toContain('rect')
    expect(ops('endpoint')).not.toContain('arc')

    expect(ops('midpoint')).toContain('closePath')
    expect(ops('midpoint')).not.toContain('rect')
    expect(ops('midpoint')).not.toContain('arc')

    expect(ops('centreline')).toContain('arc')
    expect(ops('centreline')).not.toContain('rect')
  })
})
