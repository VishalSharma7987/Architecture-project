import type { Point, RoomLabel, Wall } from '../store/useDesignStore'
import { detectRooms } from '../plan/rooms'

/** A detected space, married to the name the user gave it. */
export type ResolvedRoom = {
  /** Closed ring of floor-plane points, on the wall centrelines. */
  polygon: Point[]
  /** Square metres, from the geometry. */
  area: number
  /** Where a label should sit — a point guaranteed INSIDE the polygon. */
  centroid: Point
  /** The user's name for this space, or null if it has not been named. */
  label: RoomLabel | null
  /**
   * Further names that also landed in this space, in `labels` order. An
   * open-plan zone — Family Room + Dining + Kitchen with no partitions —
   * encloses one polygon but carries several names; `label` owns its area and
   * these ride along, each shown by NAME ONLY at its own `anchor`. Empty for
   * the ordinary one-name room.
   */
  extraLabels: RoomLabel[]
}

/**
 * Every enclosed space, largest first, with any name that belongs to it.
 *
 * Names are matched by containment, not by identity: a `RoomLabel` holds the
 * point the user clicked, and it lands on whichever loop currently encloses
 * that point. Move a wall and the name follows its room and reports the new
 * area; move a wall past the anchor and the name simply stops resolving.
 *
 * When two labels fall inside one space — a deleted partition merging two
 * named rooms, or an open plan named zone by zone — the EARLIEST label in
 * `labels` becomes the room's `label` and owns its area; the rest follow in
 * `extraLabels`. `labels` is append-ordered, so the primary name is the one
 * that was there first: the merged room keeps reading as the room it already
 * was, rather than flipping to whatever was named last. Every name is kept, so
 * an open-plan area still shows all of its zones, each at its own anchor.
 */
export function resolveRooms(
  walls: Wall[],
  labels: RoomLabel[],
): ResolvedRoom[] {
  const rooms: ResolvedRoom[] = detectRooms(walls).map((room) => ({
    polygon: room.polygon,
    area: room.area,
    centroid: labelPoint(room.polygon),
    label: null,
    extraLabels: [],
  }))

  for (const label of labels) {
    const room = roomAtPoint(rooms, label.anchor)
    if (!room) continue
    if (room.label === null) room.label = label
    else room.extraLabels.push(label)
  }

  return rooms
}

/** The room containing a point, or null. Used for click-to-name. */
export function roomAtPoint(
  rooms: ResolvedRoom[],
  point: Point,
): ResolvedRoom | null {
  let found: ResolvedRoom | null = null

  // Smallest wins, so a click inside a room that some other loop also
  // encloses names the room the user actually pointed at.
  for (const room of rooms) {
    if (!containsPoint(room.polygon, point)) continue
    if (!found || room.area < found.area) found = room
  }

  return found
}

/** Total of every enclosed space, in square metres. */
export function totalBuiltUpArea(rooms: ResolvedRoom[]): number {
  return rooms.reduce((sum, room) => sum + room.area, 0)
}

/**
 * A room's overall footprint in plan orientation: its width across the page (X)
 * and its length down the page (Z), in metres — the same "width × length" a
 * blueprint writes inside each room (e.g. 9'-0" x 12'-0"). Not sorted by size:
 * width is always the horizontal extent and length the vertical one, so the two
 * numbers line up with how the plan is drawn, even when the room is deeper than
 * it is wide. For a rectangle it is exact; for an L or U it is the outer
 * envelope, which is still the size the room takes up.
 */
export function roomSize(polygon: Point[]): { width: number; length: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of polygon) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  return { width: maxX - minX, length: maxZ - minZ }
}

/**
 * Crossing-number point-in-polygon, correct for the L-shaped and U-shaped
 * rooms that a bounding box or a nearest-centroid test gets wrong.
 *
 * A point exactly on a shared wall centreline belongs to exactly one of the
 * two rooms, never both and never neither: the half-open comparisons below
 * award it to the room on the +x side of a vertical edge and the +z side of
 * a horizontal one. Which side it picks matters far less than the fact that
 * it always picks the same one — a label sitting on a wall must not flicker
 * between the rooms either side of it as the plan redraws.
 */
export function containsPoint(polygon: Point[], point: Point): boolean {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.z > point.z === b.z > point.z) continue
    const x = a.x + ((point.z - a.z) * (b.x - a.x)) / (b.z - a.z)
    if (point.x < x) inside = !inside
  }

  return inside
}

/**
 * A point inside the polygon, to hang the name and the area on.
 *
 * The area-weighted centroid is the right answer for the convex rooms that
 * make up most plans, but it falls outside an L — and a "Kitchen" caption
 * floating in the hallway makes the whole feature look broken. So it is
 * checked, and only trusted if it is genuinely inside.
 */
function labelPoint(polygon: Point[]): Point {
  const centroid = areaCentroid(polygon)
  if (centroid && containsPoint(polygon, centroid)) return centroid
  return widestChordMidpoint(polygon) ?? polygon[0]
}

/** Shoelace centroid. Null for a degenerate ring, which has no centre. */
function areaCentroid(polygon: Point[]): Point | null {
  let twiceArea = 0
  let x = 0
  let z = 0

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const cross = a.x * b.z - b.x * a.z
    twiceArea += cross
    x += (a.x + b.x) * cross
    z += (a.z + b.z) * cross
  }

  if (Math.abs(twiceArea) < 1e-9) return null
  return { x: x / (3 * twiceArea), z: z / (3 * twiceArea) }
}

/**
 * The midpoint of the longest horizontal span that lies inside the polygon —
 * a cheap stand-in for the pole of inaccessibility.
 *
 * Only the scanlines halfway between consecutive vertex heights are tested.
 * The widest part of a rectilinear room always falls on one of them, and
 * every plan drawn here is rectilinear or close to it, so this finds the
 * roomiest place to put the caption without an iterative search.
 */
function widestChordMidpoint(polygon: Point[]): Point | null {
  const heights = [...new Set(polygon.map((p) => p.z))].sort((a, b) => a - b)

  let best: Point | null = null
  let bestWidth = 0

  for (let i = 0; i + 1 < heights.length; i++) {
    const z = (heights[i] + heights[i + 1]) / 2
    const crossings = scanline(polygon, z)

    // Crossings pair up left-to-right, and every other gap is interior.
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const width = crossings[k + 1] - crossings[k]
      if (width <= bestWidth) continue
      bestWidth = width
      best = { x: (crossings[k] + crossings[k + 1]) / 2, z }
    }
  }

  return best
}

/** Where the horizontal line at `z` crosses the polygon, left to right. */
function scanline(polygon: Point[], z: number): number[] {
  const xs: number[] = []

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.z > z === b.z > z) continue
    xs.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z))
  }

  return xs.sort((m, n) => m - n)
}
