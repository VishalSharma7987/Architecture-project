import type { Wall } from '../store/useDesignStore'
import { wallAxis } from './wallGeometry'

/** Ignore slivers below this size (metres) rather than emit degenerate boxes. */
const EPSILON = 1e-6

/**
 * Extra clearance carved at each jamb of a door gap, in metres.
 *
 * The wall is still *drawn* with its exact opening; this widening exists only
 * so a 0.26 m body can walk a 0.9 m door without snagging. Entering at an
 * angle the circle grazes a jamb long before its centre reaches the gap, and
 * sliding along the jamb face reads as the door being blocked. 0.04 m a side
 * is under the thickness of a real door lining, so nothing looks wrong.
 */
const DOOR_CLEARANCE = 0.04

/**
 * How many times the whole collider set is re-resolved per call.
 *
 * One pass is enough for a single wall, but pushing out of one wall can shove
 * the body into a perpendicular one. Three passes settle an inside corner;
 * more just burns time, since the passes stop early once nothing moves.
 */
const RESOLVE_PASSES = 3

/**
 * Longest straight step, as a fraction of the body radius, taken before
 * collisions are resolved again. Anything approaching a full diameter could
 * jump clean over a thin wall between two frames.
 */
const SWEEP_STEP_RATIO = 0.6

/** Radius the follow camera is kept clear of walls by, in metres. */
const CAMERA_PROBE = 0.22

/** Sampling interval used when pulling the follow camera in, in metres. */
const CAMERA_STEP = 0.15

/** A solid, walkable-blocking box: a wall run between its door openings. */
export type Collider = {
  /** Centre on the floor plane. */
  cx: number
  cz: number
  /** Half-extents along the wall and across its thickness. */
  halfLength: number
  halfThickness: number
  /** Wall direction, as unit vector components. */
  ux: number
  uz: number
}

/**
 * The floor-plane boxes a body cannot walk through.
 *
 * Only doors punch a hole. A window keeps its 0.9 m sill, so the wall under it
 * is as solid to a walker as any other run — you would have to climb it — and
 * treating windows as gaps is the difference between a house and a maze with
 * secret exits.
 */
export function wallColliders(walls: Wall[]): Collider[] {
  const colliders: Collider[] = []

  for (const wall of walls) {
    const { length, ux, uz } = wallAxis(wall)
    if (length <= EPSILON) continue

    const push = (t0: number, t1: number) => {
      const span = t1 - t0
      if (span <= EPSILON) return

      const mid = (t0 + t1) / 2
      colliders.push({
        cx: wall.start.x + ux * mid,
        cz: wall.start.z + uz * mid,
        halfLength: span / 2,
        halfThickness: wall.thickness / 2,
        ux,
        uz,
      })
    }

    const gaps = wall.openings
      // A cased opening is a hole with no leaf, so it is at least as walkable
      // as a doorway — the rule below already says a hole you can see through
      // must stay a hole you can walk through. Filtering on `'door'` alone
      // made one a solid wall to the walking figure while the 3D geometry
      // showed a gap: you would stop dead in an opening you could see through.
      // A window is still solid, because its sill is not.
      .filter((o) => o.type === 'door' || o.type === 'cased')
      .map((o) => ({
        t0: Math.max(0, o.position - o.width / 2 - DOOR_CLEARANCE),
        t1: Math.min(length, o.position + o.width / 2 + DOOR_CLEARANCE),
      }))
      .filter((g) => g.t1 - g.t0 > EPSILON)
      .sort((a, b) => a.t0 - b.t0)

    let cursor = 0

    for (const gap of gaps) {
      // Unlike `wallPieces`, overlapping doors merge rather than the later one
      // being dropped: a hole you can see through must stay a hole you can
      // walk through, whichever opening made it.
      if (gap.t0 < cursor - EPSILON) {
        cursor = Math.max(cursor, gap.t1)
        continue
      }

      push(cursor, gap.t0)
      cursor = gap.t1
    }

    push(cursor, length)
  }

  return colliders
}

const clamp = (v: number, limit: number) => Math.min(limit, Math.max(-limit, v))

/**
 * The circle's position after being pushed clear of one box, or null when it
 * never overlapped it. Works in the box's local (along, across) frame.
 */
