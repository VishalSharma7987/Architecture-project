import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SWING,
  type Opening,
  type Swing,
  type Wall,
} from '../store/useDesignStore'
import { doorSwing, swingDirection } from './wallGeometry'

/**
 * B21 — a door's swing comes from the model, and every renderer reads the
 * same answer.
 *
 * Two things are under test, and they are different claims:
 *
 *  1. `doorSwing` computes the right geometry from `Opening.swing`, in the
 *     wall's own frame. Pinned against explicit world vectors, because
 *     "left" and "right" are exactly the kind of naming that gets re-derived
 *     backwards — §4 invariant 3 is the same hazard with the same symptom
 *     (invisible on a symmetric plan).
 *  2. Nothing computes it independently. Four sites used to: the canvas arc,
 *     the sheet arc, the sheet's `doorSweep`, and the 3D leaf — which picked
 *     its side at RUNTIME from the walkthrough figure. A pure function is
 *     only a single source of truth if the call sites actually call it, and
 *     no type can say that. So the second half of this file greps the tree,
 *     the pattern `calibration.test.ts` and `provenance.test.ts` already use.
 */

/* ─── fixtures ──────────────────────────────────────────────────────────── */

/**
 * A wall running due EAST: start (0,0) → end (4,0), so `u = (1, 0)`.
 *
 * Chosen because every interesting vector then reduces to a signed unit axis,
 * and a sign error cannot hide behind a diagonal. In plan, world +z runs DOWN
 * the page, so for this wall:
 *
 *   left  = ( uz, -ux) = ( 0, -1) = -z = UP the page
 *   right = (-uz,  ux) = ( 0,  1) = +z = DOWN the page
 */
const EAST_WALL: Wall = {
  id: 'w',
  start: { x: 0, z: 0 },
  end: { x: 4, z: 0 },
  height: 3,
  thickness: 0.2,
  openings: [],
  material: 'white-paint',
}

const door = (swing?: Swing): Opening => ({
  id: 'd',
  type: 'door',
  position: 2,
  width: 1,
  height: 2.1,
  sill: 0,
  ...(swing ? { swing } : {}),
})

/**
 * Rounds away float noise so a vector can be compared as written.
 *
 * The `+ 0` is not decoration: rounding a tiny negative produces `-0`, and
 * `Object.is(-0, 0)` is false, so `toEqual` reports `expected -0 to equal 0`
 * on a vector that is correct. `-0 + 0` is `+0`, which normalises it. Half the
 * first red run of this file was this helper rather than the code under test.
 */
const v = (p: { x: number; z: number }) => ({
  x: Math.round(p.x * 1e6) / 1e6 + 0,
  z: Math.round(p.z * 1e6) / 1e6 + 0,
})

describe('★ B21 — doorSwing, in the wall\'s own frame', () => {
  it('hinges at the jamb nearer wall.start for hand: start', () => {
    const s = doorSwing(EAST_WALL, door({ hand: 'start', side: 'left' }))
    // position 2, width 1 ⇒ jambs at 1.5 and 2.5 along a wall from x=0 east.
    expect(v(s.hinge)).toEqual({ x: 1.5, z: 0 })
    expect(v(s.free)).toEqual({ x: 2.5, z: 0 })
  })

  it('hinges at the far jamb for hand: end, and reverses the leaf axis', () => {
    const s = doorSwing(EAST_WALL, door({ hand: 'end', side: 'left' }))
    expect(v(s.hinge)).toEqual({ x: 2.5, z: 0 })
    expect(v(s.free)).toEqual({ x: 1.5, z: 0 })
    // The leaf at rest runs hinge → free, so it now points back down the wall.
    expect(v(s.axis)).toEqual({ x: -1, z: 0 })
  })

  it('★ pins left and right as world directions, both hands', () => {
    // The claim being pinned: `side` is a property of the WALL, so changing
    // which jamb the door hangs on must not move which side it opens onto.
    // Without this, `hand` and `side` interact and the naming becomes folklore.
    for (const hand of ['start', 'end'] as const) {
      expect(v(swingDirection(doorSwing(EAST_WALL, door({ hand, side: 'left' }))))).toEqual({
        x: 0,
        z: -1, // -z, UP the page
      })
      expect(v(swingDirection(doorSwing(EAST_WALL, door({ hand, side: 'right' }))))).toEqual({
        x: 0,
        z: 1, // +z, DOWN the page
      })
    }
  })

  it('is unchanged when the wall is redrawn end-to-start', () => {
    // The whole reason `Swing` is in the wall's frame rather than in world
    // coordinates. A wall drawn west instead of east is the same wall on the
    // page; its doors must not reverse.
    const west: Wall = { ...EAST_WALL, start: { x: 4, z: 0 }, end: { x: 0, z: 0 } }
    const east = doorSwing(EAST_WALL, door({ hand: 'start', side: 'left' }))
    // Same physical door: position measured from the other end, hand flipped
    // so it hangs on the same jamb, side flipped because "left" is relative to
    // a direction that just reversed.
    const mirrored = doorSwing(west, {
      ...door({ hand: 'end', side: 'right' }),
      position: 2,
    })
    expect(v(mirrored.hinge)).toEqual(v(east.hinge))
    expect(v(swingDirection(mirrored))).toEqual(v(swingDirection(east)))
  })

  it('falls back to the pre-v4 convention when the model carries no swing', () => {
    // A v3 fixture, a hand-edited file, or an opening built by an older code
    // path. It must still DRAW, and it must draw what it always drew.
    const bare = doorSwing(EAST_WALL, door())
    const explicit = doorSwing(EAST_WALL, door(DEFAULT_SWING))
    expect(bare).toEqual(explicit)
    expect(v(swingDirection(bare))).toEqual({ x: 0, z: -1 })
  })

  it('clamps the hinge to the wall, like wallPieces clamps its holes', () => {
    // An opening overhanging the end would otherwise hinge off the wall.
    const overhang = { ...door({ hand: 'end', side: 'left' }), position: 4, width: 2 }
    expect(v(doorSwing(EAST_WALL, overhang).hinge)).toEqual({ x: 4, z: 0 })
  })

  it('puts local +X on the leaf axis for the 3D group', () => {
    // `rotationY = atan2(-axis.z, axis.x)` — the negated z is §4 invariant 3,
    // and for hand: 'start' it must still equal the wall's own rotationY or
    // every existing door moves.
    expect(doorSwing(EAST_WALL, door({ hand: 'start', side: 'left' })).rotationY).toBeCloseTo(0)
    expect(
      Math.abs(doorSwing(EAST_WALL, door({ hand: 'end', side: 'left' })).rotationY),
    ).toBeCloseTo(Math.PI)
  })
})

