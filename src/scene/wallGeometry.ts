import type { FurnitureItem, Opening, Point, Wall } from '../store/useDesignStore'
import { DEFAULT_SWING } from '../store/useDesignStore'
import { furnitureSize } from '../furniture/catalog'
import { SLAB } from './config'

/** Ignore slivers below this size (metres) rather than emit degenerate boxes. */
const EPSILON = 1e-6

/** The wall's direction, length, and Y rotation — the basis for all wall maths. */
export function wallAxis(wall: Wall) {
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.z - wall.start.z
  const length = Math.hypot(dx, dz)

  return {
    length,
    /** Unit vector from start to end. Zero-length walls report (0, 0). */
    ux: length === 0 ? 0 : dx / length,
    uz: length === 0 ? 0 : dz / length,
    /**
     * A positive Y rotation carries local +X toward -Z, so mapping +X onto the
     * wall direction needs `atan2(-dz, dx)` — note the negated dz. Getting this
     * sign wrong mirrors the whole plan, which is invisible on a symmetric one.
     */
    rotationY: Math.atan2(-dz, dx),
  }
}

/** World-space point `t` metres along the wall from its start. */
export function pointAlongWall(wall: Wall, t: number): Point {
  const { ux, uz } = wallAxis(wall)
  return { x: wall.start.x + ux * t, z: wall.start.z + uz * t }
}

/** Everything a renderer needs to draw a door leaf, from the model alone. */
export type DoorSwing = {
  /** World point the leaf hinges on. */
  hinge: Point
  /** World point of the free jamb. The leaf at rest runs `hinge` → `free`. */
  free: Point
  /** Unit vector along the leaf at rest, `hinge` → `free`. */
  axis: { x: number; z: number }
  /**
   * Which way the free edge sweeps, as a sign on the axis's perpendicular.
   * Use `swingDirection` rather than applying it by hand.
   */
  sweep: 1 | -1
  /**
   * Y rotation putting local +X on `axis`, for a three.js group. Note the
   * negated z — §4 invariant 3. For `hand: 'start'` this equals the wall's own
   * `rotationY`, which is what keeps every pre-v4 door exactly where it was.
   */
  rotationY: number
}

/**
 * Where a door hangs and which way it opens — THE single source of truth,
 * derived from `Opening.swing` and nothing else.
 *
 * ── Why this function exists ──
 * Four sites used to decide this independently: the canvas arc, the print
 * sheet's arc, the sheet's `doorSweep` (which reserves page space for the
 * leaf), and the 3D leaf — which picked its side at RUNTIME from where the
 * walkthrough figure was standing, so the same saved plan rendered with the
 * door swinging either way depending on how you walked up to it. Three of the
 * four were kept in step by comments; the fourth was not in step at all.
 *
 * A pure function is only a single source of truth if the call sites call it,
 * which no type can enforce — `doorSwing.test.ts` greps the tree for that,
 * the pattern `calibration.test.ts` established.
 *
 * ── The fallback is load-bearing ──
 * An `Opening` with no `swing` gets `DEFAULT_SWING`, which IS the pre-v4
 * convention. So a v3 fixture, a hand-edited file, or a malformed swing the
 * parser dropped all still draw, and draw exactly what they always drew.
 * Without it, `parseSwing` dropping a bad field would cost the user a door.
 */
export function doorSwing(wall: Wall, opening: Opening): DoorSwing {
  const { length, ux, uz } = wallAxis(wall)
  const { hand, side } = opening.swing ?? DEFAULT_SWING

  // Clamped the same way `wallPieces` clamps its holes, so a hinge can never
  // sit off the end of the wall it belongs to.
  const half = opening.width / 2
  const t0 = Math.max(0, opening.position - half)
  const t1 = Math.min(length, opening.position + half)

  const atStart = hand === 'start'
  // +1 when the leaf runs with the wall, -1 when it runs back along it.
  const handSign = atStart ? 1 : -1
  const axis = { x: ux * handSign, z: uz * handSign }

  return {
    hinge: pointAlongWall(wall, atStart ? t0 : t1),
    free: pointAlongWall(wall, atStart ? t1 : t0),
    axis,
    // `side` names a side of the WALL, so it must not move when the leaf is
    // rehung on the other jamb — and the perpendicular of a reversed axis
    // points the other way, so the hand's sign has to cancel back out here.
    sweep: ((side === 'left' ? 1 : -1) * handSign) as 1 | -1,
    rotationY: Math.atan2(-axis.z, axis.x),
  }
}

