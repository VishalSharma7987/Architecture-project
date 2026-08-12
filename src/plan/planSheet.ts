import type {
  FurnitureItem,
  Opening,
  Point,
  RoomLabel,
  Unit,
  Wall,
} from '../store/useDesignStore'
import { furnitureSize } from '../furniture/catalog'
import { roomDisplayName } from '../rooms/catalog'
import { resolveRooms } from '../rooms/resolve'
import {
  doorSwing,
  planBounds,
  pointAlongWall,
} from '../scene/wallGeometry'
import { GLAZING_INSET_RATIO, sharedEnds, wallBodyQuad } from './wallBody'
import { formatArea, formatLength, METRES_PER_FOOT } from '../units/length'

/**
 * Presentation renderer: a design drawn as a printable floor-plan sheet.
 *
 * Deliberately separate from `plan/draw.ts`. That one serves the live editor —
 * grid, cursor, selection, draft lines — and none of it belongs on a drawing
 * handed to a builder. This module shares no state with the editor, so a sheet
 * renders the same whatever the user happens to have selected.
 */

/** Ink for paper. Flat, printable, and free of any UI colour. */
const INK = {
  paper: '#ffffff',
  frame: '#1f2933',
  wall: '#1f2933',
  symbol: '#1f2933',
  furniture: '#e5e8ec',
  furnitureEdge: '#a7aeb8',
  dimension: '#4b5563',
  text: '#111827',
  muted: '#6b7280',
}

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** A4 landscape at 150 dpi. Line weights are quoted against this sheet. */
const REFERENCE_HEIGHT = 1414

/**
 * CSS pixels per metre of paper at 96 dpi — the ratio the browser itself
 * assumes, and so the one that turns our pixels-per-metre into a drawing scale.
 */
const PX_PER_PAPER_METRE = 96 / 0.0254

/** Ratios an architect expects to read in a title block. */
const STANDARD_SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000]

/** Candidate divisions for the graphic scale bar, in metres. */
const SCALE_BAR_STEPS = [0.25, 0.5, 1, 2, 5, 10, 20]

/** Round imperial steps, in feet. */
const SCALE_BAR_STEPS_FT = [1, 2, 5, 10, 20, 50, 100]

const SHEET = {
  /** Outer margin, as a fraction of the sheet's shorter side. */
  margin: 0.035,
  /** Clear band around the plan, holding the dimension lines. */
  gutter: 0.052,
  /** Title block, as a fraction of the framed area. */
  titleWidth: 0.34,
  titleHeight: 0.13,
  /** Breathing room left around the fitted plan. */
  fitPadding: 1.12,
}

export type PlanSheetOptions = {
  walls: Wall[]
  furniture: FurnitureItem[]
  title: string
  /** ISO date string, rendered into the title block. Caller supplies it. */
  date: string
  width: number
  height: number
  /**
   * Device pixel scale already applied by the caller, for line widths.
   * Defaults to the sheet's own size against the reference sheet, so a small
   * on-screen preview and a print render carry the same visual weight.
   */
  pixelScale?: number
  /**
   * Where North points, in degrees clockwise from the top of the sheet. The
   * arrow has to carry this or an exported drawing quietly claims the plan is
   * North-up when the site is not.
   */
  northOffset?: number
  /**
   * Display unit for every reading on the sheet. Defaults to metric only so
   * that an older caller keeps its behaviour — a drawing handed to a builder
   * must carry the units the design was worked in.
   */
  units?: Unit
  /**
   * Room names, drawn with their areas. Optional because a sheet of an unnamed
   * shell is still a valid drawing.
   */
  roomLabels?: RoomLabel[]
  /** Sheet colour. White unless a caller wants tinted stock. */
  background?: string
}

type Rect = { left: number; top: number; right: number; bottom: number }

type Layout = {
  /** Line-weight unit: 1 at the reference sheet size. */
  u: number
  frame: Rect
  plot: Rect
  titleBlock: Rect
  /** Pixels per metre. */
  scale: number
  /** The world point drawn at the centre of the plot area. */
  origin: Point
}

type Extent = {
  min: Point
  max: Point
  center: Point
  width: number
  depth: number
}

/**
 * Draws the whole sheet into `ctx`, which is assumed to cover
 * `0,0 - width,height` with an identity transform.
 */
