import type { Facing, Plot, Point, Wall } from '../store/useDesignStore'
import { getFacing, normalizeDegrees } from './orientation'

/**
 * Plot geometry: the boundary, the setbacks cut out of it, and whether the
 * building actually fits inside what is left.
 *
 * The plot is axis-aligned in world space and never rotates. North rotates
 * instead (see ./orientation), which keeps the drawing square on the page the
 * way a site plan is drawn — so everything here is plain rectangle arithmetic.
 */

/** An axis-aligned rectangle on the floor plane, in metres. */
export type Rect = {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/** Which edge of the drawing an edge of the plot is. */
export type PlanEdge = 'top' | 'right' | 'bottom' | 'left'

export const rectWidth = (r: Rect) => Math.max(0, r.maxX - r.minX)
export const rectDepth = (r: Rect) => Math.max(0, r.maxZ - r.minZ)
export const rectArea = (r: Rect) => rectWidth(r) * rectDepth(r)

export const rectCenter = (r: Rect): Point => ({
  x: (r.minX + r.maxX) / 2,
  z: (r.minZ + r.maxZ) / 2,
})

/** The plot boundary as a rectangle. */
export function plotRect(plot: Plot): Rect {
  return {
    minX: plot.origin.x,
    minZ: plot.origin.z,
    maxX: plot.origin.x + plot.width,
    maxZ: plot.origin.z + plot.depth,
  }
}

/**
 * Which edge of the drawing the plot's front is.
 *
 * The front is the side the plot faces, so it follows both `plotFacing` and the
 * north rotation: a north-facing plot drawn with North up has its front at the
 * top, and rotating North to point right swings the front to the right edge.
 * Tying it to the compass rather than pinning it to the bottom of the page is
 * what makes "front setback" mean the same thing as it does on a sanction plan.
 */
export function frontEdge(plotFacing: Facing, northOffset: number): PlanEdge {
  // A bearing is measured from North; the screen angle adds the north rotation
  // back to get an angle clockwise from the top of the drawing.
  const screenAngle = normalizeDegrees(
    getFacing(plotFacing).bearing + northOffset,
  )
  const quadrant = Math.round(screenAngle / 90) % 4
  return (['top', 'right', 'bottom', 'left'] as PlanEdge[])[quadrant]
}

/** The plan edge opposite `edge`. */
export const oppositeEdge = (edge: PlanEdge): PlanEdge =>
  edge === 'top'
    ? 'bottom'
    : edge === 'bottom'
      ? 'top'
      : edge === 'left'
        ? 'right'
        : 'left'

/**
 * Maps front/rear/left/right setbacks onto the four plan edges.
 *
 * Left and right are as seen standing at the front looking into the plot, which
 * is how a drawing is read and how the numbers arrive from a client. That means
 * they swap as the front moves around the plot — the alternative, pinning left
 * to the west of the page, quietly mislabels every plot that does not face the
 * top of the drawing.
 */
export function setbacksByEdge(
  plot: Plot,
  plotFacing: Facing,
  northOffset: number,
): Record<PlanEdge, number> {
  const front = frontEdge(plotFacing, northOffset)
  const rear = oppositeEdge(front)

  // Standing at the front edge looking into the plot: turning 90° anticlockwise
  // from that gaze gives the observer's left.
  const gaze: Record<PlanEdge, number> = { top: 0, right: 90, bottom: 180, left: 270 }
  const inward = normalizeDegrees(gaze[front] + 180)
  const leftEdgeAngle = normalizeDegrees(inward - 90)
  const rightEdgeAngle = normalizeDegrees(inward + 90)

  const edgeAt = (angle: number): PlanEdge =>
    (['top', 'right', 'bottom', 'left'] as PlanEdge[])[
      Math.round(normalizeDegrees(angle) / 90) % 4
    ]

  return {
    ...({ top: 0, right: 0, bottom: 0, left: 0 } as Record<PlanEdge, number>),
    [front]: plot.setbacks.front,
    [rear]: plot.setbacks.rear,
    [edgeAt(leftEdgeAngle)]: plot.setbacks.left,
    [edgeAt(rightEdgeAngle)]: plot.setbacks.right,
  }
}

/**
 * The area left to build on once the setbacks are taken off.
 *
 * Returns null when the setbacks meet or cross — there is genuinely nothing to
 * build on, and returning an inverted rectangle would have every downstream
 * check quietly measuring a negative box.
 */
export function buildableRect(
  plot: Plot,
  plotFacing: Facing,
  northOffset: number,
): Rect | null {
  const outer = plotRect(plot)
  const inset = setbacksByEdge(plot, plotFacing, northOffset)

  const rect: Rect = {
    minX: outer.minX + inset.left,
    maxX: outer.maxX - inset.right,
    minZ: outer.minZ + inset.top,
    maxZ: outer.maxZ - inset.bottom,
  }

  return rect.maxX - rect.minX <= 0 || rect.maxZ - rect.minZ <= 0 ? null : rect
}

/** How far outside `rect` a point lies, in metres. Zero when inside. */
export function outsideBy(rect: Rect, point: Point): number {
  const dx = Math.max(rect.minX - point.x, 0, point.x - rect.maxX)
  const dz = Math.max(rect.minZ - point.z, 0, point.z - rect.maxZ)
  return Math.hypot(dx, dz)
}

export type PlotViolation = {
  wallId: string
  /** Worst overhang beyond the buildable edge, in metres. */
  overhang: number
}

/**
 * Walls that stray outside the buildable area.
 *
 * A wall is measured by its outer face, not its centreline: a wall sitting
 * exactly on the setback line still has half its thickness over it, and that is
 * the half a sanction drawing would be rejected for.
 *
 * Only the endpoints are tested. For an axis-aligned rectangle that is exact —
 * a straight segment cannot leave a convex region without an endpoint being the
 * furthest point out.
 */
export function wallsOutsideBuildable(
  walls: Wall[],
  rect: Rect | null,
): PlotViolation[] {
  if (!rect) {
    // Nothing is buildable, so every wall is over the line.
    return walls.map((wall) => ({ wallId: wall.id, overhang: Infinity }))
  }

  const violations: PlotViolation[] = []

  for (const wall of walls) {
    const half = wall.thickness / 2
    const overhang = Math.max(
      outsideBy(rect, wall.start),
      outsideBy(rect, wall.end),
    )
    // Only count the thickness where the centreline is already out or on the
    // line; a wall well inside is not dragged over it by its own width.
    const worst = overhang > 0 ? overhang + half : 0
    if (worst > 1e-9) violations.push({ wallId: wall.id, overhang: worst })
  }

  return violations
}

/** Fits a plot around the walls already drawn, so the boundary lands sensibly. */
export function plotAround(
  bounds: { min: Point; max: Point } | null,
  width: number,
  depth: number,
): Point {
  if (!bounds) return { x: -width / 2, z: -depth / 2 }
  const cx = (bounds.min.x + bounds.max.x) / 2
  const cz = (bounds.min.z + bounds.max.z) / 2
  return { x: cx - width / 2, z: cz - depth / 2 }
}