/** The unit world direction a door's free edge sweeps toward as it opens. */
export const swingDirection = (swing: DoorSwing) => ({
  x: swing.axis.z * swing.sweep,
  z: -swing.axis.x * swing.sweep,
})

export type WallPiece = {
  key: string
  position: [number, number, number]
  rotationY: number
  scale: [number, number, number]
}

/**
 * Decomposes a wall into the solid boxes left over once its openings are
 * removed: full-height runs between openings, plus the sill below and lintel
 * above each one.
 *
 * This is deliberately not a CSG subtraction. Walls are axis-aligned boxes with
 * rectangular holes, so slicing the span into boxes gives the same result with
 * no boolean-mesh dependency, and every piece stays a clean, cheap geometry.
 */
export function wallPieces(wall: Wall): WallPiece[] {
  const { length, ux, uz, rotationY } = wallAxis(wall)
  if (length <= EPSILON) return []

  const pieces: WallPiece[] = []

  const push = (t0: number, t1: number, y0: number, y1: number, key: string) => {
    const span = t1 - t0
    const rise = y1 - y0
    if (span <= EPSILON || rise <= EPSILON) return

    const mid = (t0 + t1) / 2
    pieces.push({
      key,
      position: [
        wall.start.x + ux * mid,
        SLAB.top + (y0 + y1) / 2,
        wall.start.z + uz * mid,
      ],
      rotationY,
      scale: [span, rise, wall.thickness],
    })
  }

  const spans = wall.openings
    .map((o) => ({
      opening: o,
      t0: Math.max(0, o.position - o.width / 2),
      t1: Math.min(length, o.position + o.width / 2),
    }))
    .filter((s) => s.t1 - s.t0 > EPSILON)
    .sort((a, b) => a.t0 - b.t0)

  let cursor = 0

  for (const { opening, t0, t1 } of spans) {
    // Overlapping openings would make the run before this one negative-length.
    // Skipping the overlap keeps the wall solid rather than emitting garbage.
    if (t0 < cursor - EPSILON) continue

    push(cursor, t0, 0, wall.height, `run-${cursor.toFixed(4)}`)

    const sill = Math.min(Math.max(opening.sill, 0), wall.height)
    const head = Math.min(sill + opening.height, wall.height)

    // Below a window; a door has sill 0 and so gets nothing here.
    push(t0, t1, 0, sill, `sill-${opening.id}`)
    // The lintel above, unless the opening reaches the top of the wall.
    push(t0, t1, head, wall.height, `head-${opening.id}`)

    cursor = t1
  }

  push(cursor, length, 0, wall.height, `run-${cursor.toFixed(4)}`)

  return pieces
}

/**
 * The centre of an opening in world space, at its mid-height.
 * Used to draw and hit-test openings.
 */
export function openingCenter(wall: Wall, opening: Opening) {
  const flat = pointAlongWall(wall, opening.position)
  return {
    ...flat,
    y: SLAB.top + opening.sill + opening.height / 2,
  }
}

export type OpeningBox = {
  openingId: string
  position: [number, number, number]
  rotationY: number
  scale: [number, number, number]
}

/**
 * The box that fills each opening's void — the same slot `wallPieces` cuts out,
 * so it sits exactly in the gap. Rendered invisible, it is the click target
 * that makes a door or window selectable in 3D; `wallPieces` leaves nothing
 * there to click otherwise. Made a little thicker than the wall so it protrudes
 * past both faces and is easy to hit from inside or out.
 */
export function openingBoxes(wall: Wall): OpeningBox[] {
  const { length, ux, uz, rotationY } = wallAxis(wall)
  if (length <= EPSILON) return []

  const boxes: OpeningBox[] = []
  for (const opening of wall.openings) {
    const t0 = Math.max(0, opening.position - opening.width / 2)
    const t1 = Math.min(length, opening.position + opening.width / 2)
    const span = t1 - t0
    if (span <= EPSILON) continue

    const sill = Math.min(Math.max(opening.sill, 0), wall.height)
    const head = Math.min(sill + opening.height, wall.height)
    const rise = head - sill
    if (rise <= EPSILON) continue

    const mid = (t0 + t1) / 2
    boxes.push({
      openingId: opening.id,
      position: [
        wall.start.x + ux * mid,
        SLAB.top + (sill + head) / 2,
        wall.start.z + uz * mid,
      ],
      rotationY,
      scale: [span, rise, wall.thickness + 0.1],
    })
  }
  return boxes
}

