import type { Point, Wall } from '../store/useDesignStore'
import type { VastuZone } from './ruleset'
import { normalizeDegrees } from '../site/orientation'
import { planBounds } from '../scene/wallGeometry'

/**
 * The nine-zone grid (the Vastu Purusha Mandala, reduced to 3x3).
 *
 * The grid belongs to the COMPASS, not to the building: a plot turned 30° off
 * north still has its north-east corner in the real north-east. So the plan is
 * rotated by `-northOffset` about its own centre into a frame where North is
 * straight up, the bounding box is taken THERE, and the thirds of that box are
 * the zones. Taking the box first and rotating the labels afterwards would
 * shear the grid off the compass on every rotated plot — which is invisible on
 * a square plan and wrong on all the others.
 *
 * In the north-up frame the axes read the same way as the plan: +x is East and
 * +z is South.
 */

/** Zone of each cell, indexed `[row][col]` in the north-up frame. */
const ZONE_GRID: VastuZone[][] = [
  ['NW', 'N', 'NE'],
  ['W', 'C', 'E'],
  ['SW', 'S', 'SE'],
]

/** Slack for the bounds test, so a point on the outer edge still lands. */
const EDGE_TOLERANCE = 1e-9

export type ZoneCell = {
  zone: VastuZone
  /** Corners in WORLD space, ready to draw (rotated back). */
  polygon: Point[]
  /** Centre in world space, for the label. */
  center: Point
}

/** One cell of the grid as an axis-aligned rectangle in the north-up frame. */
export type ZoneRect = {
  zone: VastuZone
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * The grid in the north-up frame, plus the pivot needed to get back to world
 * space. Callers that measure — rather than draw — work here, because the cells
 * are axis-aligned rectangles in this frame and only in this frame.
 */
export type ZoneFrame = {
  /** Plan centre in world space; the rotation pivot for both directions. */
  pivot: Point
  /** Degrees the world is turned by to reach this frame's inverse. */
  northOffset: number
  /** The nine cells, row-major from North-West. */
  cells: ZoneRect[]
}

/**
 * Rotates a point about `pivot` by `degrees` clockwise as seen on the plan,
 * where +x is right and +z is down.
 */
export function rotateAbout(
  point: Point,
  pivot: Point,
  degrees: number,
): Point {
  const radians = (normalizeDegrees(degrees) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - pivot.x
  const dz = point.z - pivot.z

  return {
    x: pivot.x + cos * dx - sin * dz,
    z: pivot.z + sin * dx + cos * dz,
  }
}

/** World space to the north-up frame. */
export function toNorthUp(
  point: Point,
  pivot: Point,
  northOffset: number,
): Point {
  return rotateAbout(point, pivot, -northOffset)
}

/** The north-up frame back to world space, for drawing. */
export function fromNorthUp(
  point: Point,
  pivot: Point,
  northOffset: number,
): Point {
  return rotateAbout(point, pivot, northOffset)
}

/**
 * The nine cells as axis-aligned rectangles in the north-up frame.
 *
 * Null when there are no walls: there is no grid without a building, and a
 * zero-sized box would report every point as Centre.
 */
export function zoneFrame(
  walls: Wall[],
  northOffset: number,
): ZoneFrame | null {
  const bounds = planBounds(walls)
  if (!bounds) return null

  const pivot = bounds.center
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const wall of walls) {
    for (const end of [wall.start, wall.end]) {
      const p = toNorthUp(end, pivot, northOffset)
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minZ = Math.min(minZ, p.z)
      maxZ = Math.max(maxZ, p.z)
    }
  }

  const stepX = (maxX - minX) / 3
  const stepZ = (maxZ - minZ) / 3
  const cells: ZoneRect[] = []

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      cells.push({
        zone: ZONE_GRID[row][col],
        minX: minX + col * stepX,
        maxX: minX + (col + 1) * stepX,
        minZ: minZ + row * stepZ,
        maxZ: minZ + (row + 1) * stepZ,
      })
    }
  }

  return { pivot, northOffset, cells }
}

/**
 * The nine zones as world-space polygons, ready to draw over the plan.
 * Empty when there are no walls.
 */
export function vastuZones(walls: Wall[], northOffset: number): ZoneCell[] {
  const frame = zoneFrame(walls, northOffset)
  if (!frame) return []

  return frame.cells.map((cell) => ({
    zone: cell.zone,
    polygon: [
      { x: cell.minX, z: cell.minZ },
      { x: cell.maxX, z: cell.minZ },
      { x: cell.maxX, z: cell.maxZ },
      { x: cell.minX, z: cell.maxZ },
    ].map((p) => fromNorthUp(p, frame.pivot, frame.northOffset)),
    center: fromNorthUp(
      { x: (cell.minX + cell.maxX) / 2, z: (cell.minZ + cell.maxZ) / 2 },
      frame.pivot,
      frame.northOffset,
    ),
  }))
}

/**
 * Which zone a single world point falls in, or null when there is no grid or
 * the point sits outside it.
 */
export function zoneOfPoint(
  point: Point,
  walls: Wall[],
  northOffset: number,
): VastuZone | null {
  const frame = zoneFrame(walls, northOffset)
  if (!frame) return null
  return zoneOfFramePoint(toNorthUp(point, frame.pivot, northOffset), frame)
}

/** As `zoneOfPoint`, for a point already carried into the north-up frame. */
export function zoneOfFramePoint(
  point: Point,
  frame: ZoneFrame,
): VastuZone | null {
  const box = frame.cells
  const minX = box[0].minX
  const minZ = box[0].minZ
  const maxX = box[8].maxX
  const maxZ = box[8].maxZ

  if (point.x < minX - EDGE_TOLERANCE) return null
  if (point.x > maxX + EDGE_TOLERANCE) return null
  if (point.z < minZ - EDGE_TOLERANCE) return null
  if (point.z > maxZ + EDGE_TOLERANCE) return null

  const col = index(point.x, minX, maxX)
  const row = index(point.z, minZ, maxZ)
  return ZONE_GRID[row][col]
}

/** Which third of `min..max` a coordinate lands in, clamped to 0..2. */
function index(value: number, min: number, max: number): number {
  const span = max - min
  if (span <= 0) return 1
  const third = Math.floor(((value - min) / span) * 3)
  return Math.min(2, Math.max(0, third))
}
