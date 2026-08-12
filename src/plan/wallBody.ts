/**
 * The wall as a body with real faces — the one implementation, in world
 * coordinates, for every renderer that draws a plan.
 *
 * ── Why this module exists ──
 * STATE.md's three-renderer finding: `plan/draw.ts`, `plan/planSheet.ts` and
 * `scene/*` drifted to three fidelity levels with no shared code. The canvas
 * stroked a butt-capped centreline and hid the corner overlap under a 2.5 px
 * vertex dot; the sheet filled a mitred poché quad with real faces. The user
 * saw the WORST of the three while drawing and the BEST only after exporting a
 * PDF.
 *
 * Nothing here is new. Every line of it came out of `planSheet.ts`, where it
 * had been correct in production for months. B26 is promotion, not invention.
 *
 * ── The contract: WORLD coordinates ──
 * Everything returns metres in world space, and each renderer applies its own
 * projection — `toSheet` for the sheet, `worldToScreen` for the canvas. That is
 * what makes one implementation possible at all: the two projections differ in
 * scale, origin and sign conventions, and any geometry expressed in either
 * one's pixels cannot be shared with the other.
 *
 * It is also what would let `scene/*` consume this. A wall body is a footprint
 * polygon; an extrusion of that footprint is a wall solid. See the B26 report
 * and STATE.md finding 43 — argued, not built.
 *
 * ── What this does NOT do: T-junctions ──
 * `vertexKey` is exact-coordinate matching. A wall ending mid-span of another
 * shares no vertex, so it gets no pad and leaves the notch this module exists
 * to close. That is genuinely new geometry — 3-way and 4-way meetings, and
 * oblique angles where a square pad leaves a notch of its own — and it is its
 * own session. The limitation is inherited from the sheet, where it has always
 * been present; B26 neither fixes nor worsens it.
 */
import type { Opening, Point, Wall } from '../store/useDesignStore'
import { pointAlongWall, wallAxis } from '../scene/wallGeometry'

/** A wall body, in world metres. Corners run left face, then right, closing. */
export type Quad = readonly [Point, Point, Point, Point]

/**
 * Endpoint identity to the millimetre.
 *
 * Exact-coordinate matching, so this answers "do these two walls END at the
 * same place", never "do they touch". `plan/repairJoints.ts` owns the second
 * question and works to different tolerances for different reasons.
 */
export const vertexKey = (p: Point) =>
  `${Math.round(p.x * 1000)}:${Math.round(p.z * 1000)}`

/**
 * Endpoints shared by more than one wall. Bodies are mitred out to half their
 * thickness there, which fills the square notch two butting walls would
 * otherwise leave at a corner — without lengthening free-standing ends.
 */
export function sharedEnds(walls: Wall[]): Set<string> {
  const counts = new Map<string, number>()
  for (const wall of walls) {
    for (const p of [wall.start, wall.end]) {
      const key = vertexKey(p)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const shared = new Set<string>()
  for (const [key, count] of counts) if (count > 1) shared.add(key)
  return shared
}

/**
 * The wall as a solid poché body carrying its real thickness, padded at every
 * shared end.
 *
 * Null for a zero-length wall rather than a degenerate quad — a renderer that
 * filled one would emit an invisible path and a reader would wonder why.
 *
 * The pad is what closes an L. Two 200 mm walls butting at a corner leave a
 * 100 x 100 mm square of paper between their faces; extending each by half its
 * own thickness fills exactly that square. It is (t/2)^2 of missing wall per
 * corner, not t^2 — measured at 10,000 mm^2 for a 200 mm wall.
 */
export function wallBodyQuad(wall: Wall, shared: Set<string>): Quad | null {
  const { length, ux, uz } = wallAxis(wall)
  if (length <= 0) return null

  const half = wall.thickness / 2
  const startPad = shared.has(vertexKey(wall.start)) ? half : 0
  const endPad = shared.has(vertexKey(wall.end)) ? half : 0
  const a = pointAlongWall(wall, -startPad)
  const b = pointAlongWall(wall, length + endPad)
  // Left-hand normal of the wall direction.
  const nx = -uz * half
  const nz = ux * half

  return [
    { x: a.x + nx, z: a.z + nz },
    { x: b.x + nx, z: b.z + nz },
    { x: b.x - nx, z: b.z - nz },
    { x: a.x - nx, z: a.z - nz },
  ]
}

/** The two world points an opening spans, along its wall's centreline. */
export function openingSpan(wall: Wall, opening: Opening): [Point, Point] {
  const half = opening.width / 2
  return [
    pointAlongWall(wall, opening.position - half),
    pointAlongWall(wall, opening.position + half),
  ]
}

/**
 * How far in from the wall's centreline each glazing line sits, as a fraction
 * of half the wall thickness. 0.45 puts the pair comfortably inside the faces
 * rather than on them, which is what every reference drawing shows.
 */
export const GLAZING_INSET_RATIO = 0.45

/**
 * A window's two glazing lines, in world metres.
 *
 * The canvas drew ONE line down the middle of the opening until B26. Two lines
 * set in from the faces is the standard plan symbol, it is what the sheet has
 * always drawn, and it is the difference between a window reading as a window
 * and reading as a wall someone struck through.
 *
 * The offset direction is `(uz, -ux)` rather than the body's `(-uz, ux)`. The
 * two lines are emitted at +offset then -offset, so the PAIR is the same set
 * either way — but the ORDER is not, and the sheet's recorded output is pinned
 * to the millimetre by `wallBody.test.tsx`. This sign is the sheet's.
 */
export function glazingLines(
  wall: Wall,
  opening: Opening,
): [[Point, Point], [Point, Point]] {
  const [a, b] = openingSpan(wall, opening)
  const { ux, uz } = wallAxis(wall)
  const inset = (wall.thickness / 2) * GLAZING_INSET_RATIO
  const ox = uz * inset
  const oz = -ux * inset

  return [
    [
      { x: a.x + ox, z: a.z + oz },
      { x: b.x + ox, z: b.z + oz },
    ],
    [
      { x: a.x - ox, z: a.z - oz },
      { x: b.x - ox, z: b.z - oz },
    ],
  ]
}
