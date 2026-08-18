/**
 * Dimension chains — the strung station runs a working drawing carries outside
 * the building, and the one ink routine that draws any dimension run.
 *
 * ── The finding this closes ──
 * The reference plan strings dimensions OUTSIDE the building: 3.00/3.00/3.00
 * across the top, 3.00/1.50/3.00/1.50 across the bottom, plus an overall per
 * axis. The canvas had neither: `draw.ts` labels every wall individually,
 * offset outward from the PLAN CENTRE, so interior partitions throw their
 * labels inside the building — and the "overall" a rectangle appears to carry
 * is just the north and south walls' own labels, correct by coincidence.
 *
 * ── What is shared, and with whom (B26's pattern) ──
 * `planSheet.ts`'s `drawDimensions` was already the correct model: witness
 * lines, surveyor ticks, and a line set out beyond whichever is further — the
 * building, or a door swinging off it. Per B26, that implementation is
 * PROMOTED here rather than written a second time:
 *
 *   - `clearanceExtent` (was the sheet's `fitExtent`) — everything a dimension
 *     line must clear, in world metres.
 *   - `strokeRunInk` — the ink: main line, witness/tick segments, labels. It
 *     takes coordinates already projected, because the sheet and the canvas
 *     project differently (`toSheet` vs `worldToScreen`) and any pixel value
 *     computed in one is meaningless in the other. The sheet's output is
 *     pinned call-for-call by `wallBody.test.tsx`'s golden, so this function
 *     must emit EXACTLY the call sequence the sheet always has.
 *   - `dimensionRuns` — the geometry that is new in B33: which stations exist
 *     on which side of the building, in world metres.
 *
 * ── Stations are DERIVED, not stored ──
 * The reference's chains are readable straight off the geometry: an interior
 * partition that reaches a side of the building divides that side's chain.
 * No `Dimension` entity is added to the model — that is §6 v6 (user-placed
 * dimensions), and it is not needed to reproduce the reference. A wall is the
 * authority for where it stands; the chain only reads it.
 *
 * ── Centrelines, not faces ──
 * Stations sit on wall CENTRELINES, for the same reason `extentOf` measures
 * them: every number this editor states — areas, the B31 target extent, the
 * status bar — is centreline-measured, and the chain must SUM. Stations at
 * 0/3/6/9 read 3.00 + 3.00 + 3.00 = 9.00, which is the overall, which is what
 * the user typed as the target. Face stations cannot sum to any overall
 * without inserting each wall thickness as its own chain segment — that is
 * real face dimensioning, and it arrives with composite walls and wall-face
 * snap (Stage 3, finding 24), not before. Note the reference's own arithmetic
 * agrees: its 3.00/3.00/3.00 strings sum to its stated 9.00 only centre to
 * centre.
 */
import type { FurnitureItem, Opening, Point, Wall } from '../store/useDesignStore'
import { furnitureSize } from '../furniture/catalog'
import { doorSwing, planBounds, type PlanBounds } from '../scene/wallGeometry'
import { JOIN_TOLERANCE } from '../units/tolerance'

/* ─── clearance: what a dimension line must be set out beyond ────────────── */

/**
 * Points the door leaf sweeps through, so the page fit and the dimension
 * setout stay clear of a door swinging off the building.
 *
 * Promoted verbatim from `planSheet.ts` (B33): the canvas chains need the same
 * clearance the sheet's overall already respected, and two sweep
 * implementations would be the drift finding 20b was about. This and the arc
 * in `drawOpeningSymbol` share `doorSwing`, so the model keeps them in step
 * and `doorSwing.test.ts` fails the build if either stops asking.
 */
export function doorSweep(wall: Wall, opening: Opening): Point[] {
  const swing = doorSwing(wall, opening)
  const steps = 6
  const points: Point[] = []

  for (let i = 0; i <= steps; i++) {
    const angle = (Math.PI / 2) * (i / steps)
    const cos = Math.cos(angle)
    // The sign is what turns the leaf onto the side the model asked for.
    const sin = Math.sin(angle) * swing.sweep
    points.push({
      x: swing.hinge.x + (swing.axis.x * cos + swing.axis.z * sin) * opening.width,
      z: swing.hinge.z + (swing.axis.z * cos - swing.axis.x * sin) * opening.width,
    })
  }

  return points
}

