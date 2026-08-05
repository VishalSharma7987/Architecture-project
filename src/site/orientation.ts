import type { Facing, Point } from '../store/useDesignStore'

/**
 * Where the design sits in the real world.
 *
 * The plan has its own coordinates and never rotates. What rotates is North:
 * `northOffset` is the bearing of plan-up, in degrees clockwise, so a site whose
 * road runs north-east is drawn square on the page and the compass turns instead.
 * Every real-world question — which way a wall faces, which sector a room falls
 * in — resolves through here, which is what the Vastu work builds on next.
 *
 * Bearings follow the surveying convention: 0° is North, increasing clockwise,
 * so East is 90° and West is 270°.
 */

/** Folds any angle into [0, 360). */
export function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0
  return ((degrees % 360) + 360) % 360
}

export type FacingInfo = {
  id: Facing
  label: string
  /** Compass bearing of this direction, in degrees. */
  bearing: number
}

/** The eight plot facings, in compass order from North. */
export const FACINGS: FacingInfo[] = [
  { id: 'N', label: 'North', bearing: 0 },
  { id: 'NE', label: 'North-East', bearing: 45 },
  { id: 'E', label: 'East', bearing: 90 },
  { id: 'SE', label: 'South-East', bearing: 135 },
  { id: 'S', label: 'South', bearing: 180 },
  { id: 'SW', label: 'South-West', bearing: 225 },
  { id: 'W', label: 'West', bearing: 270 },
  { id: 'NW', label: 'North-West', bearing: 315 },
]

const BY_ID = new Map(FACINGS.map((f) => [f.id, f]))

export function getFacing(id: Facing): FacingInfo {
  // Falling back to North rather than throwing keeps a hand-edited file
  // renderable; the setting is a preference, not structural.
  return BY_ID.get(id) ?? FACINGS[0]
}

/**
 * The compass bearing of a direction on the plan.
 *
 * `dx`/`dz` are in world metres, where +x is to the right of the drawing and +z
 * is down it. With North up (`northOffset` 0), plan-up is 0° and +x is 90°.
 * Returns 0 for a zero-length direction, which has no bearing to report.
 */
export function bearingOf(dx: number, dz: number, northOffset: number): number {
  if (dx === 0 && dz === 0) return 0
  // atan2(dx, -dz) measures clockwise from plan-up, which is the compass
  // convention already; rotating North by `northOffset` shifts every reading
  // the other way, hence the subtraction.
  const fromPlanUp = (Math.atan2(dx, -dz) * 180) / Math.PI
  return normalizeDegrees(fromPlanUp - northOffset)
}

/** The bearing from one point to another. */
export function bearingBetween(
  from: Point,
  to: Point,
  northOffset: number,
): number {
  return bearingOf(to.x - from.x, to.z - from.z, northOffset)
}

/**
 * The eight-point sector a bearing falls in.
 *
 * Each sector spans 45°, centred on its own bearing — so North runs from 337.5°
 * round to 22.5°, not from 0° to 45°. Getting that wrong rotates every reading
 * by half a sector, which is invisible on a square plot and wrong on every
 * other one.
 */
export function sectorOf(bearing: number): Facing {
  const index = Math.round(normalizeDegrees(bearing) / 45) % 8
  return FACINGS[index].id
}

/** The sector a point falls in, seen from `origin` — usually the plan's centre. */
export function sectorOfPoint(
  origin: Point,
  point: Point,
  northOffset: number,
): Facing {
  return sectorOf(bearingBetween(origin, point, northOffset))
}

/**
 * The on-screen angle to draw the North needle at, in degrees clockwise from
 * straight up. This is `northOffset` itself — named so callers do not have to
 * reason about whether the compass or the world is turning.
 */
export function northScreenAngle(northOffset: number): number {
  return normalizeDegrees(northOffset)
}

/** A short reading for the UI, e.g. `North-East (45°)`. */
export function describeNorth(northOffset: number): string {
  const rounded = Math.round(normalizeDegrees(northOffset))
  return rounded === 0 ? 'North up' : `North ${rounded}° clockwise`
}

/**
 * Snaps a freely dragged angle to the nearest eight-point direction when it is
 * within `tolerance` degrees, so a compass drag settles on true North rather
 * than 359°. Anything further away is left exactly where the user put it.
 */
export function snapNorth(degrees: number, tolerance = 4): number {
  const value = normalizeDegrees(degrees)
  const nearest = Math.round(value / 45) * 45
  return Math.abs(value - nearest) <= tolerance ? normalizeDegrees(nearest) : value
}
