import { describe, expect, it } from 'vitest'
import type { Opening, Wall } from '../store/useDesignStore'
import { DEFAULT_WALL_MATERIAL } from '../materials/palette'
import { SLAB } from './config'
import {
  openingBoxes,
  pickOpening,
  pickWall,
  planBounds,
  pointAlongWall,
  projectOntoWall,
  wallAxis,
  wallPieces,
} from './wallGeometry'

/**
 * The widest-reach pure module in the codebase — 16 files depend on it, and
 * `planBounds` alone anchors the Vastu grid, the plot fit, the 3D camera, the
 * print sheet and the walk spawn point.
 *
 * The README claimed this file was "kept pure and tested by mapping a box's
 * end faces back onto the wall's original endpoints". It was pure; there was
 * no test. That specific assertion is the first one below.
 */

const wall = (over: Partial<Wall> = {}): Wall => ({
  id: 'w',
  start: { x: 0, z: 0 },
  end: { x: 4, z: 0 },
  height: 3,
  thickness: 0.2,
  openings: [],
  material: DEFAULT_WALL_MATERIAL,
  ...over,
})

const opening = (over: Partial<Opening> = {}): Opening => ({
  id: 'o',
  type: 'door',
  position: 2,
  width: 0.9,
  height: 2.1,
  sill: 0,
  ...over,
})

/** Rotates a local offset by the piece's Y rotation, as three.js would. */
function toWorld(
  piece: { position: [number, number, number]; rotationY: number },
  localX: number,
) {
  // A positive Y rotation carries local +X toward -Z.
  return {
    x: piece.position[0] + Math.cos(piece.rotationY) * localX,
    z: piece.position[2] - Math.sin(piece.rotationY) * localX,
  }
}

describe('★ the rotation sign — §4 invariant 3', () => {
  /**
   * `rotationY = atan2(-dz, dx)`. The negated `dz` is what stops the 3D build
   * mirroring the plan, and getting it wrong is invisible on any symmetric
   * layout. This is the README's own described test, finally written: take the
   * single piece of an opening-free wall and map its end faces back through
   * its rotation; they must land on the wall's own endpoints.
   */
  const CASES: [name: string, w: Wall][] = [
    ['east', wall({ start: { x: 0, z: 0 }, end: { x: 4, z: 0 } })],
    ['west', wall({ start: { x: 4, z: 0 }, end: { x: 0, z: 0 } })],
    ['south (+z)', wall({ start: { x: 0, z: 0 }, end: { x: 0, z: 4 } })],
    ['north (-z)', wall({ start: { x: 0, z: 4 }, end: { x: 0, z: 0 } })],
    ['diagonal', wall({ start: { x: -1, z: -2 }, end: { x: 3, z: 5 } })],
    ['reverse diagonal', wall({ start: { x: 3, z: 5 }, end: { x: -1, z: -2 } })],
  ]

  for (const [name, w] of CASES) {
    it(`maps the box's end faces back onto the endpoints — ${name}`, () => {
      const [piece] = wallPieces(w)
      const half = piece.scale[0] / 2

      const a = toWorld(piece, -half)
      const b = toWorld(piece, +half)

      expect(a.x).toBeCloseTo(w.start.x, 9)
      expect(a.z).toBeCloseTo(w.start.z, 9)
      expect(b.x).toBeCloseTo(w.end.x, 9)
      expect(b.z).toBeCloseTo(w.end.z, 9)
    })
  }

  it('a mirrored sign would fail these — asymmetry is the point', () => {
    // Guards the guard: on an east-west wall the sign is invisible, so at
    // least one case must have a non-zero dz. It does.
    const diagonal = CASES.find(([n]) => n === 'diagonal')![1]
    expect(wallAxis(diagonal).rotationY).not.toBe(
      Math.atan2(diagonal.end.z - diagonal.start.z, diagonal.end.x - diagonal.start.x),
    )
  })
})