export type Projection = {
  /** Distance along the wall from start, clamped to the wall. */
  t: number
  /** Perpendicular distance from the point to the wall's centreline. */
  distance: number
  length: number
}

/** Projects a floor-plane point onto a wall's centreline. */
export function projectOntoWall(wall: Wall, point: Point): Projection {
  const dx = wall.end.x - wall.start.x
  const dz = wall.end.z - wall.start.z
  const lengthSq = dx * dx + dz * dz

  if (lengthSq === 0) {
    return {
      t: 0,
      distance: Math.hypot(point.x - wall.start.x, point.z - wall.start.z),
      length: 0,
    }
  }

  const raw =
    ((point.x - wall.start.x) * dx + (point.z - wall.start.z) * dz) / lengthSq
  const clamped = Math.min(1, Math.max(0, raw))
  const closest = {
    x: wall.start.x + dx * clamped,
    z: wall.start.z + dz * clamped,
  }

  return {
    t: clamped * Math.sqrt(lengthSq),
    distance: Math.hypot(point.x - closest.x, point.z - closest.z),
    length: Math.sqrt(lengthSq),
  }
}

/** The wall nearest `point`, or null if none lies within `tolerance` metres. */
export function pickWall(
  walls: Wall[],
  point: Point,
  tolerance: number,
): { wall: Wall; projection: Projection } | null {
  let best: { wall: Wall; projection: Projection } | null = null

  for (const wall of walls) {
    const projection = projectOntoWall(wall, point)
    // Clicks land on the wall's face, not its centreline, so admit half the
    // thickness on top of the tolerance.
    const reach = tolerance + wall.thickness / 2
    if (projection.distance > reach) continue
    if (!best || projection.distance < best.projection.distance) {
      best = { wall, projection }
    }
  }

  return best
}

/** The opening nearest `point`, searched across every wall. */
export function pickOpening(
  walls: Wall[],
  point: Point,
  tolerance: number,
): { wall: Wall; opening: Opening } | null {
  let best: { wall: Wall; opening: Opening; distance: number } | null = null

  for (const wall of walls) {
    for (const opening of wall.openings) {
      const centre = pointAlongWall(wall, opening.position)
      const distance = Math.hypot(point.x - centre.x, point.z - centre.z)
      // Anywhere along the opening's own width counts as a hit.
      if (distance > tolerance + opening.width / 2) continue
      if (!best || distance < best.distance) best = { wall, opening, distance }
    }
  }

  return best && { wall: best.wall, opening: best.opening }
}

/**
 * The furniture item under `point`, tested against its rotated footprint.
 *
 * Later items win, matching draw order — the piece you see on top is the piece
 * you select when two overlap.
 */
export function pickFurniture(
  items: FurnitureItem[],
  point: Point,
): FurnitureItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    // The item's actual footprint, so a resized piece stays clickable over its
    // whole extent rather than just the catalogue default.
    const size = furnitureSize(item)

    // Rotate the point into the item's local frame, then it's a plain
    // axis-aligned box test.
    const dx = point.x - item.position.x
    const dz = point.z - item.position.z
    const cos = Math.cos(-item.rotation)
    const sin = Math.sin(-item.rotation)
    const localX = dx * cos - dz * sin
    const localZ = dx * sin + dz * cos

    if (
      Math.abs(localX) <= size.width / 2 &&
      Math.abs(localZ) <= size.depth / 2
    ) {
      return item
    }
  }
  return null
}

export type PlanBounds = {
  min: Point
  max: Point
  center: Point
  width: number
  depth: number
}

/** Axis-aligned extents of every wall endpoint, or null when there are none. */
export function planBounds(walls: Wall[]): PlanBounds | null {
  if (walls.length === 0) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const wall of walls) {
    for (const p of [wall.start, wall.end]) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minZ = Math.min(minZ, p.z)
      maxZ = Math.max(maxZ, p.z)
    }
  }

  return {
    min: { x: minX, z: minZ },
    max: { x: maxX, z: maxZ },
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    width: maxX - minX,
    depth: maxZ - minZ,
  }
}
