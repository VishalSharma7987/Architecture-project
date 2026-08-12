/**
 * How big the building actually is, against how big it was meant to be.
 *
 * ── The finding this closes ──
 * The reference plan was drawn by hand at 20.5 × 14.5 m against a 9.00 × 11.00
 * target — 299.7 m² against 99 m², every room correct in proportion and three
 * times too big. The status bar was reporting 299.7 m² the whole time and it
 * was useless, because **nothing in the app knew what the user was aiming at**.
 *
 * Every readout in the editor is an ABSOLUTE statement, and a 3× error is only
 * visible as a RATIO. This module is the ratio.
 *
 * Typed length (B29) does not cover this and was never going to: it is
 * per-segment, and the reference plan is sixteen walls. One is a drafting
 * tool, the other is a design constraint.
 *
 * Pure — no store, no canvas, no React.
 */
import type { Point, Unit, Wall } from '../store/useDesignStore'
import { formatLength } from '../units/length'

export type Extent = { width: number; depth: number }

/**
 * The building's bounding extent from its wall CENTRELINES.
 *
 * Centrelines, not finished faces, because that is what every other measure in
 * this project already uses — `totalFloorArea` says so out loud in the status
 * bar's tooltip. Mixing conventions inside one readout would make the
 * deviation partly an artefact of which measure each half used.
 */
export function extentOf(walls: Wall[]): Extent | null {
  if (walls.length === 0) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const wall of walls) {
    for (const p of [wall.start, wall.end] as Point[]) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.z < minZ) minZ = p.z
      if (p.z > maxZ) maxZ = p.z
    }
  }
  const width = maxX - minX
  const depth = maxZ - minZ
  return width > 0 || depth > 0 ? { width, depth } : null
}

/**
 * How far off target the plan is, as a factor on AREA.
 *
 * Area rather than either axis alone, because that is the number the error
 * shows up in: a plan 3× too big on both axes is 9× the area, and reporting
 * "3.0× on width" would understate it while "9.0× on area" overstates how
 * wrong each wall is. The factor below is the geometric mean of the two axis
 * factors — the number you would multiply every wall by to land on target,
 * which is exactly the correction a user has to make.
 */
export type Deviation = {
  actual: Extent
  target: Extent
  /** Multiply every dimension by this to reach the target. */
  factor: number
  over: boolean
  /** Inside the measurement convention's own ambiguity — say nothing. */
  onTarget: boolean
}

/**
 * Below this the deviation is not worth reporting.
 *
 * Derived, not picked: the editor measures to wall CENTRELINES, and a 230 mm
 * shell on a 9 m building puts the centreline extent 2.6% above the extent a
 * user would measure across finished faces. A tolerance under that would fire
 * on the difference between two equally correct ways of measuring the same
 * building. 3% clears it with nothing to spare.
 */
export const ON_TARGET_TOLERANCE = 0.03

export function deviationFrom(actual: Extent, target: Extent): Deviation | null {
  if (target.width <= 0 || target.depth <= 0) return null

  const factor = Math.sqrt(
    (actual.width / target.width) * (actual.depth / target.depth),
  )
  if (!Number.isFinite(factor) || factor <= 0) return null

  return {
    actual,
    target,
    factor,
    over: factor > 1,
    onTarget: Math.abs(factor - 1) <= ON_TARGET_TOLERANCE,
  }
}

/**
 * The deviation as a phrase.
 *
 * ── Ratio or percentage: BOTH, chosen by size ──
 * Neither form is legible across the whole range. "3.0× over" is instantly
 * readable where "200% over" makes the reader do arithmetic; "8% over" is
 * readable where "1.08×" reads as noise. So the crossover is where they swap
 * legibility, at half again: at or beyond 1.5× (and at or below its
 * reciprocal) a factor is clearer, and inside that band a percentage is.
 *
 * This is the difference between a readout that names the 3× error and one
 * that technically contains it.
 */
export const FACTOR_THRESHOLD = 1.5

export function describeDeviation(deviation: Deviation): string {
  if (deviation.onTarget) return 'on target'

  const { factor, over } = deviation
  const big = factor >= FACTOR_THRESHOLD || factor <= 1 / FACTOR_THRESHOLD

  if (big) {
    // Over reads as "3.0x over"; under as "2.0x under", not "0.5x over" —
    // the reader wants the size of the mistake, not a fraction to invert.
    const shown = over ? factor : 1 / factor
    return `${shown.toFixed(1)}× ${over ? 'over' : 'under'}`
  }

  const percent = Math.round(Math.abs(factor - 1) * 100)
  return `${percent}% ${over ? 'over' : 'under'}`
}

/** `20.5 × 14.5 m`, in the user's unit. */
export const formatExtent = (extent: Extent, units: Unit): string =>
  `${formatLength(extent.width, units)} × ${formatLength(extent.depth, units)}`