describe('wallPieces', () => {
  it('is one full-height box when there are no openings', () => {
    const pieces = wallPieces(wall())
    expect(pieces).toHaveLength(1)
    expect(pieces[0].scale).toEqual([4, 3, 0.2])
    expect(pieces[0].position[1]).toBeCloseTo(SLAB.top + 1.5, 9)
  })

  it('leaves a door as a gap to the floor — no sill piece', () => {
    const pieces = wallPieces(wall({ openings: [opening({ sill: 0 })] }))
    // Two runs either side, plus the lintel above. No sill.
    expect(pieces).toHaveLength(3)
    expect(pieces.some((p) => p.key.startsWith('sill-'))).toBe(false)
    expect(pieces.some((p) => p.key.startsWith('head-'))).toBe(true)
  })

  it('leaves a window with wall below and above', () => {
    const pieces = wallPieces(
      wall({ openings: [opening({ type: 'window', sill: 0.9, height: 1.2 })] }),
    )
    expect(pieces.some((p) => p.key.startsWith('sill-'))).toBe(true)
    expect(pieces.some((p) => p.key.startsWith('head-'))).toBe(true)
  })

  it('emits no lintel when the opening reaches the top of the wall', () => {
    const pieces = wallPieces(
      wall({ openings: [opening({ sill: 0, height: 3 })] }),
    )
    expect(pieces.some((p) => p.key.startsWith('head-'))).toBe(false)
  })

  it('skips an overlapping opening rather than emitting negative geometry', () => {
    const pieces = wallPieces(
      wall({
        openings: [
          opening({ id: 'a', position: 2, width: 1 }),
          opening({ id: 'b', position: 2.2, width: 1 }),
        ],
      }),
    )
    for (const piece of pieces) {
      expect(piece.scale[0]).toBeGreaterThan(0)
      expect(piece.scale[1]).toBeGreaterThan(0)
    }
  })

  it('conserves length: the solid runs plus the openings equal the wall', () => {
    const w = wall({ openings: [opening({ position: 1, width: 0.9 })] })
    const runs = wallPieces(w).filter((p) => p.key.startsWith('run-'))
    const solid = runs.reduce((total, p) => total + p.scale[0], 0)
    expect(solid + 0.9).toBeCloseTo(4, 9)
  })

  it('is empty for a degenerate wall', () => {
    expect(wallPieces(wall({ end: { x: 0, z: 0 } }))).toEqual([])
  })
})

describe('openingBoxes', () => {
  it('fills exactly the slot wallPieces cuts out', () => {
    const w = wall({ openings: [opening({ position: 2, width: 0.9, height: 2.1 })] })
    const [box] = openingBoxes(w)
    expect(box.scale[0]).toBeCloseTo(0.9, 9)
    expect(box.scale[1]).toBeCloseTo(2.1, 9)
    // Thicker than the wall, so it protrudes and is clickable from either side.
    expect(box.scale[2]).toBeGreaterThan(w.thickness)
  })
})

describe('projectOntoWall', () => {
  it('clamps to the wall rather than running off its ends', () => {
    const w = wall()
    expect(projectOntoWall(w, { x: -5, z: 0 }).t).toBe(0)
    expect(projectOntoWall(w, { x: 99, z: 0 }).t).toBeCloseTo(4, 9)
  })

  it('reports the perpendicular distance', () => {
    expect(projectOntoWall(wall(), { x: 2, z: 1.5 }).distance).toBeCloseTo(1.5, 9)
  })

  it('survives a zero-length wall', () => {
    const p = projectOntoWall(wall({ end: { x: 0, z: 0 } }), { x: 3, z: 4 })
    expect(p.t).toBe(0)
    expect(p.distance).toBe(5)
    expect(Number.isFinite(p.length)).toBe(true)
  })
})

describe('pickWall', () => {
  it('admits half the wall thickness on top of the tolerance', () => {
    // Clicks land on a wall's face, not its centreline.
    const w = wall({ thickness: 0.4 })
    expect(pickWall([w], { x: 2, z: 0.25 }, 0.1)).not.toBeNull()
    expect(pickWall([w], { x: 2, z: 0.35 }, 0.1)).toBeNull()
  })

  it('returns the nearest of several', () => {
    const near = wall({ id: 'near', start: { x: 0, z: 1 }, end: { x: 4, z: 1 } })
    const far = wall({ id: 'far', start: { x: 0, z: 3 }, end: { x: 4, z: 3 } })
    expect(pickWall([far, near], { x: 2, z: 1.1 }, 0.5)?.wall.id).toBe('near')
  })
})

describe('pickOpening', () => {
  it('counts anywhere along the opening as a hit', () => {
    const w = wall({ openings: [opening({ position: 2, width: 1.2 })] })
    expect(pickOpening([w], pointAlongWall(w, 2.4), 0.05)).not.toBeNull()
    expect(pickOpening([w], pointAlongWall(w, 3.5), 0.05)).toBeNull()
  })
})

describe('planBounds', () => {
  it('is null with no walls, so callers can tell "empty" from "at the origin"', () => {
    expect(planBounds([])).toBeNull()
  })

  it('spans every endpoint', () => {
    const bounds = planBounds([
      wall({ start: { x: -2, z: -3 }, end: { x: 4, z: -3 } }),
      wall({ start: { x: 4, z: -3 }, end: { x: 4, z: 5 } }),
    ])!
    expect(bounds.min).toEqual({ x: -2, z: -3 })
    expect(bounds.max).toEqual({ x: 4, z: 5 })
    expect(bounds.center).toEqual({ x: 1, z: 1 })
    expect(bounds.width).toBe(6)
    expect(bounds.depth).toBe(8)
  })

  it('gives a single wall zero extent on one axis, not NaN', () => {
    // `fitToBounds` divides by these, and an infinite scale is what the
    // 0.001 floor there exists to avoid.
    const bounds = planBounds([wall()])!
    expect(bounds.depth).toBe(0)
    expect(Number.isFinite(bounds.width)).toBe(true)
  })
})