export function renderPlanSheet(
  ctx: CanvasRenderingContext2D,
  options: PlanSheetOptions,
): void {
  const fit = fitExtent(options.walls, options.furniture)
  const layout = layoutSheet(options, fit)
  const units: Unit = options.units ?? 'm'
  const walls = planBounds(options.walls)

  ctx.save()
  ctx.fillStyle = options.background ?? INK.paper
  ctx.fillRect(0, 0, options.width, options.height)
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'

  if (fit) {
    // Furniture sits under the walls so a piece pushed against one reads as
    // tucked against it rather than lying on top of it.
    drawFurniture(ctx, layout, options.furniture)
    drawWalls(ctx, layout, options.walls)
    if (walls) drawDimensions(ctx, layout, walls, fit, units)
    drawRoomLabels(ctx, layout, options.walls, options.roomLabels ?? [], units)
    drawNorthArrow(ctx, layout, options.northOffset ?? 0)
  } else {
    drawEmptyNote(ctx, layout)
  }

  drawScaleBar(ctx, layout, fit !== null, units)
  drawFrame(ctx, layout)
  drawTitleBlock(ctx, layout, options, fit !== null)
  ctx.restore()
}

/** Where every piece of the sheet lives, and how the plan maps onto it. */
function layoutSheet(
  options: PlanSheetOptions,
  extent: Extent | null,
): Layout {
  const { width, height } = options
  const short = Math.min(width, height)
  const u = Math.max(0.6, options.pixelScale ?? height / REFERENCE_HEIGHT)

  const margin = short * SHEET.margin
  const frame: Rect = {
    left: margin,
    top: margin,
    right: width - margin,
    bottom: height - margin,
  }
  const frameW = frame.right - frame.left
  const frameH = frame.bottom - frame.top

  const titleBlock: Rect = {
    left: frame.right - frameW * SHEET.titleWidth,
    top: frame.bottom - frameH * SHEET.titleHeight,
    right: frame.right,
    bottom: frame.bottom,
  }

  const gutter = short * SHEET.gutter
  const plot: Rect = {
    left: frame.left + gutter,
    top: frame.top + gutter,
    right: Math.max(frame.left + gutter + 1, frame.right - gutter),
    bottom: Math.max(frame.top + gutter + 1, titleBlock.top - gutter),
  }

  const plotW = plot.right - plot.left
  const plotH = plot.bottom - plot.top
  // An empty design, or one collapsed onto a single axis, would otherwise
  // divide by zero here and take the whole sheet with it.
  const raw = extent
    ? Math.min(
        plotW / Math.max(extent.width, 0.001),
        plotH / Math.max(extent.depth, 0.001),
      ) / SHEET.fitPadding
    : 0
  const scale = Number.isFinite(raw) && raw > 0 ? raw : 1

  return {
    u,
    frame,
    plot,
    titleBlock,
    scale,
    origin: extent ? extent.center : { x: 0, z: 0 },
  }
}

/** World metres to sheet pixels. World +z runs down the page, as in plan. */
function toSheet(layout: Layout, p: Point) {
  const cx = (layout.plot.left + layout.plot.right) / 2
  const cy = (layout.plot.top + layout.plot.bottom) / 2
  return {
    x: cx + (p.x - layout.origin.x) * layout.scale,
    y: cy + (p.z - layout.origin.z) * layout.scale,
  }
}

/**
 * Everything that must fit on the page: wall faces (not centrelines) plus
 * furniture footprints, so nothing is clipped by the fit.
 */