/**
 * Everything annotation must clear: wall faces (not centrelines), door
 * sweeps, and furniture footprints. Was the sheet's `fitExtent`, where it
 * decided the page fit and the overall dimension setout; the canvas chains
 * now share it for the same second purpose.
 */
export function clearanceExtent(
  walls: Wall[],
  furniture: FurnitureItem[],
): PlanBounds | null {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  const expand = (p: Point, reach: number) => {
    minX = Math.min(minX, p.x - reach)
    maxX = Math.max(maxX, p.x + reach)
    minZ = Math.min(minZ, p.z - reach)
    maxZ = Math.max(maxZ, p.z + reach)
  }

  for (const wall of walls) {
    for (const p of [wall.start, wall.end]) expand(p, wall.thickness / 2)
    for (const opening of wall.openings) {
      if (opening.type !== 'door') continue
      // A leaf swings a full door-width clear of the wall, so a door on the
      // outer face of the plan is what actually sets the extent there.
      for (const p of doorSweep(wall, opening)) expand(p, 0)
    }
  }

  for (const item of furniture) {
    const size = furnitureSize(item)
    // Half-diagonal covers the footprint at any rotation without trigonometry.
    expand(item.position, Math.hypot(size.width, size.depth) / 2)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return null

  return {
    min: { x: minX, z: minZ },
    max: { x: maxX, z: maxZ },
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    width: maxX - minX,
    depth: maxZ - minZ,
  }
}

/* ─── the runs: which stations exist on which side ───────────────────────── */

/**
 * One dimension run: a line measuring along `axis`, set out on one side of
 * the building.
 *
 * For `axis: 'x'` the run is horizontal and `side` names a z-edge — `'min'`
 * is the top of the plan (world −z), `'max'` the bottom. For `axis: 'z'` the
 * run is vertical and `side` names an x-edge — `'min'` is the left.
 */
export type DimensionRun = {
  axis: 'x' | 'z'
  side: 'min' | 'max'
  kind: 'overall' | 'chain'
  /** Station coordinates along `axis`, sorted ascending, both ends included. */
  stations: number[]
}

/**
 * A wall counts as perpendicular to an axis only when its run across that
 * axis stays inside `vertexKey`'s millimetre — the plans this reproduces are
 * orthogonal, and an oblique wall has no single station coordinate to give.
 */
const PERP_TOL = 0.001

/**
 * The strung chains and the overalls the current walls determine.
 *
 * A side gets a chain only when at least one interior partition reaches it —
 * a chain with no interior stations would restate the overall. The overalls
 * go one per axis, on the bottom and the left, which is where the sheet has
 * always drawn its two. Order is fixed (chains by axis and side, then
 * overalls) so two identical plans paint identical runs (L6).
 */
export function dimensionRuns(walls: Wall[]): DimensionRun[] {
  const bounds = planBounds(walls)
  if (!bounds) return []

  /**
   * How far short of the building edge a wall may stop and still count as
   * reaching it. Half the thickest wall covers a stem drawn to the shell's
   * visible FACE rather than its centreline — which is what a user aiming at
   * the drawn edge produces, and which reads as joined on screen (B26). The
   * join guard absorbs float noise on top.
   */
  const maxThickness = walls.reduce((m, w) => Math.max(m, w.thickness), 0)
  const touchReach = maxThickness / 2 + JOIN_TOLERANCE

  const runs: DimensionRun[] = []

  for (const axis of ['x', 'z'] as const) {
    const along = (p: Point) => (axis === 'x' ? p.x : p.z)
    const across = (p: Point) => (axis === 'x' ? p.z : p.x)
    const lo = axis === 'x' ? bounds.min.x : bounds.min.z
    const hi = axis === 'x' ? bounds.max.x : bounds.max.z
    const crossLo = axis === 'x' ? bounds.min.z : bounds.min.x
    const crossHi = axis === 'x' ? bounds.max.z : bounds.max.x

    const interior: Record<'min' | 'max', number[]> = { min: [], max: [] }

    for (const wall of walls) {
      // Perpendicular to this axis: constant along it, running across it.
      if (Math.abs(along(wall.start) - along(wall.end)) > PERP_TOL) continue
      if (Math.abs(across(wall.start) - across(wall.end)) <= PERP_TOL) continue

      const station = (along(wall.start) + along(wall.end)) / 2
      // A station on the chain's own end is the end, not a division of it.
      if (station <= lo + JOIN_TOLERANCE || station >= hi - JOIN_TOLERANCE) {
        continue
      }

      const near = Math.min(across(wall.start), across(wall.end))
      const far = Math.max(across(wall.start), across(wall.end))
      if (near <= crossLo + touchReach) interior.min.push(station)
      if (far >= crossHi - touchReach) interior.max.push(station)
    }

    for (const side of ['min', 'max'] as const) {
      const stations = dedupeStations(interior[side])
      if (stations.length === 0) continue
      runs.push({ axis, side, kind: 'chain', stations: [lo, ...stations, hi] })
    }
  }

  // Overalls last, so a renderer stacking runs by order paints them outermost.
  // Bottom and left, the sheet's own two sides.
  if (bounds.width > PERP_TOL) {
    runs.push({
      axis: 'x',
      side: 'max',
      kind: 'overall',
      stations: [bounds.min.x, bounds.max.x],
    })
  }
  if (bounds.depth > PERP_TOL) {
    runs.push({
      axis: 'z',
      side: 'min',
      kind: 'overall',
      stations: [bounds.min.z, bounds.max.z],
    })
  }

  return runs
}

/**
 * Sorted stations with near-coincident ones merged — two collinear wall
 * segments dividing the same side must yield ONE station, not a zero-width
 * bay. The first of a merged group speaks for it, which keeps the result a
 * real coordinate rather than an average that exists on no wall.
 */
function dedupeStations(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > JOIN_TOLERANCE) out.push(v)
  }
  return out
}