/* ─── the single source of truth, enforced ──────────────────────────────── */

const read = (path: string) =>
  readFileSync(join(process.cwd(), 'src', path), 'utf8')

describe('★ B21 — no renderer decides the swing for itself', () => {
  /**
   * ★ The three renderers agree on the hinge for a NON-DEFAULT swing.
   *
   * Asserted through the shared helper each of them calls, plus the grep below
   * proving they call it — because the alternative, re-implementing each
   * renderer's arithmetic in the test, would assert that a copy of the code
   * agrees with the code.
   *
   * `{ hand: 'end', side: 'right' }` deliberately, and this is the whole point:
   * for `hand: 'start'` this assertion PASSES VACUOUSLY against the old code,
   * because all four sites hard-coded the start jamb and would have agreed with
   * each other and with the model by coincidence. Only a non-default hand
   * separates "reads the model" from "happens to match the default". A test
   * that can only pass is not a test — SD5 exists for exactly this.
   */
  it('★ agrees on the hinge for { hand: end, side: right }', () => {
    const swing: Swing = { hand: 'end', side: 'right' }
    const s = doorSwing(EAST_WALL, door(swing))

    // The far jamb — NOT the start jamb the old code always used.
    expect(v(s.hinge)).toEqual({ x: 2.5, z: 0 })
    expect(v(s.hinge)).not.toEqual(v(doorSwing(EAST_WALL, door(DEFAULT_SWING)).hinge))
    expect(v(swingDirection(s))).toEqual({ x: 0, z: 1 })
  })

  /**
   * Demonstrated red (SD5) against the four sites as they stood before B21 —
   * `plan/draw.ts` hinging at jambA and arcing -π/2→0, `plan/planSheet.ts`
   * doing the same and then `doorSweep` a SECOND time, and
   * `scene/DoorLeaves.tsx` hinging at t0 with `side.current` taking the
   * direction from `avatarState` inside `useFrame`. The three greps below
   * reported, in order:
   *
   *   expected [ 'plan/draw.ts', 'plan/planSheet.ts', 'scene/DoorLeaves.tsx' ]
   *     to deeply equal []
   *   expected 0 to be greater than or equal to 2
   *   expected 'import { useMemo, useRef } …' not to contain 'side.current'
   *
   * The eight geometry assertions above passed on that same run, which is the
   * point: `doorSwing` was already correct and no renderer was reading it.
   */
  it('★ every renderer that draws a door calls doorSwing', () => {
    const offenders = ['plan/draw.ts', 'plan/planSheet.ts', 'scene/DoorLeaves.tsx']
      .filter((path) => !read(path).includes('doorSwing('))
    expect(offenders).toEqual([])
  })

  it('★ the sheet calls it twice — the arc AND the space it reserves', () => {
    // Finding 20b: `doorSweep` bounds the leaf so `fitExtent` can keep the page
    // fit and the overall dimension setout clear of it. It was kept in step
    // with the arc by a COMMENT, across 170 lines. If it drifts, the sheet
    // reserves space on one side and draws the arc on the other.
    const calls = read('plan/planSheet.ts').match(/doorSwing\(/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('★ the 3D leaf no longer latches its side at runtime', () => {
    const source = read('scene/DoorLeaves.tsx')
    // The exact mechanism: a ref holding ±1, chosen from the avatar's offset
    // along the wall normal, the first frame the door begins to move.
    expect(source).not.toContain('side.current')
    expect(source).not.toMatch(/across\s*>=?\s*0\s*\?/)
  })
})