function fitExtent(walls: Wall[], furniture: FurnitureItem[]): Extent | null {
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

/**
 * Points the door leaf sweeps through, so `fitExtent` can keep the page fit —
 * and the overall dimension setout — clear of a door swinging off the building.
 *
 * This and the arc in `drawOpeningSymbol` must describe the same quarter turn,
 * 170 lines apart. That used to be asserted by this comment and nothing else,
 * while both hard-coded the hinge and the direction independently. They now
 * share `doorSwing`, so the model is what keeps them in step and
 * `doorSwing.test.ts` fails the build if either stops asking.
 */
function doorSweep(wall: Wall, opening: Opening): Point[] {
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

function drawFurniture(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  furniture: FurnitureItem[],
) {
  for (const item of furniture) {
    const size = furnitureSize(item)
    const centre = toSheet(layout, item.position)
    const w = size.width * layout.scale
    const d = size.depth * layout.scale

    ctx.save()
    ctx.translate(centre.x, centre.y)
    // Screen +y is world +z, so a positive world rotation is a positive
    // canvas rotation — no sign flip needed here.
    ctx.rotate(item.rotation)
    ctx.fillStyle = INK.furniture
    ctx.strokeStyle = INK.furnitureEdge
    ctx.lineWidth = 1 * layout.u
    ctx.beginPath()
    ctx.rect(-w / 2, -d / 2, w, d)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

function drawWalls(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  walls: Wall[],
) {
  const shared = sharedEnds(walls)

  for (const wall of walls) fillWallBody(ctx, layout, wall, shared)
  // Every opening is punched before any symbol is drawn, so a neighbouring
  // opening can never erase a swing arc that was already laid down.
  for (const wall of walls) {
    for (const opening of wall.openings) punchOpening(ctx, layout, wall, opening)
  }
  for (const wall of walls) {
    for (const opening of wall.openings) {
      drawOpeningSymbol(ctx, layout, wall, opening)
    }
  }
}

/**
 * The wall as a solid poché body carrying its real thickness.
 *
 * The GEOMETRY moved to `wallBody.ts` in B26 so the canvas could draw the same
 * shape; what stays here is the projection and the ink. This function's output
 * is pinned call-for-call by `wallBody.test.tsx` against a golden captured
 * before the extraction — the sheet is the one renderer that was already
 * correct, and a silent change to it would be the worst outcome available.
 */
function fillWallBody(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  wall: Wall,
  shared: Set<string>,
) {
  const quad = wallBodyQuad(wall, shared)
  if (!quad) return

  const corners = quad.map((p) => toSheet(layout, p))

  ctx.beginPath()
  ctx.fillStyle = INK.wall
  ctx.moveTo(corners[0].x, corners[0].y)
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y)
  }
  ctx.closePath()
  ctx.fill()
}

/** The opening's jambs in sheet space, plus the axes the symbols need. */
function openingFrame(layout: Layout, wall: Wall, opening: Opening) {
  const half = opening.width / 2
  const a = toSheet(layout, pointAlongWall(wall, opening.position - half))
  const b = toSheet(layout, pointAlongWall(wall, opening.position + half))
  const span = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return {
    a,
    b,
    span,
    /** Unit normal to the opening, in sheet pixels. */
    nx: (b.y - a.y) / span,
    ny: -(b.x - a.x) / span,
    thickness: wall.thickness * layout.scale,
  }
}

/** Breaks the wall across the opening, the same span `plan/draw.ts` clears. */
function punchOpening(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  wall: Wall,
  opening: Opening,
) {
  const { a, b, nx, ny, thickness } = openingFrame(layout, wall, opening)
  // Slightly over-wide so no sliver of wall survives along the faces.
  const half = thickness / 2 + layout.u

  ctx.beginPath()
  ctx.fillStyle = INK.paper
  ctx.moveTo(a.x + nx * half, a.y + ny * half)
  ctx.lineTo(b.x + nx * half, b.y + ny * half)
  ctx.lineTo(b.x - nx * half, b.y - ny * half)
  ctx.lineTo(a.x - nx * half, a.y - ny * half)
  ctx.closePath()
  ctx.fill()
}

/** Standard plan symbols: a swing arc for a door, glazing lines for a window. */
function drawOpeningSymbol(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  wall: Wall,
  opening: Opening,
) {
  const { a, b, span, nx, ny, thickness } = openingFrame(layout, wall, opening)
  const u = layout.u
  const half = thickness / 2

  // Jamb lines close the wall off at both ends of the break.
  ctx.beginPath()
  ctx.strokeStyle = INK.symbol
  ctx.lineWidth = 1.2 * u
  for (const p of [a, b]) {
    ctx.moveTo(p.x - nx * half, p.y - ny * half)
    ctx.lineTo(p.x + nx * half, p.y + ny * half)
  }
  ctx.stroke()

  if (opening.type === 'door') {
    // From the model, exactly as the canvas and the 3D leaf now take it — and
    // as `doorSweep` above takes it, so the space this sheet reserves for the
    // leaf is on the side it actually draws the leaf.
    const swing = doorSwing(wall, opening)
    const h = toSheet(layout, swing.hinge)
    const f = toSheet(layout, swing.free)
    const quarter = (-Math.PI / 2) * swing.sweep

    ctx.save()
    ctx.translate(h.x, h.y)
    ctx.rotate(Math.atan2(f.y - h.y, f.x - h.x))

    ctx.beginPath()
    ctx.strokeStyle = INK.symbol
    ctx.lineWidth = 1.8 * u
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -span * swing.sweep)
    ctx.stroke()

    ctx.beginPath()
    ctx.strokeStyle = INK.symbol
    ctx.lineWidth = 1 * u
    ctx.arc(0, 0, span, Math.min(0, quarter), Math.max(0, quarter))
    ctx.stroke()
    ctx.restore()
    return
  }

  // A cased opening is what is left when both branches are skipped: the wall
  // already broken across its full thickness by `punchOpening`, closed off by
  // the jamb lines above. No leaf, no arc, no glass. The symbol was here all
  // along — it just had no type that could reach it (STATE.md finding 22).
  if (opening.type === 'cased') return

  // Glazing: a thin pair of lines set in from the wall faces.
  //
  // B26 gave the canvas the same symbol via `glazingLines`, which computes it
  // in WORLD metres. This stayed in sheet pixels deliberately. The two are
  // algebraically identical but not bit-identical — projecting a world-space
  // offset associates the multiply differently, and the sheet's y moved by
  // 2 ULPs, 2.8e-14 px on an 842 px page. Invisible, and still a change to the
  // one renderer that was already correct, so it was not made. The RATIO is
  // shared; the arithmetic is not. `wallBody.test.tsx` pins the two forms
  // together to 1e-9 m so they cannot drift apart unnoticed.
  const inset = half * GLAZING_INSET_RATIO
  ctx.beginPath()
  ctx.strokeStyle = INK.symbol
  ctx.lineWidth = 1 * u
  for (const side of [1, -1]) {
    ctx.moveTo(a.x + nx * inset * side, a.y + ny * inset * side)
    ctx.lineTo(b.x + nx * inset * side, b.y + ny * inset * side)
  }
  ctx.stroke()
}

/**
 * Overall dimensions along the bottom and left of the plan bounds.
 *
 * The readings come from the wall extents — that is the building — but the
 * lines are set out beyond `clear`, so a door swinging off the south wall
 * never lands on top of its own dimension.
 */
function drawDimensions(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  bounds: Extent,
  clear: Extent,
  units: Unit,
) {
  const u = layout.u
  const min = toSheet(layout, bounds.min)
  const max = toSheet(layout, bounds.max)
  // Set out from whichever is further: the building, or a door swinging off it.
  const baseY = Math.max(max.y, toSheet(layout, clear.max).y)
  const baseX = Math.min(min.x, toSheet(layout, clear.min).x)

  ctx.strokeStyle = INK.dimension
  ctx.fillStyle = INK.dimension
  ctx.lineWidth = 1 * u
  ctx.font = `${Math.round(15 * u)}px ${FONT_STACK}`

  // Bottom: overall width.
  const gapY = Math.min(34 * u, (layout.plot.bottom - baseY) * 0.75)
  const y = baseY + gapY
  ctx.beginPath()
  ctx.moveTo(min.x, y)
  ctx.lineTo(max.x, y)
  for (const x of [min.x, max.x]) {
    ctx.moveTo(x, max.y + gapY * 0.25)
    ctx.lineTo(x, y + 5 * u)
    ctx.moveTo(x - 4 * u, y + 4 * u)
    ctx.lineTo(x + 4 * u, y - 4 * u)
  }
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(formatLength(bounds.width, units), (min.x + max.x) / 2, y - 6 * u)

  // Left: overall depth, read from the side as drawings are dimensioned.
  const gapX = Math.min(34 * u, (baseX - layout.plot.left) * 0.75)
  const x = baseX - gapX
  ctx.beginPath()
  ctx.moveTo(x, min.y)
  ctx.lineTo(x, max.y)
  for (const py of [min.y, max.y]) {
    ctx.moveTo(min.x - gapX * 0.25, py)
    ctx.lineTo(x - 5 * u, py)
    ctx.moveTo(x - 4 * u, py + 4 * u)
    ctx.lineTo(x + 4 * u, py - 4 * u)
  }
  ctx.stroke()

  ctx.save()
  ctx.translate(x - 6 * u, (min.y + max.y) / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(formatLength(bounds.depth, units), 0, 0)
  ctx.restore()
}

/**
 * Room names with their areas, at the centre of each enclosed space.
 *
 * A plan without them is a picture of walls; with them it is a document someone
 * can price and build from, which is the whole point of this sheet.
 */
function drawRoomLabels(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  walls: Wall[],
  roomLabels: RoomLabel[],
  units: Unit,
) {
  if (walls.length === 0) return

  const rooms = resolveRooms(walls, roomLabels)
  const u = layout.u

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const room of rooms) {
    const centre = toSheet(layout, room.centroid)
    const name = room.label ? roomDisplayName(room.label) : null
    const area = formatArea(room.area, units)

    // A room too small on the sheet to hold its own name gets the area alone,
    // and if even that will not fit, nothing — an unreadable smear of
    // overlapping text is worse than a blank room.
    ctx.font = `${Math.round(15 * u)}px ${FONT_STACK}`
    const widthOf = (text: string) => ctx.measureText(text).width
    const span = extentOnSheet(layout, room.polygon)

    if (name && widthOf(name) < span.width && span.height > 34 * u) {
      ctx.fillStyle = INK.text
      ctx.fillText(name, centre.x, centre.y - 9 * u)
      ctx.font = `${Math.round(13 * u)}px ${FONT_STACK}`
      ctx.fillStyle = INK.muted
      ctx.fillText(area, centre.x, centre.y + 9 * u)
    } else if (widthOf(area) < span.width && span.height > 16 * u) {
      ctx.font = `${Math.round(13 * u)}px ${FONT_STACK}`
      ctx.fillStyle = INK.muted
      ctx.fillText(area, centre.x, centre.y)
    }

    // Open-plan zones share this enclosure; each further name prints at its own
    // anchor, the name alone — the area above already measures the whole space.
    ctx.font = `${Math.round(15 * u)}px ${FONT_STACK}`
    ctx.fillStyle = INK.text
    for (const extra of room.extraLabels) {
      const zoneName = roomDisplayName(extra)
      if (widthOf(zoneName) >= span.width) continue
      const spot = toSheet(layout, extra.anchor)
      ctx.fillText(zoneName, spot.x, spot.y)
    }
  }

  ctx.restore()
}

/** On-sheet width and height of a polygon, for deciding whether text fits. */
function extentOnSheet(layout: Layout, polygon: Point[]) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of polygon) {
    const s = toSheet(layout, p)
    minX = Math.min(minX, s.x)
    maxX = Math.max(maxX, s.x)
    minY = Math.min(minY, s.y)
    maxY = Math.max(maxY, s.y)
  }
  return { width: maxX - minX, height: maxY - minY }
}

