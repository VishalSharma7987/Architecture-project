import type {
  Point,
  RoomId,
  RoomLabel,
  Selection,
  Wall,
} from '../store/useDesignStore'
import { detectRooms, detectRoomsUncached, roomCacheStats } from '../plan/rooms'

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
export function resolveRoomsUncached(
  walls: Wall[],
  labels: RoomLabel[],
): ResolvedRoom[] {
  return matchLabels(detectRoomsUncached(walls), labels)
}

/**
 * The label-matching half, over detection results someone else produced.
 *
 * Split out so the two entry points can reach DIFFERENT detection layers. This
 * is not a cosmetic seam — getting it wrong is silent both ways:
 *
 * - `resolveRoomsUncached` must reach `detectRoomsUncached`, or it is not
 *   uncached. It called the memoised `detectRooms` for one commit, and the
 *   benchmark duly reported resolve at 0.25 ms against detect at 19.8 ms for
 *   the same plan — a function timed as 80x faster than something it calls.
 * - `resolveRooms` must reach the memoised `detectRooms`, or naming a room —
 *   which replaces `roomLabels`, misses the resolve cache, and leaves `walls`
 *   alone — would redo the whole traversal. That is the entire point of keying
 *   on two levels instead of one.
 */
function matchLabels(
  detected: readonly { polygon: Point[]; area: number }[],
  labels: RoomLabel[],
): ResolvedRoom[] {
  const rooms: ResolvedRoom[] = detected.map((room) => ({
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

/**
 * Resolved rooms, keyed by the identity of BOTH inputs.
 *
 * Two levels rather than a composite key: the outer map is the walls, the inner
 * the labels. Naming a room replaces `roomLabels` but leaves `walls` alone, so
 * the resolve entry misses while the far more expensive detection underneath it
 * still hits its own cache in `plan/rooms.ts`.
 *
 * See that module for why array identity is a sound key, and for the caller
 * obligation that comes with a shared result.
 */
let resolveCache = new WeakMap<Wall[], WeakMap<RoomLabel[], ResolvedRoom[]>>()

/** Drops the resolve cache. `resetRoomCaches` in `plan/rooms.ts` calls this. */
export function resetResolveCache(): void {
  resolveCache = new WeakMap()
}

/**
 * Every enclosed space, with any name that belongs to it. Memoised.
 *
 * THE shared computation point B8 exists to create. Both viewports, all three
 * panels, the print sheet, the area statement and the blueprint's furniture
 * placement reach the same entry — so one edit costs one traversal rather than
 * one per mounted consumer.
 *
 * ⚠ The returned array is SHARED between every caller. Copy before sorting:
 * `Array.prototype.sort` mutates in place, and two call sites used to do
 * exactly that when each of them still owned its own array.
 */
export function resolveRooms(
  walls: Wall[],
  labels: RoomLabel[],
): ResolvedRoom[] {
  let byLabels = resolveCache.get(walls)
  if (byLabels) {
    const cached = byLabels.get(labels)
    if (cached) {
      roomCacheStats.resolveHits++
      return cached
    }
  } else {
    byLabels = new WeakMap()
    resolveCache.set(walls, byLabels)
  }

  roomCacheStats.resolveRuns++
  // `detectRooms`, not `detectRoomsUncached` — see `matchLabels`.
  const rooms = matchLabels(detectRooms(walls), labels)
  byLabels.set(labels, rooms)
  return rooms
}

/**
 * What clicking at `point` selects.
 *
 * Three outcomes, and each is a different kind of thing:
 *
 * - **a named zone** — the point is inside an enclosure that carries at least
 *   one name, so the NEAREST of that enclosure's anchors wins. Nearest, not
 *   primary: an open plan draws each zone's caption at its own anchor
 *   (`draw.ts`), so a click near "Dining" must select Dining. Selecting the
 *   primary regardless is precisely the bug this replaced.
 * - **an unnamed space** — inside an enclosure with no names. There is no id to
 *   carry yet, so the point rides along until the user names it.
 * - **nothing** — outside every enclosure.
 *
 * Deterministic on ties: equidistant anchors resolve to the earlier one in
 * `roomLabels`, which is append order, so the answer does not depend on how the
 * rooms happened to be traversed.
 */
export function roomSelectionAt(
  rooms: ResolvedRoom[],
  point: Point,
): Selection {
  const room = roomAtPoint(rooms, point)
  if (!room) return null

  const names = room.label ? [room.label, ...room.extraLabels] : []
  if (names.length === 0) return { kind: 'space', anchor: point }

  let nearest = names[0]
  let best = Infinity
  for (const label of names) {
    const distance = Math.hypot(
      label.anchor.x - point.x,
      label.anchor.z - point.z,
    )
    if (distance < best) {
      best = distance
      nearest = label
    }
  }

  return { kind: 'room', roomId: nearest.id }
}

/**
 * The enclosure a selection currently resolves to, or null.
 *
 * Null is a real state, not an error: a `roomId` whose walls have opened is a
 * DETACHED label, and every caller has to render that rather than crash. See
 * B7.2.
 */
export function selectedRoomOf(
  rooms: ResolvedRoom[],
  selection: Selection,
): ResolvedRoom | null {
  if (selection?.kind === 'space') return roomAtPoint(rooms, selection.anchor)
  if (selection?.kind !== 'room') return null
  return (
    rooms.find(
      (room) =>
        room.label?.id === selection.roomId ||
        room.extraLabels.some((extra) => extra.id === selection.roomId),
    ) ?? null
  )
}

/**
 * Names that no enclosure currently claims, in document order.
 *
 * A wall moved past an anchor, or a loop left open, leaves the label behind.
 * It is NOT deleted — the user typed it, and dropping user input because the
 * geometry moved would violate L2, with no confirmation and no undo step to
 * find it in (L4). So it stays in the document, is listed as detached, and
 * re-attaches by ordinary containment the moment the walls close around it
 * again.
 */
export function detachedLabels(
  rooms: ResolvedRoom[],
  labels: RoomLabel[],
): RoomLabel[] {
  const attached = new Set<RoomId>()
  for (const room of rooms) {
    if (room.label) attached.add(room.label.id)
    for (const extra of room.extraLabels) attached.add(extra.id)
  }
  return labels.filter((label) => !attached.has(label.id))
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