function separate(
  x: number,
  z: number,
  radius: number,
  c: Collider,
): { x: number; z: number } | null {
  // The wall normal on the floor plane; (ux, uz) rotated a quarter turn.
  const px = -c.uz
  const pz = c.ux

  const dx = x - c.cx
  const dz = z - c.cz
  const along = dx * c.ux + dz * c.uz
  const across = dx * px + dz * pz

  const nearAlong = clamp(along, c.halfLength)
  const nearAcross = clamp(across, c.halfThickness)
  const offAlong = along - nearAlong
  const offAcross = across - nearAcross
  const distSq = offAlong * offAlong + offAcross * offAcross

  let outAlong = along
  let outAcross = across

  if (distSq > EPSILON * EPSILON) {
    if (distSq >= radius * radius) return null

    const dist = Math.sqrt(distSq)
    outAlong = nearAlong + (offAlong / dist) * radius
    outAcross = nearAcross + (offAcross / dist) * radius
  } else {
    // The centre is inside the box, or exactly on its face: there is no
    // separating direction to normalise, and dividing by the zero distance
    // would give NaN. Leave by whichever face is nearest instead — for a wall
    // that is almost always the side you came in from.
    const depthAlong = c.halfLength - Math.abs(along)
    const depthAcross = c.halfThickness - Math.abs(across)

    if (depthAcross <= depthAlong) {
      outAcross = (across < 0 ? -1 : 1) * (c.halfThickness + radius)
    } else {
      outAlong = (along < 0 ? -1 : 1) * (c.halfLength + radius)
    }
  }

  return {
    x: c.cx + c.ux * outAlong + px * outAcross,
    z: c.cz + c.uz * outAlong + pz * outAcross,
  }
}

/**
 * Slides a circle of `radius` out of every collider it overlaps.
 * Returns the corrected position.
 */
export function resolveCollisions(
  x: number,
  z: number,
  radius: number,
  colliders: Collider[],
): { x: number; z: number } {
  let px = x
  let pz = z

  for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
    let moved = false

    for (const collider of colliders) {
      const out = separate(px, pz, radius, collider)
      if (!out) continue
      px = out.x
      pz = out.z
      moved = true
    }

    // Settled: further passes would only repeat the same no-ops.
    if (!moved) break
  }

  return { x: px, z: pz }
}

/**
 * Moves a circle from one point to another, resolving collisions along the
 * way, and returns where it actually ends up.
 *
 * Resolving only at the destination is not enough: a running body covers up
 * to 0.62 m in one capped frame, which is wider than a wall plus the body,
 * so the destination can land clear on the far side with nothing overlapping
 * to push back. Stepping the move keeps the wall solid at any frame rate.
 */
export function moveWithCollisions(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius: number,
  colliders: Collider[],
): { x: number; z: number } {
  const dx = toX - fromX
  const dz = toZ - fromZ
  const distance = Math.hypot(dx, dz)
  const steps = Math.max(1, Math.ceil(distance / (radius * SWEEP_STEP_RATIO)))
  const stepX = dx / steps
  const stepZ = dz / steps

  let x = fromX
  let z = fromZ

  // Each substep starts from where the previous one was pushed to, so a body
  // sliding along a wall keeps its slide instead of being snapped back onto
  // the straight path it asked for.
  for (let i = 0; i < steps; i++) {
    const next = resolveCollisions(x + stepX, z + stepZ, radius, colliders)
    x = next.x
    z = next.z
  }

  return { x, z }
}

/** Whether a circle at this point overlaps any collider. */
function blocked(
  x: number,
  z: number,
  radius: number,
  colliders: Collider[],
): boolean {
  for (const c of colliders) {
    const dx = x - c.cx
    const dz = z - c.cz
    const along = dx * c.ux + dz * c.uz
    const across = dx * -c.uz + dz * c.ux
    const offAlong = along - clamp(along, c.halfLength)
    const offAcross = across - clamp(across, c.halfThickness)

    if (offAlong * offAlong + offAcross * offAcross < radius * radius) {
      return true
    }
  }

  return false
}

/** Pulls a follow camera in toward the subject so it never sits inside a wall. */
export function clampCameraDistance(
  subject: { x: number; z: number },
  angle: number,
  desired: number,
  colliders: Collider[],
  minimum: number,
): number {
  if (desired <= minimum) return desired

  // Matches `followCameraPosition`: the camera sits opposite the heading.
  const dirX = -Math.sin(angle)
  const dirZ = -Math.cos(angle)

  const clearAt = (d: number) =>
    !blocked(
      subject.x + dirX * d,
      subject.z + dirZ * d,
      CAMERA_PROBE,
      colliders,
    )

  // Sampled rather than raycast: the camera is a volume, not a point, and a
  // single ray happily threads a doorway the camera body would not fit.
  //
  // The march starts at the figure, NOT at `minimum`. Starting at `minimum`
  // never sees a wall standing closer than that, so a figure with its back to
  // one puts the camera clean through it, framing the outside of the house.
  // Everything past the first obstruction is occluded even where it is
  // geometrically free, so the first block ends the search.
  let clear = 0

  for (let d = CAMERA_STEP; d < desired; d += CAMERA_STEP) {
    if (!clearAt(d)) return clear
    clear = d
  }

  return clearAt(desired) ? desired : clear
}
