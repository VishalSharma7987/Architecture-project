import { describe, expect, it } from 'vitest'
import { DEFAULT_WALL_MATERIAL } from '../materials/palette'
import type { Opening, Wall } from '../store/useDesignStore'
import { AVATAR } from './config'
import {
  clampCameraDistance,
  moveWithCollisions,
  resolveCollisions,
  wallColliders,
} from './collision'

/**
 * The walkthrough's solidity.
 *
 * §4 invariant 6: the degenerate branch — when the body's centre is inside a
 * box there is no separating direction to normalise — is what stops the figure
 * becoming `NaN` and vanishing. It has no other guard.
 */

const wall = (over: Partial<Wall> = {}): Wall => ({
  id: 'w',
  start: { x: -5, z: 0 },
  end: { x: 5, z: 0 },
  height: 3,
  thickness: 0.2,
  openings: [],
  material: DEFAULT_WALL_MATERIAL,
  ...over,
})

const door = (over: Partial<Opening> = {}): Opening => ({
  id: 'd',
  type: 'door',
  position: 5,
  width: 0.9,
  height: 2.1,
  sill: 0,
  ...over,
})

const R = AVATAR.radius

describe('wallColliders', () => {
  it('is one box for a solid wall', () => {
    expect(wallColliders([wall()])).toHaveLength(1)
  })

  it('★ punches a hole for a door but not for a window', () => {
    // A window keeps its 0.9 m sill, so the wall under it is as solid to a
    // walker as any other run. Treating windows as gaps is the difference
    // between a house and a maze with secret exits.
    expect(wallColliders([wall({ openings: [door()] })])).toHaveLength(2)
    expect(
      wallColliders([wall({ openings: [door({ type: 'window', sill: 0.9 })] })]),
    ).toHaveLength(1)
  })

  it('merges overlapping doors rather than dropping the later one', () => {
    // Unlike `wallPieces`, which skips an overlap: a hole you can see through
    // must stay a hole you can walk through, whichever opening made it.
    const colliders = wallColliders([
      wall({
        openings: [door({ id: 'a', position: 4, width: 1 }), door({ id: 'b', position: 4.5, width: 1 })],
      }),
    ])
    expect(colliders).toHaveLength(2)
  })

  it('ignores a zero-length wall', () => {
    expect(wallColliders([wall({ end: { x: -5, z: 0 } })])).toEqual([])
  })
})

describe('resolveCollisions', () => {
  it('pushes a body clear of a wall it overlaps', () => {
    const colliders = wallColliders([wall()])
    const out = resolveCollisions(0, 0.05, R, colliders)
    expect(Math.abs(out.z)).toBeGreaterThanOrEqual(0.1 + R - 1e-9)
  })

  it('leaves a body that is already clear exactly where it is', () => {
    const colliders = wallColliders([wall()])
    const out = resolveCollisions(0, 3, R, colliders)
    expect(out).toEqual({ x: 0, z: 3 })
  })

  it('★ never produces NaN when the centre is inside the box', () => {
    // The degenerate branch. Dead centre of the wall, where there is no
    // separating direction to normalise.
    const colliders = wallColliders([wall({ thickness: 1 })])
    const out = resolveCollisions(0, 0, R, colliders)

    expect(Number.isFinite(out.x)).toBe(true)
    expect(Number.isFinite(out.z)).toBe(true)
    // Ejected across the nearer face, which for a wall is always the thickness.
    expect(Math.abs(out.z)).toBeCloseTo(0.5 + R, 9)
  })

  it('settles an inside corner where one push shoves into another wall', () => {
    const colliders = wallColliders([
      wall(),
      wall({ id: 'v', start: { x: 0, z: 0 }, end: { x: 0, z: 10 } }),
    ])
    const out = resolveCollisions(0.02, 0.02, R, colliders)

    expect(Number.isFinite(out.x)).toBe(true)
    // Clear of BOTH after the multi-pass resolve, not just the last one seen.
    for (const c of colliders) {
      const dx = out.x - c.cx
      const dz = out.z - c.cz
      const along = dx * c.ux + dz * c.uz
      const across = dx * -c.uz + dz * c.ux
      const offAlong = along - Math.min(c.halfLength, Math.max(-c.halfLength, along))
      const offAcross =
        across - Math.min(c.halfThickness, Math.max(-c.halfThickness, across))
      expect(offAlong ** 2 + offAcross ** 2).toBeGreaterThanOrEqual(R * R - 1e-6)
    }
  })
})

describe('★ moveWithCollisions sweeps, and that is why walls stay solid', () => {
  it('does not tunnel through a thin wall at run speed', () => {
    // A running body covers up to 0.62 m in one capped frame, which is wider
    // than a 0.2 m wall plus the body. Resolving only at the destination would
    // find nothing overlapping and let it straight through.
    const colliders = wallColliders([wall()])
    const out = moveWithCollisions(0, -0.5, 0, 0.5, R, colliders)

    expect(out.z).toBeLessThan(0)
  })

  it('lets a body walk through a doorway', () => {
    // Same sweep, aimed at the gap. `DOOR_CLEARANCE` widens each jamb slightly
    // so a 0.26 m body can pass a 0.9 m door without snagging.
    const colliders = wallColliders([wall({ openings: [door({ position: 5 })] })])
    const out = moveWithCollisions(0, -0.5, 0, 0.5, R, colliders)

    expect(out.z).toBeGreaterThan(0)
  })

  it('slides along a wall instead of stopping dead against it', () => {
    const colliders = wallColliders([wall()])
    const out = moveWithCollisions(-1, -0.05, 1, -0.05, R, colliders)

    // Made progress along the wall...
    expect(out.x).toBeGreaterThan(0.5)
    // ...without ending up inside it.
    expect(Math.abs(out.z)).toBeGreaterThanOrEqual(0.1 + R - 1e-9)
  })

  it('is stable for a zero-length move', () => {
    const colliders = wallColliders([wall()])
    expect(moveWithCollisions(0, 3, 0, 3, R, colliders)).toEqual({ x: 0, z: 3 })
  })
})

describe('clampCameraDistance', () => {
  it('pulls the follow camera in when a wall is behind the figure', () => {
    // The march starts at the figure, not at the minimum — starting at the
    // minimum never sees a wall standing closer than that, and the camera ends
    // up outside the house framing the wrong side of it.
    const colliders = wallColliders([
      wall({ start: { x: -5, z: 1 }, end: { x: 5, z: 1 } }),
    ])
    // Facing -z, so the camera boom points +z, straight into that wall.
    const pulled = clampCameraDistance({ x: 0, z: 0 }, Math.PI, 3.4, colliders, 0.8)

    expect(pulled).toBeLessThan(3.4)
    expect(pulled).toBeGreaterThanOrEqual(0)
  })

  it('leaves the camera alone in the open', () => {
    expect(clampCameraDistance({ x: 0, z: 0 }, 0, 3.4, [], 0.8)).toBe(3.4)
  })

  it('does not march at all when the boom is already at the minimum', () => {
    expect(clampCameraDistance({ x: 0, z: 0 }, 0, 0.5, [], 0.8)).toBe(0.5)
  })
})