/** Graphic scale bar, so the sheet stays readable after a resized print. */
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  hasPlan: boolean,
  units: Unit,
) {
  if (!hasPlan) return

  const u = layout.u
  const target = (layout.titleBlock.left - layout.frame.left) * 0.45
  // Step in the drawing's own unit, so an imperial sheet reads 0-5-10 ft
  // rather than a metric bar sitting under imperial dimensions.
  const step = pickScaleStep(layout.scale, target, units)
  const segment = step * layout.scale
  const x0 = layout.frame.left + 12 * u
  const y = (layout.titleBlock.top + layout.titleBlock.bottom) / 2
  const barHeight = 9 * u

  ctx.font = `${Math.round(14 * u)}px ${FONT_STACK}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = INK.muted
  ctx.fillText('SCALE', x0, y - 8 * u)

  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? INK.frame : INK.paper
    ctx.fillRect(x0 + i * segment, y, segment, barHeight)
  }

  ctx.strokeStyle = INK.frame
  ctx.lineWidth = 1 * u
  ctx.strokeRect(x0, y, segment * 4, barHeight)

  ctx.fillStyle = INK.text
  ctx.textBaseline = 'top'
  for (const i of [0, 2, 4]) {
    ctx.textAlign = i === 4 ? 'right' : i === 0 ? 'left' : 'center'
    ctx.fillText(
      formatLength(step * i, units),
      x0 + i * segment,
      y + barHeight + 5 * u,
    )
  }
}

/** The division that gets the four-segment bar closest to `target` pixels. */
function pickScaleStep(scale: number, target: number, units: Unit): number {
  // Round numbers in the unit on the page: 1/2/5/10 ft, or 0.5/1/2/5 m. A bar
  // labelled 1.52 m because it is really 5 ft is worse than useless.
  const steps =
    units === 'ftin'
      ? SCALE_BAR_STEPS_FT.map((feet) => feet * METRES_PER_FOOT)
      : SCALE_BAR_STEPS

  let best = steps[0]
  let bestError = Infinity
  for (const step of steps) {
    const error = Math.abs(step * scale * 4 - target)
    if (error < bestError) {
      bestError = error
      best = step
    }
  }
  return best
}

/**
 * The drawing ratio to quote, as the nearest standard ratio to the scale the
 * plan actually got fitted at. Fitting to the sheet beats printing a plan at a
 * true 1:50 that only fills half the page, so the label is the honest
 * approximation rather than the other way round.
 */
function scaleLabel(scale: number): string {
  const exact = PX_PER_PAPER_METRE / scale
  if (!Number.isFinite(exact) || exact <= 0) return 'NTS'

  let best = STANDARD_SCALES[0]
  let bestError = Infinity
  for (const ratio of STANDARD_SCALES) {
    // Compared in log space: 1:100 is as near 1:75 as it is to 1:133.
    const error = Math.abs(Math.log(ratio / exact))
    if (error < bestError) {
      bestError = error
      best = ratio
    }
  }
  return `1:${best}`
}

function drawNorthArrow(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  northOffset: number,
) {
  const u = layout.u
  const r = 26 * u
  const cx = layout.plot.right - r
  const cy = layout.plot.top + r * 1.2

  ctx.save()
  ctx.translate(cx, cy)
  // Only the needle turns. The "N" is un-rotated below so it stays readable
  // at every orientation rather than ending up upside down.
  ctx.rotate((northOffset * Math.PI) / 180)
  ctx.fillStyle = INK.frame
  ctx.strokeStyle = INK.frame
  ctx.lineWidth = 1.2 * u

  // Solid west half, hollow east half: reads as a compass needle at a glance.
  ctx.beginPath()
  ctx.moveTo(0, -r)
  ctx.lineTo(-r * 0.5, r * 0.72)
  ctx.lineTo(0, r * 0.3)
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(0, -r)
  ctx.lineTo(r * 0.5, r * 0.72)
  ctx.lineTo(0, r * 0.3)
  ctx.closePath()
  ctx.stroke()

  ctx.restore()

  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = INK.frame
  ctx.font = `${Math.round(13 * u)}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('N', 0, r * 0.85)
  ctx.restore()
}