/* ─── the ink: one implementation for every dimension run ────────────────── */

export type InkPoint = { x: number; y: number }

/**
 * A dimension run ready to stroke, in the CALLER's projected pixels.
 *
 * `segments` carries the witness lines and ticks in draw order; a label with
 * an `angle` is drawn through translate/rotate (the sheet's left run), one
 * without is drawn in place (the sheet's bottom run). `baseline` lets a run on
 * the right of a plan sit its rotated text outside the line; the sheet never
 * passes it, so its calls are unchanged.
 */
export type RunInk = {
  a: InkPoint
  b: InkPoint
  segments: Array<{ from: InkPoint; to: InkPoint }>
  labels: Array<{
    text: string
    x: number
    y: number
    angle?: number
    baseline?: 'bottom' | 'top'
  }>
}

/**
 * Strokes one dimension run: main line, witness/tick segments, labels.
 *
 * Styles (stroke, fill, font, line width) are the CALLER's, set before the
 * call — the sheet quotes its weights in sheet units and the canvas in screen
 * pixels, and neither set of numbers belongs here.
 *
 * The call sequence is load-bearing: `wallBody.test.tsx` pins the sheet's
 * whole output call-for-call against a golden captured before B26, so this
 * must emit exactly what the sheet's inline code emitted — main line first,
 * then the segments in order, one stroke, then each label.
 */
export function strokeRunInk(ctx: CanvasRenderingContext2D, ink: RunInk): void {
  ctx.beginPath()
  ctx.moveTo(ink.a.x, ink.a.y)
  ctx.lineTo(ink.b.x, ink.b.y)
  for (const s of ink.segments) {
    ctx.moveTo(s.from.x, s.from.y)
    ctx.lineTo(s.to.x, s.to.y)
  }
  ctx.stroke()

  for (const label of ink.labels) {
    if (label.angle === undefined) {
      ctx.textAlign = 'center'
      ctx.textBaseline = label.baseline ?? 'bottom'
      ctx.fillText(label.text, label.x, label.y)
    } else {
      ctx.save()
      ctx.translate(label.x, label.y)
      ctx.rotate(label.angle)
      ctx.textAlign = 'center'
      ctx.textBaseline = label.baseline ?? 'bottom'
      ctx.fillText(label.text, 0, 0)
      ctx.restore()
    }
  }
}