function drawEmptyNote(ctx: CanvasRenderingContext2D, layout: Layout) {
  ctx.fillStyle = INK.muted
  ctx.font = `${Math.round(20 * layout.u)}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    'Nothing drawn yet',
    (layout.plot.left + layout.plot.right) / 2,
    (layout.plot.top + layout.plot.bottom) / 2,
  )
}

function drawFrame(ctx: CanvasRenderingContext2D, layout: Layout) {
  const { frame, u } = layout
  ctx.strokeStyle = INK.frame
  ctx.lineWidth = 2 * u
  ctx.strokeRect(
    frame.left,
    frame.top,
    frame.right - frame.left,
    frame.bottom - frame.top,
  )

  const inset = 5 * u
  ctx.lineWidth = 0.8 * u
  ctx.strokeRect(
    frame.left + inset,
    frame.top + inset,
    frame.right - frame.left - inset * 2,
    frame.bottom - frame.top - inset * 2,
  )
}

function drawTitleBlock(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  options: PlanSheetOptions,
  hasPlan: boolean,
) {
  const { titleBlock: box, u } = layout
  const w = box.right - box.left
  const h = box.bottom - box.top
  const pad = 14 * u

  ctx.fillStyle = INK.paper
  ctx.fillRect(box.left, box.top, w, h)
  ctx.strokeStyle = INK.frame
  ctx.lineWidth = 1.6 * u
  ctx.strokeRect(box.left, box.top, w, h)

  const divider = box.top + h * 0.55
  ctx.beginPath()
  ctx.lineWidth = 0.8 * u
  ctx.moveTo(box.left, divider)
  ctx.lineTo(box.right, divider)
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = INK.text
  ctx.font = `${Math.round(24 * u)}px ${FONT_STACK}`
  ctx.fillText(
    ellipsis(ctx, options.title || 'Untitled', w - pad * 2),
    box.left + pad,
    (box.top + divider) / 2,
  )

  ctx.font = `${Math.round(14 * u)}px ${FONT_STACK}`
  ctx.fillStyle = INK.muted
  ctx.fillText(formatDate(options.date), box.left + pad, (divider + box.bottom) / 2)

  ctx.textAlign = 'right'
  ctx.fillStyle = INK.text
  ctx.fillText(
    hasPlan ? `SCALE ${scaleLabel(layout.scale)}` : 'SCALE —',
    box.right - pad,
    (divider + box.bottom) / 2,
  )
}

/** ISO timestamps carry a time nobody wants on a drawing; keep the date. */
function formatDate(date: string): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(date)
  return match ? match[0] : date
}

/** Long project names must not spill out of the title block. */
function ellipsis(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text

  let clipped = text
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1)
  }
  return `${clipped}…`
}
