import type {
  Facing,
  FurnitureItem,
  Opening,
  Plot,
  Point,
  Selection,
  Stair,
  Unit,
  Wall,
} from '../store/useDesignStore'
import { furnitureSize } from '../furniture/catalog'
import { getRoomType, roomDisplayName } from '../rooms/catalog'
import { roomSize, selectedRoomOf, type ResolvedRoom } from '../rooms/resolve'
import { SELECTION } from '../scene/config'
import { doorSwing, planBounds, pointAlongWall } from '../scene/wallGeometry'
import {
  clearanceExtent,
  dimensionRuns,
  strokeRunInk,
  type DimensionRun,
  type RunInk,
} from './dimensionChains'
import { placeBoxes, type LabelBox } from './labelLayout'
import { JOIN_TOLERANCE } from '../units/tolerance'
import { glazingLines, sharedEnds, wallBodyQuad } from './wallBody'
import type { SnapTarget } from './snap'
import type { LooseJoint, TypedMiss } from './repairJoints'
import {
  buildableRect,
  frontEdge,
  plotRect,
  wallsOutsideBuildable,
  type PlanEdge,
  type Rect,
} from '../site/plot'
import {
  DEFAULT_FACING,
  FLOOR_HEIGHT,
  STAIR_DEFAULTS,
} from '../store/useDesignStore'
import {
  formatArea,
  formatLength,
  formatLengthCompact,
  GRID_STEP,
} from '../units/length'
import type { VastuZone } from '../vastu/ruleset'
import type { ZoneCell } from '../vastu/zones'
import { distance, visibleBounds, worldToScreen, type Viewport } from './viewport'

/** Tuned against the 3D scene's palette so the two modes feel like one app. */
const COLORS = {
  background: '#f7f8fa',
  gridMinor: '#e2e6ed',
  gridMajor: '#c7cedb',
  axis: '#a3adbe',
  wallFill: '#334155',
  /** The snap indicator. Warm, so it reads against the cool wall/grid palette. */
  snap: '#b45309',
  snapFill: 'rgba(251, 191, 36, 0.92)',
  /** Paper-coloured halo, so the marker reads over the wall it sits on. */
  snapHalo: 'rgba(247, 248, 250, 0.95)',
  /** The typed-length field: an INPUT, so it does not look like the readout. */
  entry: '#ffffff',
  entryBg: '#b45309',
  /** Endpoint handles: a CONTROL on the selection, not a target. */
  handle: SELECTION.color2d,
  handleFill: '#ffffff',
  handleBlocked: '#b91c1c',
  handleBlockedFill: '#fecaca',
  // `vertex` went with the 2.5 px dot B26 deleted. The dot existed only to
  // mask the square notch two butting walls left at a corner, which the
  // half-thickness pad now fills — leaving it would have put a blob on top of
  // a join that is finally correct.
  selected: SELECTION.color2d,
  opening: '#0f172a',
  furnitureFill: 'rgba(148, 163, 184, 0.35)',
  furnitureSelectedFill: 'rgba(37, 99, 235, 0.22)',
  furnitureEdge: '#64748b',
  draft: '#2563eb',
  draftFill: 'rgba(37, 99, 235, 0.12)',
  // Deliberately not the draft blue: a calibration measurement is not a wall
  // being drawn, and confusing the two costs the user a wrong scale.
  calibration: '#7c3aed',
  // Dimensions are annotation, not building: kept a shade below the wall ink so
  // the eye still reads the plan first.
  dimension: '#94a3b8',
  dimensionLabel: '#64748b',
  label: '#1e293b',
  labelBg: 'rgba(255, 255, 255, 0.9)',
  // A detected but unnamed space still gets a whisper of fill so it reads as a
  // room, and its caption stays grey so it never reads as a named one.
  roomUnnamedFill: 'rgba(148, 163, 184, 0.06)',
  roomName: '#334155',
  roomArea: '#8d98a8',
  roomSelectedFill: 'rgba(37, 99, 235, 0.10)',
  roomSelectedBand: 'rgba(37, 99, 235, 0.20)',
  // The zone grid is a reading laid over a working drawing, so it sits a shade
  // below even the dimension ink. Warm against the plan's slate, so it reads as
  // something applied to the drawing rather than part of it.
  vastuLine: 'rgba(120, 113, 108, 0.32)',
  vastuLabel: 'rgba(120, 113, 108, 0.8)',
  // The centre is the one zone this ruleset asks to be left open, so it is the
  // only cell marked: enough tint to find it, not enough to read as a room.
  vastuCentreFill: 'rgba(217, 119, 6, 0.06)',
  vastuCentreLine: 'rgba(180, 83, 9, 0.4)',
  // The site is not the building, so it gets an ink of its own: a boundary is a
  // legal edge, and reading it as a wall is how a house ends up drawn over the
  // neighbour's land. Green throughout, because the one thing the whole layer
  // says is where building is permitted.
  plotLine: '#0f766e',
  plotSetback: 'rgba(13, 148, 136, 0.8)',
  plotLabel: '#0f766e',
  buildableFill: 'rgba(16, 185, 129, 0.05)',
  buildableHatch: 'rgba(16, 185, 129, 0.2)',
  // A wall over the setback line is what gets a sanction drawing rejected, so
  // it is the one thing on this plan allowed to shout.
  violation: '#dc2626',
  violationGlow: 'rgba(220, 38, 38, 0.3)',
  // A wall end that looks joined and is not. Amber, not the setback red: it
  // is a mistake in the drawing rather than a wall over a legal line.
  looseJoint: '#d97706',
  // Stairs are structure rather than contents, so they take the wall's ink
  // family instead of the furniture grey — but lighter, so treads stay
  // countable against it.
  stairFill: 'rgba(241, 245, 249, 0.85)',
  stairEdge: '#475569',
  stairTread: '#94a3b8',
  stairSelectedFill: 'rgba(37, 99, 235, 0.16)',
}

/** Below this spacing the fine grid turns into visual noise, so it's dropped. */
const MIN_GRID_SPACING_PX = 7

/**
 * Dash for a space no walls enclose.
 *
 * An enclosed room needs no outline — its walls draw it. An open space has
 * none, so without a line it would be a floating caption over blank paper. It
 * is dashed rather than solid because a solid line at a room's edge means a
 * built edge, and claiming one where the user drew only an extent would be the
 * drawing telling a lie the model does not.
 */
const OPEN_SPACE_DASH = [6, 4]

/** Ring drawn round an unjoined wall end, in screen pixels. */
const LOOSE_JOINT_RADIUS_PX = 7

/**
 * Dimension-line tuning, all in screen pixels so annotation keeps the same
 * weight at every zoom rather than growing with the building.
 */
const DIMENSION = {
  /** Wall centreline to dimension line. */
  offsetPx: 22,
  /** Clearance between the wall and where its witness line starts. */
  gapPx: 5,
  /** How far the witness line runs past the dimension line. */
  overshootPx: 5,
  /** Half-length of the 45° end ticks. */
  tickPx: 5,
  /** Shorter than this on screen and the dimension is noise, so it's dropped. */
  minWallPx: 46,
  /** Clear run the label needs either side of itself to be worth drawing. */
  labelMarginPx: 12,
  /** How far a door/window width label sits inside the wall, off its centre. */
  openingOffsetPx: 13,
}

/**
 * Below this the wall's midpoint is effectively on the plan's centre, so
 * "outside" is undefined and the side has to be broken another way.
 */
const OUTWARD_EPSILON_PX = 0.5

/**
 * Dimension-chain tuning, in screen pixels — annotation, like `DIMENSION`.
 *
 * The chain line is set out from the CLEARANCE extent (wall faces, door
 * sweeps, furniture), not from the plan bounds, so a door swinging off the
 * south wall pushes the south runs out past its leaf — the sheet's own rule,
 * now shared. `offsetPx` also clears the per-wall label band, which sits
 * `DIMENSION.offsetPx` (22) off each wall with an 8.5 px half-chip below it:
 * both annotations survive this session (decluttering is the next one), so
 * they must not land on each other.
 */
const CHAIN = {
  /** Clearance edge to the station chain's line. */
  offsetPx: 46,
  /** Station chain line to the overall's line, when they share a side. */
  tierPx: 24,
  /** Building edge to where a witness line starts. */
  gapPx: 5,
  /** How far the witness line runs past the dimension line. */
  overshootPx: 5,
  /** Half-length of the 45° station ticks. */
  tickPx: 5,
  /** Label to its line. */
  textGapPx: 3,
  /** Clear run a bay's label needs either side of itself, or it is dropped. */
  labelMarginPx: 6,
}

/**
 * Room caption tuning, in screen pixels. Like the dimensions, a caption is
 * annotation rather than building: it keeps one weight at every zoom and
 * simply stops being drawn once its room is too small on screen to hold it.
 */
const ROOM = {
  /** Clear run the caption needs either side of itself, inside the room. */
  marginPx: 11,
  /** Vertical room one caption line needs, chip included. */
  lineHeightPx: 21,
  /** Width of the band marking the selected room, measured inwards. */
  selectedBandPx: 7,
}

/**
 * Nine-zone overlay tuning, in screen pixels. Hairlines and dashes throughout:
 * the grid has to be findable without ever outweighing the walls it covers.
 */
const VASTU = {
  /** Dash for the cell boundaries. */
  dash: [5, 4],
  /** Finer dash for the centre cell, so it reads as marked, not as drawn. */
  centreDash: [2, 3],
  /** Clear run a zone label needs either side of itself, inside its cell. */
  marginPx: 8,
  /** Vertical room one zone label needs. */
  lineHeightPx: 13,
}

/**
 * Site-layer tuning. Screen pixels and screen dashes throughout, like the
 * dimensions: the boundary is annotation of the ground, not something built, so
 * it keeps one weight while the drawing zooms.
 */
const PLOT = {
  /** Chain line — long, short, long: the surveyor's mark for a property edge. */
  boundaryDash: [14, 5, 3, 5],
  boundaryWidthPx: 2.5,
  setbackDash: [7, 5],
  /** Pitch of the buildable hatch. */
  hatchPx: 11,
  /** Boundary to its dimension label. */
  labelOffsetPx: 15,
  /** Boundary to the tag naming the edge the plot fronts onto. */
  tagInsetPx: 15,
  /** Below this an edge is too short on screen to caption. */
  minSpanPx: 44,
  /** Clear run a dimension label needs either side of itself. */
  labelMarginPx: 8,
  /** Plot boundary to the warning chip. */
  warningOffsetPx: 26,
  /** Clearance the warning chip keeps from the canvas edge, past its own text. */
  warningMarginPx: 10,
}

/**
 * Staircase symbol tuning, in screen pixels.
 */
const STAIR = {
  /** Below this pitch the treads are noise, so the flight draws as a box. */
  minTreadPx: 4,
  /** Clearance the ascent arrow keeps from each end of the flight. */
  arrowInsetPx: 6,
  arrowHeadPx: 8,
  /** Foot of the flight to the UP chip. */
  labelGapPx: 12,
  /** Shorter than this on screen and the chip would dwarf its own staircase. */
  minLabelPx: 34,
}

/**
 * Tread lines the symbol carries, taken from the real geometry rather than
 * picked: a storey's worth of risers at the default rise, less the one that
 * lands on the floor above. Drawing an arbitrary count would put a flight on the
 * plan that cannot climb the building it is in.
 */
const TREAD_COUNT = Math.max(
  2,
  Math.round(FLOOR_HEIGHT / STAIR_DEFAULTS.riserHeight) - 1,
)

const LABEL_FONT =
  '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/**
 * The chip `label()` paints, and therefore the collision box a chip label
 * occupies (B35). One set of numbers so the box and the paint cannot drift.
 */
const LABEL_CHIP = { padding: 5, height: 17 }

/** Height of a plain (chip-less) chain label at `LABEL_FONT`'s 11 px. */
const CHAIN_LABEL_H = 12

/** Lighter and smaller than `LABEL_FONT`: a zone label is the quietest text. */
const VASTU_FONT =
  '10px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** Heavier than `LABEL_FONT`: a room's name is a title, not an annotation. */
const ROOM_FONT =
  '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/**
 * A traced reference image ready to paint: the placement carried by the store's
 * `Blueprint`, plus the decoded element. Loading is async and painting is not,
 * so the caller owns the element and only hands it over once it is usable.
 */
export type PlanBlueprint = {
  image: HTMLImageElement
  /** World position of the image's top-left pixel, in metres. */
  origin: Point
  /** Source pixel dimensions. */
  width: number
  height: number
  metresPerPixel: number
  opacity: number
}

export type PlanScene = {
  width: number
  height: number
  viewport: Viewport
  walls: Wall[]
  furniture: FurnitureItem[]
  /**
   * Enclosed spaces with their names already matched, from `resolveRooms`.
   * Resolved by the caller and memoised there: it walks the whole wall graph,
   * which is far too much work to repeat on a pointer move.
   */
  rooms: ResolvedRoom[]
  /** The open floor's staircases. Absent reads as none, like `blueprint`. */
  stairs?: Stair[]
  /**
   * The site boundary, or null/absent when the design is not on a defined plot.
   * The setbacks and the buildable area are derived from it here rather than
   * handed in: it is four rectangle operations and one pass over the walls, the
   * same order of work as drawing them, and deriving it in the paint is what
   * keeps the buildable zone honest while the plot is being edited.
   */
  plot?: Plot | null
  /** Which way the plot faces, which decides where the front setback lands. */
  plotFacing?: Facing
  /** North rotation in degrees, which turns the front edge with the compass. */
  northOffset?: number
  /**
   * The nine Vastu zones as world-space quads, from `vastuZones` — already
   * turned to face north, so nothing here rotates them again. Empty or absent
   * when the overlay is switched off. Memoised by the caller alongside the
   * rooms: the grid only moves when the walls or the north angle do.
   */
  vastuCells?: ZoneCell[] | null
  selection: Selection
  /** Display unit for every length painted on the plan. The model is metric. */
  units: Unit
  /**
   * When on, doors and windows are labelled with their width. Wall lengths are
   * always dimensioned (see `drawDimensions`); this adds the opening sizes that
   * would otherwise clutter the plan when it is off.
   */
  showDimensions?: boolean
  /** The last placed point, when a wall chain is in progress. */
  anchor: Point | null
  /** Wall ends that look joined and are not. Absent reads as none. */
  looseJoints?: LooseJoint[] | null
  /** The corner an open-space outline is being dragged from, if any. */
  spaceCorner?: Point | null
  /** Snapped cursor position, or null when the pointer is off-canvas. */
  cursor: Point | null
  /**
   * What the wall endpoint is snapping to, or null.
   *
   * Drawn from the POINTER-MOVE path, which is what makes the indicator appear
   * before the click rather than after it — the editor computes this and the
   * committed point with one function, so the marker cannot disagree with what
   * clicking would do.
   */
  snap?: SnapTarget | null
  /**
   * What the user has typed into the length field, or null when no numeric
   * entry is in progress. The RAW keystrokes, never a formatted value —
   * §4 invariant 4 says `formatLength` is lossy and `parseLength` is not its
   * inverse, so round-tripping the buffer through a display string would
   * quietly change what the user typed.
   */
  typed?: string | null
  /**
   * What the typed buffer is about to do wrong: the entry's predicted
   * endpoint lands near a wall but not on it (B34, finding 53 mechanism 2).
   * Computed by the editor from the buffer and the pointer with
   * `probeTypedMiss`, so the warning uses the loose-end scan's own
   * tolerances. Null when no entry is live or the entry lands clean —
   * absent reads as null, like `snap`.
   */
  typedMiss?: TypedMiss | null
  /**
   * The selected wall's draggable endpoint handles, and whether the endpoint
   * under the pointer refused to move. `blocked` is the number of walls
   * meeting there — 3 or more has no correct answer (see `moveWallEndpointIn`).
   */
  handles?: {
    wallId: string
    /** How many walls meet at the grabbed endpoint; 0 when it is free to move. */
    blocked: number
    /** Which endpoint was grabbed, so the refusal is drawn where the hand is. */
    which?: 'start' | 'end'
  } | null
  /** Suppresses the snap marker for tools that act on walls, not the grid. */
  showCursor: boolean
  /** Reference image to trace, or null/absent when there is none to show. */
  blueprint?: PlanBlueprint | null
  /** Blueprint calibration points picked so far — none, one, or both. */
  calibration?: Point[] | null
}

export function drawPlan(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const { width, height } = scene

  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, width, height)

  // Under the grid, so the grid stays readable over a dark scan.
  drawBlueprint(ctx, scene)
  drawGrid(ctx, scene)
  // The site goes under everything built, because that is what it is: the
  // ground the plan is drawn on. Its warning does not — see below.
  const site = siteFrame(scene)
  if (site) drawPlot(ctx, scene, site)
  // Under the furniture, since it is the floor those pieces stand on.
  drawRoomFills(ctx, scene)
  // Over the room tints, under everything built: the zone grid is a reading
  // taken off the plan, so the furniture, walls and dimensions all paint on
  // top of it and the drawing stays the drawing.
  drawVastuGrid(ctx, scene)
  // Under the furniture for the same reason furniture is under the walls: a
  // stair is built into the floor, and a chair on its landing sits on it.
  drawStairs(ctx, scene)
  // Furniture sits under the walls: a piece pushed against a wall should read
  // as tucked against it, not overlapping it.
  drawFurniture(ctx, scene)
  drawWalls(ctx, scene)
  // Over the walls, and deliberately: the warning recolours the very walls that
  // are over the line, so it cannot be drawn under them and be seen.
  if (site) drawPlotViolations(ctx, scene, site)
  // Chains first: they are the statement of record, and their label boxes are
  // the obstacles every surviving per-wall label must yield to (B35).
  const chainBoxes = drawDimensionChains(ctx, scene)
  // Over the walls, so a dimension crossing one keeps its label readable.
  drawDimensions(ctx, scene, chainBoxes)
  // Opening widths ride over the walls too, and only when the switch is on.
  drawOpeningDimensions(ctx, scene)
  // Also over the walls: the selection band hugs the room's outline, which is
  // the wall centreline, so anything drawn under a wall is drawn invisibly.
  drawRoomCaptions(ctx, scene)
  // Over the walls, and deliberately, exactly like the setback warning: this
  // is the defect that decides whether the areas on this drawing are real, and
  // a warning you have to open a panel to find is a warning that gets missed.
  drawLooseJoints(ctx, scene)
  drawDraft(ctx, scene)
  drawSpaceDraft(ctx, scene)
  if (scene.showCursor) drawCursor(ctx, scene)
  if (scene.handles) drawEndpointHandles(ctx, scene, scene.handles)
  if (scene.snap) drawSnapIndicator(ctx, scene, scene.snap)
  drawCalibration(ctx, scene)
}

/**
 * The reference image, mapped corner to corner through the viewport.
 *
 * A broken or still-decoding element makes `drawImage` throw, which would take
 * the entire paint down with it, so the element is checked rather than trusted.
 */
function drawBlueprint(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const bp = scene.blueprint
  if (!bp || !bp.image.complete || bp.image.naturalWidth === 0) return

  const { width, height, viewport: vp } = scene
  const a = worldToScreen(bp.origin, vp, width, height)
  const b = worldToScreen(
    {
      x: bp.origin.x + bp.width * bp.metresPerPixel,
      z: bp.origin.z + bp.height * bp.metresPerPixel,
    },
    vp,
    width,
    height,
  )

  ctx.save()
  ctx.globalAlpha = bp.opacity
  ctx.drawImage(bp.image, a.x, a.y, b.x - a.x, b.y - a.y)
  ctx.restore()
}

/**
 * The in-progress scale measurement: the picked ends and the span between
 * them, rubber-banding to the cursor until the second end is committed.
 */
function drawCalibration(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const picks = scene.calibration
  if (!picks || picks.length === 0) return

  const { width, height, viewport: vp, cursor } = scene
  const toScreen = (p: Point) => worldToScreen(p, vp, width, height)
  const end = picks.length > 1 ? picks[1] : cursor

  ctx.save()

  if (end) {
    const a = toScreen(picks[0])
    const b = toScreen(end)

    ctx.beginPath()
    ctx.strokeStyle = COLORS.calibration
    ctx.lineWidth = 2
    ctx.setLineDash([7, 4])
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])

    // The reading at the current scale — the number calibration replaces.
    const span = distance(picks[0], end)
    label(ctx, `${span.toFixed(2)} m`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 14)
  }

  for (const pick of picks) {
    const p = toScreen(pick)
    ctx.beginPath()
    ctx.strokeStyle = COLORS.calibration
    ctx.lineWidth = 2
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
    ctx.moveTo(p.x - 9, p.y)
    ctx.lineTo(p.x + 9, p.y)
    ctx.moveTo(p.x, p.y - 9)
    ctx.lineTo(p.x, p.y + 9)
    ctx.stroke()
  }

  ctx.restore()
}

/** A projected point, in canvas pixels. */
type ScreenPoint = { x: number; y: number }

/** A projected axis-aligned box, in canvas pixels. */
type ScreenRect = { left: number; top: number; right: number; bottom: number }

/**
 * Everything the site layer needs, resolved once per paint: the boundary and
 * the buildable area in screen space, and which walls are over the line.
 */
type SiteFrame = {
  plot: Plot
  outer: ScreenRect
  /** Null when the setbacks meet and there is nothing left to build on. */
  inner: ScreenRect | null
  front: PlanEdge
  /** Ids of the walls straying outside the buildable area. */
  offenders: Set<string>
  /** True when the setbacks leave no buildable area at all. */
  blocked: boolean
}

/**
 * Resolves the plot for this frame, or null when there is no plot.
 *
 * The plot never rotates — north rotates instead — so the boundary and the
 * setbacks are always axis-aligned on the page, and projecting two opposite
 * corners is the whole transform.
 */
function siteFrame(scene: PlanScene): SiteFrame | null {
  const { plot, width, height, viewport: vp } = scene
  if (!plot) return null

  const facing = scene.plotFacing ?? DEFAULT_FACING
  const north = scene.northOffset ?? 0
  const inner = buildableRect(plot, facing, north)

  const project = (r: Rect): ScreenRect => {
    const a = worldToScreen({ x: r.minX, z: r.minZ }, vp, width, height)
    const b = worldToScreen({ x: r.maxX, z: r.maxZ }, vp, width, height)
    return { left: a.x, top: a.y, right: b.x, bottom: b.y }
  }

  return {
    plot,
    outer: project(plotRect(plot)),
    inner: inner === null ? null : project(inner),
    front: frontEdge(facing, north),
    offenders: new Set(
      wallsOutsideBuildable(scene.walls, inner).map((v) => v.wallId),
    ),
    blocked: inner === null,
  }
}

/** The plot boundary, its setbacks, and the area left to build on. */
function drawPlot(
  ctx: CanvasRenderingContext2D,
  scene: PlanScene,
  site: SiteFrame,
) {
  const { outer, inner } = site

  ctx.save()
  ctx.lineJoin = 'miter'

  if (inner) {
    ctx.fillStyle = COLORS.buildableFill
    ctx.fillRect(
      inner.left,
      inner.top,
      inner.right - inner.left,
      inner.bottom - inner.top,
    )
    // Hatched rather than simply tinted. Every named room already carries a
    // flat wash, so one more flat wash — under all of them — would read as
    // another room rather than as permission to build. A texture cannot.
    hatchRect(ctx, inner, scene.width, scene.height)

    traceRect(ctx, inner)
    // The setback line turns red with the walls it is being crossed by, so the
    // line and the wall accuse each other rather than the wall alone.
    ctx.strokeStyle =
      site.offenders.size > 0 ? COLORS.violation : COLORS.plotSetback
    ctx.lineWidth = 1.25
    ctx.setLineDash(PLOT.setbackDash)
    ctx.stroke()
    ctx.setLineDash([])
  }

  traceRect(ctx, outer)
  ctx.strokeStyle = COLORS.plotLine
  ctx.lineWidth = PLOT.boundaryWidthPx
  ctx.setLineDash(PLOT.boundaryDash)
  ctx.stroke()
  ctx.setLineDash([])

  drawPlotLabels(ctx, scene, site)
  ctx.restore()
}

/** Lays a screen-space box down as a closed path, ready to stroke or clip. */
function traceRect(ctx: CanvasRenderingContext2D, r: ScreenRect) {
  ctx.beginPath()
  ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top)
}

/**
 * Fills a box with 45° hatching at a constant on-screen pitch.
 *
 * The iteration is bounded by the canvas rather than by the box: zoomed in, the
 * buildable area is tens of thousands of pixels wide, and hatching all of it
 * would be thousands of strokes per frame to paint the handful that land on
 * screen. The clip does the rest.
 */
function hatchRect(
  ctx: CanvasRenderingContext2D,
  r: ScreenRect,
  width: number,
  height: number,
) {
  const box = {
    left: Math.max(r.left, 0),
    top: Math.max(r.top, 0),
    right: Math.min(r.right, width),
    bottom: Math.min(r.bottom, height),
  }
  if (box.right <= box.left || box.bottom <= box.top) return

  const span = box.bottom - box.top

  ctx.save()
  traceRect(ctx, box)
  ctx.clip()

  ctx.beginPath()
  // Each line runs down-right at 45°, so the run has to start a full box-height
  // to the left of the box to cover its bottom-left corner.
  for (let x = box.left - span; x <= box.right; x += PLOT.hatchPx) {
    ctx.moveTo(x, box.top)
    ctx.lineTo(x + span, box.bottom)
  }
  ctx.strokeStyle = COLORS.buildableHatch
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

/**
 * The plot's dimensions along its edges, plus a tag on the edge it fronts onto.
 *
 * The front tag earns its place: the setbacks are asymmetric, and without it
 * the drawing gives no reason why one inset is deeper than the other three.
 */
function drawPlotLabels(
  ctx: CanvasRenderingContext2D,
  scene: PlanScene,
  site: SiteFrame,
) {
  const { units } = scene
  const { outer, plot } = site
  const spanX = outer.right - outer.left
  const spanY = outer.bottom - outer.top
  const midX = (outer.left + outer.right) / 2
  const midY = (outer.top + outer.bottom) / 2

  ctx.font = LABEL_FONT
  const width = formatLength(plot.width, units)
  const depth = formatLength(plot.depth, units)

  if (fitsAlong(ctx, width, spanX)) {
    label(ctx, width, midX, outer.top - PLOT.labelOffsetPx, COLORS.plotLabel)
  }

  if (fitsAlong(ctx, depth, spanY)) {
    // Turned to run along the edge it measures, the same way a wall's dimension
    // rides its own wall.
    ctx.save()
    ctx.translate(outer.left - PLOT.labelOffsetPx, midY)
    ctx.rotate(readingAngle(0, 1))
    label(ctx, depth, 0, 0, COLORS.plotLabel)
    ctx.restore()
  }

  if (Math.min(spanX, spanY) < PLOT.minSpanPx * 2) return

  const inset = PLOT.tagInsetPx
  const tag: Record<PlanEdge, ScreenPoint> = {
    top: { x: midX, y: outer.top + inset },
    bottom: { x: midX, y: outer.bottom - inset },
    left: { x: outer.left + inset * 2, y: midY },
    right: { x: outer.right - inset * 2, y: midY },
  }
  label(ctx, 'FRONT', tag[site.front].x, tag[site.front].y, COLORS.plotLabel)
}

/** Whether a caption fits inside the run of edge it belongs to. */
function fitsAlong(
  ctx: CanvasRenderingContext2D,
  text: string,
  span: number,
): boolean {
  if (span < PLOT.minSpanPx) return false
  return ctx.measureText(text).width + PLOT.labelMarginPx * 2 <= span
}

/**
 * The walls straying outside the buildable area, called out on the drawing.
 *
 * Deliberately loud, and deliberately on the canvas rather than only in the
 * panel: this is the check that decides whether the design is legal to build,
 * and a warning you have to open a panel to find is a warning that gets missed.
 */
function drawPlotViolations(
  ctx: CanvasRenderingContext2D,
  scene: PlanScene,
  site: SiteFrame,
) {
  const { width, height, viewport: vp, walls } = scene
  const count = site.offenders.size
  if (count === 0 && !site.blocked) return

  ctx.save()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'

  for (const wall of walls) {
    if (!site.offenders.has(wall.id)) continue

    const a = worldToScreen(wall.start, vp, width, height)
    const b = worldToScreen(wall.end, vp, width, height)
    const stroke = wallStrokeWidth(wall, vp)

    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    // A halo first, then the wall itself repainted red on the same path: the
    // halo is what makes the offender findable when the plan is zoomed out far
    // enough that the wall is two pixels wide.
    ctx.strokeStyle = COLORS.violationGlow
    ctx.lineWidth = stroke + 8
    ctx.stroke()
    ctx.strokeStyle = COLORS.violation
    ctx.lineWidth = stroke
    ctx.stroke()
  }

  const text = site.blocked
    ? 'Setbacks leave no buildable area'
    : `${count} wall${count === 1 ? '' : 's'} outside the buildable area`

  // Clamped into the canvas, by the chip's own measured width: this is the
  // sentence that decides whether the design is legal, and a plot panned half
  // off screen must not be allowed to take its warning with it.
  ctx.font = LABEL_FONT
  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value))
  const margin = ctx.measureText(text).width / 2 + PLOT.warningMarginPx

  label(
    ctx,
    text,
    clamp((site.outer.left + site.outer.right) / 2, margin, width - margin),
    clamp(site.outer.top - PLOT.warningOffsetPx, 16, height - 16),
    COLORS.violation,
  )
  ctx.restore()
}

/**
 * The standard plan symbol for a flight: the outline, treads across it, and an
 * arrow running the way it climbs, marked UP.
 *
 * `rotation` is applied to the canvas exactly as furniture applies it, so the
 * two agree about which way an object faces. At zero the flight climbs toward
 * -z, which is up the page.
 */
function drawStairs(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const { width, height, viewport: vp, selection } = scene
  const stairs = scene.stairs
  if (!stairs || stairs.length === 0) return

  for (const stair of stairs) {
    const centre = worldToScreen(stair.position, vp, width, height)
    const across = stair.width * vp.scale
    const along = stair.run * vp.scale
    const selected =
      selection?.kind === 'stair' && selection.stairId === stair.id

    ctx.save()
    ctx.translate(centre.x, centre.y)
    ctx.rotate(stair.rotation)

    ctx.beginPath()
    ctx.rect(-across / 2, -along / 2, across, along)
    ctx.fillStyle = selected ? COLORS.stairSelectedFill : COLORS.stairFill
    ctx.strokeStyle = selected ? COLORS.selected : COLORS.stairEdge
    ctx.lineWidth = selected ? 2.5 : 1.4
    ctx.lineJoin = 'miter'
    ctx.fill()
    ctx.stroke()

    const going = along / TREAD_COUNT
    if (going >= STAIR.minTreadPx) {
      ctx.beginPath()
      // Interior lines only: the outline already draws the top and bottom
      // nosings, and doubling them would thicken both ends of the flight.
      for (let i = 1; i < TREAD_COUNT; i++) {
        const y = -along / 2 + going * i
        ctx.moveTo(-across / 2, y)
        ctx.lineTo(across / 2, y)
      }
      ctx.strokeStyle = COLORS.stairTread
      ctx.lineWidth = 1
      ctx.stroke()
    }

    drawAscentArrow(ctx, along, selected)
    ctx.restore()

    if (along < STAIR.minLabelPx) continue

    // UP is painted upright in screen space rather than turned with the flight,
    // for the reason the zone labels are: a staircase at 47° is still read by
    // someone holding their head straight.
    const cos = Math.cos(stair.rotation)
    const sin = Math.sin(stair.rotation)
    const foot = along / 2 + STAIR.labelGapPx
    label(
      ctx,
      'UP',
      centre.x - foot * sin,
      centre.y + foot * cos,
      selected ? COLORS.selected : COLORS.stairEdge,
    )
  }
}

/**
 * The staircase under `point`, tested against its rotated footprint.
 *
 * The same test `pickFurniture` runs, but a stair carries its own width and run
 * rather than looking them up in a catalogue, so there is no shared shape to
 * factor out — only a shared idea. It lives beside `drawStairs` because the two
 * have to agree: what you can click on is exactly the outline you can see, and
 * splitting them across modules is how that quietly stops being true.
 *
 * Later stairs win, matching draw order: the flight you see on top is the one
 * you select when two overlap.
 */
export function pickStair(stairs: Stair[], point: Point): Stair | null {
  for (let i = stairs.length - 1; i >= 0; i--) {
    const stair = stairs[i]

    // Rotate the point into the flight's own frame, then it is a plain
    // axis-aligned box test.
    const dx = point.x - stair.position.x
    const dz = point.z - stair.position.z
    const cos = Math.cos(-stair.rotation)
    const sin = Math.sin(-stair.rotation)
    const across = dx * cos - dz * sin
    const along = dx * sin + dz * cos

    if (
      Math.abs(across) <= stair.width / 2 &&
      Math.abs(along) <= stair.run / 2
    ) {
      return stair
    }
  }
  return null
}

/**
 * The arrow along the direction of ascent, drawn in the flight's own frame:
 * tail at the foot, head at the top step.
 */
function drawAscentArrow(
  ctx: CanvasRenderingContext2D,
  along: number,
  selected: boolean,
) {
  const tail = along / 2 - STAIR.arrowInsetPx
  const head = -along / 2 + STAIR.arrowInsetPx
  // A flight only a few pixels long on screen has no room for an arrow, and
  // half of one pointing the wrong way is worse than none.
  if (tail - head < STAIR.arrowHeadPx) return

  const wing = STAIR.arrowHeadPx * 0.55

  ctx.beginPath()
  ctx.moveTo(0, tail)
  ctx.lineTo(0, head)
  ctx.moveTo(-wing, head + STAIR.arrowHeadPx)
  ctx.lineTo(0, head)
  ctx.lineTo(wing, head + STAIR.arrowHeadPx)
  ctx.strokeStyle = selected ? COLORS.selected : COLORS.stairEdge
  ctx.lineWidth = selected ? 2 : 1.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()
}

/** A room's ring in screen pixels, with the box it occupies. */
type ScreenRoom = {
  points: ScreenPoint[]
  left: number
  right: number
  top: number
  bottom: number
}

/** Projects a room's polygon once, for the several passes that need it. */
function screenRoom(room: ResolvedRoom, scene: PlanScene): ScreenRoom | null {
  const { width, height, viewport: vp } = scene
  if (room.polygon.length < 3) return null

  const points = room.polygon.map((p) => worldToScreen(p, vp, width, height))
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)

  return {
    points,
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}

/**
 * The enclosure the selection points at, or null.
 *
 * A room selection carries a `RoomId` — the id of the LABEL the user picked.
 * The room itself is still re-derived from the walls on every edit and still
 * has no identity of its own; what persists is the name, and the highlight
 * follows whichever loop that name currently resolves to. So the fill stays on
 * the same space while its walls move around it, and goes out when the loop
 * opens, which is the honest signal that the space is no longer enclosed.
 *
 * (Before B7.1 the selection carried the clicked POINT and this matched by
 * containment. That could not tell two names in one open-plan enclosure apart.)
 */
function selectedRoom(scene: PlanScene): ResolvedRoom | null {
  return selectedRoomOf(scene.rooms, scene.selection)
}

/** Lays the room's ring down as a closed path, ready to fill or clip. */
function traceRoom(ctx: CanvasRenderingContext2D, sr: ScreenRoom) {
  tracePolygon(ctx, sr.points)
}

/** Lays a screen-space ring down as a closed path. */
function tracePolygon(ctx: CanvasRenderingContext2D, points: ScreenPoint[]) {
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.closePath()
}

/**
 * A tint per enclosed space, so the plan reads as rooms rather than as a mesh
 * of lines. Kept faint on purpose: the walls and the dimensions are the
 * drawing, and a fill loud enough to notice is a fill that competes with them.
 */
function drawRoomFills(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const chosen = selectedRoom(scene)

  ctx.save()
  // `rooms` comes back largest first, so a space enclosed by another paints
  // its own tint over the ring around it instead of under it.
  for (const room of scene.rooms) {
    const sr = screenRoom(room, scene)
    if (!sr) continue

    traceRoom(ctx, sr)
    ctx.fillStyle = room.label
      ? getRoomType(room.label.type).tint
      : COLORS.roomUnnamedFill
    ctx.fill()

    if (room === chosen) {
      ctx.fillStyle = COLORS.roomSelectedFill
      ctx.fill()
    }

    // An open space is the one room with no walls to draw its own edge.
    if (room.open) {
      ctx.setLineDash(OPEN_SPACE_DASH)
      ctx.strokeStyle = room === chosen ? COLORS.selected : COLORS.dimension
      ctx.lineWidth = room === chosen ? 2 : 1.25
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
  ctx.restore()
}

/**
 * The name and area of every space, plus the band that marks the selected one.
 *
 * A caption is only drawn when the room can actually hold it, measured rather
 * than guessed: zoomed out, a dozen captions overlapping each other and the
 * walls they belong to is far worse than none at all.
 */
function drawRoomCaptions(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const { width, height, viewport: vp, units } = scene
  const chosen = selectedRoom(scene)

  ctx.save()
  for (const room of scene.rooms) {
    const sr = screenRoom(room, scene)
    if (!sr) continue

    if (room === chosen) drawSelectionBand(ctx, sr)

    const at = worldToScreen(room.centroid, vp, width, height)
    const font = room.label ? ROOM_FONT : LABEL_FONT
    const color = room.label ? COLORS.roomName : COLORS.roomArea
    placeCaption(ctx, sr, at, captions(room, units), font, color)

    // Open-plan zones share this one enclosure, so each further name sits at
    // its own anchor rather than the room centroid, and shows the name alone —
    // the area above belongs to the whole space and is not repeated per zone.
    for (const extra of room.extraLabels) {
      const info = getRoomType(extra.type)
      const spot = worldToScreen(extra.anchor, vp, width, height)
      placeCaption(
        ctx,
        sr,
        spot,
        [[info.label], [info.short]],
        ROOM_FONT,
        COLORS.roomName,
      )
    }
  }
  ctx.restore()
}

/**
 * Draws a caption at a point inside a room, taking the longest of `options`
 * that fits the clear span through that point — or nothing, when even the
 * shortest would overhang the walls or the next zone.
 */
function placeCaption(
  ctx: CanvasRenderingContext2D,
  sr: ScreenRoom,
  at: ScreenPoint,
  options: string[][],
  font: string,
  color: string,
) {
  ctx.font = font
  const acrossPx = clearSpan(sr, at, 'x') - ROOM.marginPx * 2
  const downPx = clearSpan(sr, at, 'y')

  // Each option is a STACK of lines, tallest first. A stack has to fit both
  // ways: its widest line across, and its full height down — the vertical
  // check was already here for one line and now scales with the count, so a
  // room that could hold a name but not a name over its dimensions falls to
  // the shorter stack rather than overflowing into the walls.
  const stack = options.find(
    (lines) =>
      lines.every((line) => ctx.measureText(line).width <= acrossPx) &&
      downPx >= lines.length * ROOM.lineHeightPx + ROOM.marginPx,
  )
  if (!stack) return

  const top = at.y - ((stack.length - 1) * ROOM.lineHeightPx) / 2
  stack.forEach((line, i) => {
    label(ctx, line, at.x, top + i * ROOM.lineHeightPx, color, font)
  })
}

/**
 * What a room would like its caption to say, longest first — the caller takes
 * the first one that fits.
 *
 * An unnamed space offers only its area: it has to show the number, since
 * measuring the space is the whole point of detecting it, but it must not
 * borrow a name it was never given.
 */
function captions(room: ResolvedRoom, units: Unit): string[][] {
  const area = formatArea(room.area, units)
  if (!room.label) return [[area]]

  const full = roomDisplayName(room.label)
  // A custom name has no separate abbreviation, so it stands in for the short
  // form too; a typed type falls back to its catalogue short.
  const short = room.label.name?.trim() ? full : getRoomType(room.label.type).short

  const { width, length } = roomSize(room.polygon)
  const size = `${formatLength(width, units)} × ${formatLength(length, units)}`

  // B31 — the room's DIMENSIONS, which the 3D chip has always carried
  // (`RoomLabels.tsx`) and the canvas never did. It is the cheapest
  // dimensional check in the editor: 3.50 × 3.00 against 7.6 × 6.0 is
  // unmissable in a way that 45.7 m² is not, and a plan drawn 3× too big
  // satisfied every other criterion on the reference page.
  //
  // The size stack outranks the name-and-area line for that reason — the
  // dimensions are what catch a wrong building, and the area is what a wrong
  // building still looks plausible in. Every pre-B31 tier survives below,
  // unchanged, so a room too small for the stack degrades exactly as before.
  return [
    [full, size, area],
    [full, size],
    [`${full} — ${area}`],
    [`${short} — ${area}`],
    [short],
  ]
}

/**
 * How much clear room the caption has along one axis, in pixels: the span of
 * the space measured through the point the caption actually sits on, not the
 * span of its bounding box.
 *
 * An L-shaped room is far narrower where its label sits than the box suggests,
 * and a caption overhanging into the other leg — or through a wall — is worse
 * than no caption at all.
 */
function clearSpan(
  sr: ScreenRoom,
  at: { x: number; y: number },
  axis: 'x' | 'y',
): number {
  // The span along one axis is read off the line cut across the other.
  const cut = axis === 'x' ? 'y' : 'x'
  const hits: number[] = []

  for (let i = 0, j = sr.points.length - 1; i < sr.points.length; j = i++) {
    const a = sr.points[i]
    const b = sr.points[j]
    if (a[cut] > at[cut] === b[cut] > at[cut]) continue
    const t = (at[cut] - a[cut]) / (b[cut] - a[cut])
    hits.push(a[axis] + t * (b[axis] - a[axis]))
  }

  // Crossings pair up along the line, and the pair straddling the caption is
  // the run it has to fit inside.
  hits.sort((m, n) => m - n)
  for (let k = 0; k + 1 < hits.length; k += 2) {
    if (at[axis] >= hits[k] && at[axis] <= hits[k + 1]) {
      return hits[k + 1] - hits[k]
    }
  }

  // A caption landing exactly on an edge parallel to the cut crosses nothing.
  // The box is a coarse answer, but a better one than dropping the room's
  // area over a degenerate case.
  return axis === 'x' ? sr.right - sr.left : sr.bottom - sr.top
}

/**
 * Marks the selected room with a band just inside its outline.
 *
 * Stroking the outline itself would draw the band down the wall centrelines,
 * where the walls then cover it. So the polygon is clipped to itself and
 * stroked at twice the width: the outer half is thrown away and the whole band
 * lands inside the room, where it is visible whatever the walls are doing.
 */
function drawSelectionBand(ctx: CanvasRenderingContext2D, sr: ScreenRoom) {
  ctx.save()
  traceRoom(ctx, sr)
  ctx.clip()
  traceRoom(ctx, sr)
  ctx.strokeStyle = COLORS.roomSelectedBand
  ctx.lineWidth = ROOM.selectedBandPx * 2
  ctx.lineJoin = 'miter'
  ctx.stroke()
  ctx.restore()
}

/**
 * The Vastu nine-zone grid, drawn faintly over the plan.
 *
 * The cells arrive from `vastuZones` already carried back into world space, so
 * the grid turns with north without anything here knowing the angle — every
 * quad is just projected and stroked. The labels, by contrast, are painted
 * unrotated on purpose: the compass may sit at 47°, but text standing at 47° is
 * text nobody reads.
 */
function drawVastuGrid(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const cells = scene.vastuCells
  if (!cells || cells.length === 0) return

  const { width, height, viewport: vp } = scene
  const projected = cells.map((cell) => ({
    zone: cell.zone,
    points: cell.polygon.map((p) => worldToScreen(p, vp, width, height)),
    at: worldToScreen(cell.center, vp, width, height),
  }))

  ctx.save()
  ctx.lineWidth = 1
  ctx.lineJoin = 'miter'

  // The centre first: the tint goes under the grid so it covers no boundary,
  // and its finer dash is then crossed by the grid's own — the one place a
  // doubled stroke is wanted, since it is what gives the cell this ruleset asks
  // to be left open a heavier outline than its neighbours.
  const centre = projected.find((cell) => cell.zone === 'C')
  if (centre) {
    tracePolygon(ctx, centre.points)
    ctx.fillStyle = COLORS.vastuCentreFill
    ctx.fill()
    ctx.strokeStyle = COLORS.vastuCentreLine
    ctx.setLineDash(VASTU.centreDash)
    ctx.stroke()
  }

  ctx.beginPath()
  for (const [a, b] of gridLines(projected.map((cell) => cell.points))) {
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
  }
  ctx.strokeStyle = COLORS.vastuLine
  ctx.setLineDash(VASTU.dash)
  ctx.stroke()

  ctx.setLineDash([])
  ctx.font = VASTU_FONT
  ctx.fillStyle = COLORS.vastuLabel
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const cell of projected) {
    const room = insideSpan(cell.points)
    // Same bargain the dimensions strike: a label that does not fit its cell is
    // dropped rather than allowed to spill across the plan.
    const text = zoneCaptions(cell.zone).find(
      (option) =>
        Math.hypot(
          ctx.measureText(option).width + VASTU.marginPx * 2,
          VASTU.lineHeightPx,
        ) <= room,
    )
    if (!text) continue
    ctx.fillText(text, cell.at.x, cell.at.y)
  }

  ctx.restore()
}

/**
 * What a zone would like its label to say, longest first — the caller takes the
 * first that fits.
 *
 * Only the centre has a second form: `Brahmasthan` is the name this ruleset
 * gives that cell, and `C` is what survives once the cell is too small to hold
 * the word.
 */
function zoneCaptions(zone: VastuZone): string[] {
  return zone === 'C' ? ['Brahmasthan', 'C'] : [zone]
}

/**
 * The grid's boundaries, each one exactly once.
 *
 * Nine quads share twelve edges between them, and a shared edge stroked twice
 * paints at twice the intended weight — on an overlay this faint that alone
 * would make the inner lines the loudest thing on the drawing, and the two dash
 * runs would fill each other's gaps in. So edges are keyed by their endpoints
 * and the repeats dropped. Neighbours build a shared corner from the same
 * expression, so the keys match exactly today; the tenth-of-a-pixel rounding is
 * there so they still match if that ever stops being true.
 */
function gridLines(cells: ScreenPoint[][]): [ScreenPoint, ScreenPoint][] {
  const key = (p: ScreenPoint) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  const seen = new Set<string>()
  const lines: [ScreenPoint, ScreenPoint][] = []

  for (const points of cells) {
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [a, b] = [points[j], points[i]]
      const ends = [key(a), key(b)].sort()
      const id = `${ends[0]}|${ends[1]}`
      if (seen.has(id)) continue
      seen.add(id)
      lines.push([a, b])
    }
  }

  return lines
}

/**
 * The diameter of the largest circle that fits in a cell, in pixels: the
 * shorter of its two sides.
 *
 * A rotated cell holds a much smaller upright label than its side length
 * suggests, and this is the one bound that does not depend on the angle — a
 * label whose diagonal fits inside the circle fits the cell at any rotation.
 * Conservative at 0° and 90°, which costs a label only at the zoom where it was
 * about to touch the boundary anyway.
 */
function insideSpan(points: ScreenPoint[]): number {
  const a = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
  const b = Math.hypot(points[2].x - points[1].x, points[2].y - points[1].y)
  return Math.min(a, b)
}

/** Plan symbols for furniture: footprint box with a facing mark. */
function drawFurniture(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const { width, height, viewport: vp, furniture, selection } = scene

  for (const item of furniture) {
    const size = furnitureSize(item)
    const centre = worldToScreen(item.position, vp, width, height)
    const w = size.width * vp.scale
    const d = size.depth * vp.scale
    const selected =
      selection?.kind === 'furniture' && selection.furnitureId === item.id

    ctx.save()
    ctx.translate(centre.x, centre.y)
    // Screen +y is world +z, so a positive world rotation is a positive
    // canvas rotation — no sign flip needed here.
    ctx.rotate(item.rotation)

    ctx.fillStyle = selected ? COLORS.furnitureSelectedFill : COLORS.furnitureFill
    ctx.strokeStyle = selected ? COLORS.selected : COLORS.furnitureEdge
    ctx.lineWidth = selected ? 2 : 1.2
    ctx.beginPath()
    ctx.rect(-w / 2, -d / 2, w, d)
    ctx.fill()
    ctx.stroke()

    // Facing mark on the -z edge, matching where the 3D models put backs.
    ctx.beginPath()
    ctx.strokeStyle = selected ? COLORS.selected : COLORS.furnitureEdge
    ctx.lineWidth = selected ? 3 : 2
    ctx.moveTo(-w / 2 + 2, -d / 2 + 1.5)
    ctx.lineTo(w / 2 - 2, -d / 2 + 1.5)
    ctx.stroke()

    ctx.restore()
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const { width, height, viewport: vp } = scene
  const bounds = visibleBounds(vp, width, height)

  const lines = (step: number, color: string, lineWidth: number) => {
    if (step * vp.scale < MIN_GRID_SPACING_PX) return

    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth

    for (
      let x = Math.floor(bounds.left / step) * step;
      x <= bounds.right;
      x += step
    ) {
      // The half-pixel offset lands the stroke on a pixel centre, so thin
      // lines render crisp instead of blurred across two pixels.
      const sx = Math.round(worldToScreen({ x, z: 0 }, vp, width, height).x) + 0.5
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, height)
    }

    for (
      let z = Math.floor(bounds.top / step) * step;
      z <= bounds.bottom;
      z += step
    ) {
      const sy = Math.round(worldToScreen({ x: 0, z }, vp, width, height).y) + 0.5
      ctx.moveTo(0, sy)
      ctx.lineTo(width, sy)
    }

    ctx.stroke()
  }

  // The drawn grid has to match what the cursor snaps to, or the lines are
  // telling the user something the tool will not honour.
  const step = GRID_STEP[scene.units]
  lines(step.cell, COLORS.gridMinor, 1)
  lines(step.section, COLORS.gridMajor, 1)

  // World origin.
  const origin = worldToScreen({ x: 0, z: 0 }, vp, width, height)
  ctx.beginPath()
  ctx.strokeStyle = COLORS.axis
  ctx.lineWidth = 1.25
  ctx.moveTo(Math.round(origin.x) + 0.5, 0)
  ctx.lineTo(Math.round(origin.x) + 0.5, height)
  ctx.moveTo(0, Math.round(origin.y) + 0.5)
  ctx.lineTo(width, Math.round(origin.y) + 0.5)
  ctx.stroke()
}

/**
 * The wall's thickness in screen pixels, floored so it stays visible.
 *
 * The floor is a DRAWING-AID, not geometry: at 20 px/m a 115 mm partition is
 * 2.3 px and at a zoomed-out 5 px/m it is 0.6 px, which would vanish. Openings
 * are punched to this same width so a punch can never be narrower than the
 * body it is clearing.
 */
const wallStrokeWidth = (wall: Wall, vp: Viewport) =>
  Math.max(2, wall.thickness * vp.scale)

/**
 * B26 — filled wall bodies, from the same `wallBodyQuad` the PDF sheet uses.
 *
 * Until now this stroked a butt-capped centreline and dropped a 2.5 px dot on
 * every vertex to mask the square notch two butting walls leave at a corner.
 * The dot is gone: it existed only to hide the overlap the pad now fills, and
 * leaving it would have put a blob on top of a join that is finally correct.
 *
 * The faces are stroked as well as filled — one device covering two needs. A
 * real plan draws its wall faces, and below about 2 px of projected thickness
 * the fill alone would disappear at low zoom.
 */
function drawWalls(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const { width, height, viewport: vp, walls, selection } = scene
  const shared = sharedEnds(walls)

  for (const wall of walls) {
    const quad = wallBodyQuad(wall, shared)
    if (!quad) continue
    const selected = selection?.kind === 'wall' && selection.wallId === wall.id
    const corners = quad.map((p) => worldToScreen(p, vp, width, height))

    ctx.beginPath()
    ctx.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y)
    ctx.closePath()

    ctx.fillStyle = selected ? COLORS.selected : COLORS.wallFill
    ctx.fill()
    ctx.strokeStyle = selected ? COLORS.selected : COLORS.wallFill
    ctx.lineWidth = 1
    ctx.lineJoin = 'miter'
    ctx.stroke()
  }

  for (const wall of walls) {
    for (const opening of wall.openings) {
      drawOpening(ctx, scene, wall, opening)
    }
  }
}

/**
 * Draws an opening by punching the wall's own colour back out to the
 * background, then adding the plan symbol: a swing arc for a door, a glazing
 * line for a window.
 */
function drawOpening(
  ctx: CanvasRenderingContext2D,
  scene: PlanScene,
  wall: Wall,
  opening: Opening,
) {
  const { width, height, viewport: vp, selection } = scene
  const selected =
    selection?.kind === 'opening' && selection.openingId === opening.id

  const half = opening.width / 2
  const jambA = pointAlongWall(wall, opening.position - half)
  const jambB = pointAlongWall(wall, opening.position + half)
  const a = worldToScreen(jambA, vp, width, height)
  const b = worldToScreen(jambB, vp, width, height)
  const stroke = wallStrokeWidth(wall, vp)

  // Clear the wall across the opening's span.
  ctx.beginPath()
  ctx.strokeStyle = COLORS.background
  // Slightly over-wide so no sliver of wall survives at the edges.
  ctx.lineWidth = stroke + 1
  ctx.lineCap = 'butt'
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()

  const symbolColor = selected ? COLORS.selected : COLORS.opening
  const widthPx = Math.hypot(b.x - a.x, b.y - a.y)

  if (opening.type === 'door') {
    // The leaf hangs where the MODEL says, not where this renderer prefers.
    // Until v4 the hinge was always jamb A and the arc always swept one way,
    // here and in `planSheet.ts` and in `DoorLeaves.tsx` — three copies of a
    // convention no user could change. See `doorSwing`.
    const swing = doorSwing(wall, opening)
    const h = worldToScreen(swing.hinge, vp, width, height)
    const f = worldToScreen(swing.free, vp, width, height)
    const along = Math.atan2(f.y - h.y, f.x - h.x)
    // Screen +y is world +z, so local -Y in this rotated frame is the
    // sweep direction when `sweep` is +1, and local +Y when it is -1.
    const quarter = (-Math.PI / 2) * swing.sweep

    ctx.save()
    ctx.translate(h.x, h.y)
    ctx.rotate(along)

    ctx.beginPath()
    ctx.strokeStyle = symbolColor
    ctx.lineWidth = selected ? 2.5 : 1.6
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -widthPx * swing.sweep)
    ctx.stroke()

    ctx.beginPath()
    ctx.strokeStyle = symbolColor
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.55
    // A quarter turn either side of the closed position, ordered low-to-high
    // so the default (anticlockwise: false) sweeps the short way round.
    ctx.arc(0, 0, widthPx, Math.min(0, quarter), Math.max(0, quarter))
    ctx.stroke()
    ctx.restore()
  } else if (opening.type === 'window') {
    // Glazing: a thin PAIR of lines set in from the wall faces, which is the
    // standard plan symbol and what the sheet has always drawn. Until B26 this
    // was a single line down the centre of the opening — indistinguishable
    // from a wall struck through, and the one place a window did not read as
    // a window. `glazingLines` returns world metres; the projection is ours.
    ctx.beginPath()
    ctx.strokeStyle = symbolColor
    ctx.lineWidth = selected ? 2 : 1
    for (const [from, to] of glazingLines(wall, opening)) {
      const p = worldToScreen(from, vp, width, height)
      const q = worldToScreen(to, vp, width, height)
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
    }
    ctx.stroke()
  }
  // A cased opening gets NEITHER, and that is the whole symbol: the wall
  // cleared across the span above, closed off by the jamb ticks below. Written
  // as an explicit `else if` on `'window'` rather than a bare `else`, because
  // a bare `else` is what silently drew a glazing line through every cased
  // opening the moment `OpeningType` widened.

  // Jamb ticks, so the opening's extent stays readable at any zoom.
  ctx.beginPath()
  ctx.strokeStyle = symbolColor
  ctx.lineWidth = selected ? 3 : 1.5
  for (const p of [a, b]) {
    const nx = (b.y - a.y) / (widthPx || 1)
    const ny = -(b.x - a.x) / (widthPx || 1)
    ctx.moveTo(p.x - (nx * stroke) / 2, p.y - (ny * stroke) / 2)
    ctx.lineTo(p.x + (nx * stroke) / 2, p.y + (ny * stroke) / 2)
  }
  ctx.stroke()

  if (selected) {
    ctx.beginPath()
    ctx.strokeStyle = COLORS.selected
    ctx.lineWidth = 1.5
    ctx.setLineDash([4, 3])
    ctx.arc(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      widthPx / 2 + 7,
      0,
      Math.PI * 2,
    )
    ctx.stroke()
    ctx.setLineDash([])
  }
}

/** One per-wall dimension, fully placed and ready to paint. */
export type WallDimension = {
  /** Witnesses, line, ticks — one stroked path, in this order. */
  segments: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>
  label: { text: string; x: number; y: number; angle: number }
  box: LabelBox
}

/**
 * Whether a wall's full run is already stated by a chain bay or an overall of
 * the same axis (finding 52 decision e, switched ON by B35).
 *
 * Same SPAN, not merely equal length: the bay between two adjacent stations
 * must sit on the wall's own endpoints, so an unrelated wall of coincidental
 * length elsewhere keeps its label. Matching is within `JOIN_TOLERANCE` —
 * SD22's "is this the same point?" question, asked of stations.
 *
 * The bay's LABEL can still be dropped by its own fit rule at extreme zoom
 * while this suppression holds — accepted: the per-wall label's stricter
 * margin drops at nearly the same width, the dimension apparatus at that size
 * is noise either way, and zooming in restores both. Coupling this test to
 * which bay labels actually fit would tie the two builders together for a
 * sub-50-px window.
 */
function coveredByRun(wall: Wall, runs: DimensionRun[]): boolean {
  const dx = Math.abs(wall.end.x - wall.start.x)
  const dz = Math.abs(wall.end.z - wall.start.z)
  // The same millimetre the chain's own station collection uses; an oblique
  // wall is never chain-covered and always keeps its label.
  const axis = dz <= 0.001 && dx > 0.001 ? 'x' : dx <= 0.001 && dz > 0.001 ? 'z' : null
  if (!axis) return false

  const s = axis === 'x' ? wall.start.x : wall.start.z
  const e = axis === 'x' ? wall.end.x : wall.end.z
  const lo = Math.min(s, e)
  const hi = Math.max(s, e)

  for (const run of runs) {
    if (run.axis !== axis) continue
    for (let i = 0; i < run.stations.length - 1; i++) {
      if (
        Math.abs(run.stations[i] - lo) <= JOIN_TOLERANCE &&
        Math.abs(run.stations[i + 1] - hi) <= JOIN_TOLERANCE
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Every per-wall dimension that will actually be painted, after the two B35
 * suppressions. Pure and exported so the acceptance can be asserted on the
 * COMPUTED boxes rather than by eye.
 *
 * ── Suppression 1: chain coverage ──
 * A wall whose full run is a chain bay says nothing the chain does not; its
 * whole dimension (line, witnesses, ticks, label) is dropped, not the text
 * alone — apparatus without a reading is clutter, the same reasoning as the
 * long-standing fits-its-own-run rule.
 *
 * ── Suppression 2: label collision ──
 * Survivors yield to the chains (the statement of record) and then to each
 * other, in priority order: the SELECTED wall first and unconditionally —
 * selection is the user asking, and it bypasses both suppressions — then
 * shell before partition (the reference dimensions the envelope, not every
 * subdivision), then the longer run (the shorter span is the one most often
 * inferable from its neighbours), then id, so two identical plans always
 * drop the same label (L6).
 *
 * `measure` is the ONE text measurement per wall per frame — the same call
 * the fit rule has always made, now also feeding the collision box. §9.2
 * already flags measureText per wall as a cost; this adds no second one.
 */
export function buildWallDimensions(
  scene: PlanScene,
  measure: (text: string) => number,
  obstacles: readonly LabelBox[],
): WallDimension[] {
  const { width, height, viewport: vp, walls, units } = scene
  const bounds = planBounds(walls)
  if (!bounds) return []

  const middle = worldToScreen(bounds.center, vp, width, height)
  const runs = dimensionRuns(walls)
  const selectedId =
    scene.selection?.kind === 'wall' ? scene.selection.wallId : null

  const selected: WallDimension[] = []
  const candidates: Array<{ dim: WallDimension; wall: Wall; lengthM: number }> = []

  for (const wall of walls) {
    const a = worldToScreen(wall.start, vp, width, height)
    const b = worldToScreen(wall.end, vp, width, height)
    const span = Math.hypot(b.x - a.x, b.y - a.y)
    if (span < DIMENSION.minWallPx) continue

    const lengthM = distance(wall.start, wall.end)
    const text = formatLengthCompact(lengthM, units)
    const textWidth = measure(text)
    // A label wider than the run it measures reads as a collision, not a
    // dimension — better to say nothing than to stack text across the plan.
    if (textWidth + DIMENSION.labelMarginPx * 2 > span) continue

    const isSelected = wall.id === selectedId
    if (!isSelected && coveredByRun(wall, runs)) continue

    const ux = (b.x - a.x) / span
    const uy = (b.y - a.y) / span
    const n = outwardNormal(ux, uy, {
      x: (a.x + b.x) / 2 - middle.x,
      y: (a.y + b.y) / 2 - middle.y,
    })

    const at = (p: { x: number; y: number }, out: number) => ({
      x: p.x + n.x * out,
      y: p.y + n.y * out,
    })
    const from = at(a, DIMENSION.offsetPx)
    const to = at(b, DIMENSION.offsetPx)

    const segments: WallDimension['segments'] = []
    for (const end of [a, b]) {
      segments.push({
        from: at(end, DIMENSION.gapPx),
        to: at(end, DIMENSION.offsetPx + DIMENSION.overshootPx),
      })
    }
    segments.push({ from, to })
    // Ticks bisect the wall direction and the offset direction, which is the
    // surveyor's slash rather than an arrowhead — it survives short runs.
    const tx = ((ux + n.x) / Math.SQRT2) * DIMENSION.tickPx
    const ty = ((uy + n.y) / Math.SQRT2) * DIMENSION.tickPx
    for (const end of [from, to]) {
      segments.push({
        from: { x: end.x - tx, y: end.y - ty },
        to: { x: end.x + tx, y: end.y + ty },
      })
    }

    const cx = (from.x + to.x) / 2
    const cy = (from.y + to.y) / 2
    const angle = readingAngle(ux, uy)
    const dim: WallDimension = {
      segments,
      label: { text, x: cx, y: cy, angle },
      // The chip `label()` paints: measured text plus its padding each side.
      box: {
        cx,
        cy,
        w: textWidth + LABEL_CHIP.padding * 2,
        h: LABEL_CHIP.height,
        angle,
      },
    }

    if (isSelected) selected.push(dim)
    else candidates.push({ dim, wall, lengthM })
  }

  candidates.sort(
    (p, q) =>
      (p.wall.type === q.wall.type ? 0 : p.wall.type === 'shell' ? -1 : 1) ||
      q.lengthM - p.lengthM ||
      (p.wall.id < q.wall.id ? -1 : p.wall.id > q.wall.id ? 1 : 0),
  )

  const placed = placeBoxes(
    [...obstacles, ...selected.map((d) => d.box)],
    candidates.map((c) => ({ box: c.dim.box, item: c.dim })),
  )
  return [...selected, ...placed]
}

/**
 * An architectural dimension per wall: a line held off the wall, a witness
 * line dropped at each end, 45° ticks, and the length riding on the line —
 * for the walls B35's two suppressions leave standing (see
 * `buildWallDimensions`). Screen pixels throughout, so the annotation keeps a
 * constant weight while the building zooms.
 */
function drawDimensions(
  ctx: CanvasRenderingContext2D,
  scene: PlanScene,
  obstacles: readonly LabelBox[],
) {
  ctx.save()
  ctx.font = LABEL_FONT
  ctx.lineCap = 'butt'
  ctx.setLineDash([])

  const dims = buildWallDimensions(
    scene,
    (text) => ctx.measureText(text).width,
    obstacles,
  )

  for (const dim of dims) {
    ctx.beginPath()
    ctx.strokeStyle = COLORS.dimension
    ctx.lineWidth = 1
    for (const seg of dim.segments) {
      ctx.moveTo(seg.from.x, seg.from.y)
      ctx.lineTo(seg.to.x, seg.to.y)
    }
    ctx.stroke()

    ctx.save()
    ctx.translate(dim.label.x, dim.label.y)
    ctx.rotate(dim.label.angle)
    label(ctx, dim.label.text, 0, 0, COLORS.dimensionLabel)
    ctx.restore()
  }

  ctx.restore()
}

/**
 * Door and window widths, labelled on the plan — but only when the Dimensions
 * switch is on. Wall lengths are always strung outside the building by
 * `drawDimensions`; opening widths sit just inside the wall, on the room side,
 * so the two never fight for the same strip of paper. Off by default because a
 * plan busy with openings would drown in width tags no one asked for.
 */
function drawOpeningDimensions(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  if (!scene.showDimensions) return

  const { width, height, viewport: vp, walls, units } = scene
  const bounds = planBounds(walls)
  if (!bounds) return

  const middle = worldToScreen(bounds.center, vp, width, height)

  ctx.save()
  ctx.font = LABEL_FONT
  ctx.setLineDash([])

  for (const wall of walls) {
    for (const opening of wall.openings) {
      const half = opening.width / 2
      const a = worldToScreen(
        pointAlongWall(wall, opening.position - half),
        vp,
        width,
        height,
      )
      const b = worldToScreen(
        pointAlongWall(wall, opening.position + half),
        vp,
        width,
        height,
      )
      const span = Math.hypot(b.x - a.x, b.y - a.y)
      if (span < DIMENSION.minWallPx) continue

      // The mark leads when there is one: on a real drawing the schedule key
      // is what identifies the unit and the width merely describes it.
      const size = formatLengthCompact(opening.width, units)
      const text = opening.mark ? `${opening.mark} ${size}` : size
      // Same rule as the wall dimensions: a tag wider than the opening it
      // measures reads as a collision, so it is dropped rather than stacked.
      if (ctx.measureText(text).width + DIMENSION.labelMarginPx * 2 > span) {
        continue
      }

      const ux = (b.x - a.x) / span
      const uy = (b.y - a.y) / span
      // Inward — the opposite of the wall dimension's outward side — so opening
      // widths land inside the room, clear of the lengths strung outside.
      const out = outwardNormal(ux, uy, {
        x: (a.x + b.x) / 2 - middle.x,
        y: (a.y + b.y) / 2 - middle.y,
      })
      const mx = (a.x + b.x) / 2 - out.x * DIMENSION.openingOffsetPx
      const my = (a.y + b.y) / 2 - out.y * DIMENSION.openingOffsetPx

      ctx.save()
      ctx.translate(mx, my)
      ctx.rotate(readingAngle(ux, uy))
      label(ctx, text, 0, 0, COLORS.dimensionLabel)
      ctx.restore()
    }
  }

  ctx.restore()
}

/**
 * The strung dimension chains and the overall extents, outside the building.
 *
 * This is what the reference drawing carries and the per-wall labels above do
 * not: one run per side whose stations are the interior partitions reaching
 * that side (3.00/3.00/3.00 across the top of the reference), plus an overall
 * per axis. The GEOMETRY comes from `dimensionRuns` and the ink goes through
 * `strokeRunInk` — the same routine the printable sheet's overalls use — so
 * the canvas cannot drift from the sheet the way the three renderers once
 * drifted from each other (B26).
 *
 * Setout: the chain sits `CHAIN.offsetPx` beyond the CLEARANCE extent on its
 * side, and an overall sharing a side with a chain moves out one more tier —
 * a reader must see 9.00 as the extent and 3.00/3.00/3.00 as its parts, never
 * one merged run. Witness lines drop from the building edge, through whatever
 * clearance pushed the line out, and past it by the overshoot; that a witness
 * crosses a door swing is normal drafting — the LABELS never do, because they
 * ride on lines set out beyond the swing.
 *
 * Labels use `formatLength`, not the compact form: the chain is the drawing's
 * statement of record and reads `3.00 m` like the reference, while the
 * per-wall chips keep their compact style — one more cue that the two are
 * different annotations while both remain on screen.
 */
/**
 * The chains' ink and the screen boxes their labels occupy, built pure so the
 * boxes can serve as collision obstacles (B35) and be asserted on in tests.
 * `measure` is the caller's text measurement — one call per bay, as before.
 */
export function buildChainInks(
  scene: PlanScene,
  measure: (text: string) => number,
): { inks: RunInk[]; labelBoxes: LabelBox[] } {
  const { width, height, viewport: vp, walls, units } = scene
  const inks: RunInk[] = []
  const labelBoxes: LabelBox[] = []
  const runs = dimensionRuns(walls)
  if (runs.length === 0) return { inks, labelBoxes }
  const bounds = planBounds(walls)
  if (!bounds) return { inks, labelBoxes }
  const clear = clearanceExtent(walls, scene.furniture) ?? bounds

  const project = (p: Point) => worldToScreen(p, vp, width, height)
  const bMin = project(bounds.min)
  const bMax = project(bounds.max)
  const cMin = project(clear.min)
  const cMax = project(clear.max)

  // Which sides carry a chain, so an overall on the same side takes tier two.
  const chained = new Set(
    runs.filter((r) => r.kind === 'chain').map((r) => `${r.axis}:${r.side}`),
  )

  for (const run of runs) {
    const tier =
      run.kind === 'overall' && chained.has(`${run.axis}:${run.side}`) ? 1 : 0
    const out = CHAIN.offsetPx + tier * CHAIN.tierPx
    // Outward sign: 'min' sides grow toward smaller screen coordinates.
    const dir = run.side === 'min' ? -1 : 1

    // Station positions in screen pixels, along the run's own screen axis.
    const stations = run.stations.map((s) =>
      run.axis === 'x'
        ? project({ x: s, z: 0 }).x
        : project({ x: 0, z: s }).y,
    )
    const first = stations[0]
    const last = stations[stations.length - 1]

    // The line's cross-axis position: set out from the clearance edge. The
    // witness starts at the BUILDING edge — the run measures the building,
    // whatever pushed its line further out.
    const clearEdge =
      run.axis === 'x'
        ? run.side === 'min' ? cMin.y : cMax.y
        : run.side === 'min' ? cMin.x : cMax.x
    const buildingEdge =
      run.axis === 'x'
        ? run.side === 'min' ? bMin.y : bMax.y
        : run.side === 'min' ? bMin.x : bMax.x
    const line = clearEdge + dir * out

    const ink: RunInk = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, segments: [], labels: [] }
    const point = (alongPx: number, crossPx: number) =>
      run.axis === 'x' ? { x: alongPx, y: crossPx } : { x: crossPx, y: alongPx }

    ink.a = point(first, line)
    ink.b = point(last, line)
    for (const s of stations) {
      ink.segments.push({
        from: point(s, buildingEdge + dir * CHAIN.gapPx),
        to: point(s, line + dir * CHAIN.overshootPx),
      })
      // The surveyor's slash, the same stroke at every station on both axes.
      const p = point(s, line)
      ink.segments.push({
        from: { x: p.x - CHAIN.tickPx, y: p.y + CHAIN.tickPx },
        to: { x: p.x + CHAIN.tickPx, y: p.y - CHAIN.tickPx },
      })
    }

    for (let i = 0; i < run.stations.length - 1; i++) {
      const text = formatLength(run.stations[i + 1] - run.stations[i], units)
      const textWidth = measure(text)
      const span = Math.abs(stations[i + 1] - stations[i])
      // A label wider than its bay reads as a collision, not a dimension —
      // the same bargain the per-wall labels strike.
      if (textWidth + CHAIN.labelMarginPx * 2 > span) continue

      const mid = (stations[i] + stations[i + 1]) / 2
      if (run.axis === 'x') {
        // Above its line on both sides — the sheet's own convention.
        ink.labels.push({ text, x: mid, y: line - CHAIN.textGapPx })
        labelBoxes.push({
          cx: mid,
          // Baseline 'bottom': the glyphs sit wholly above the anchor.
          cy: line - CHAIN.textGapPx - CHAIN_LABEL_H / 2,
          w: textWidth,
          h: CHAIN_LABEL_H,
          angle: 0,
        })
      } else {
        // Rotated to read bottom-to-top; on the left the glyphs hang toward
        // -x (baseline 'bottom'), on the right toward +x ('top'), so the text
        // always sits on the outside of its own line.
        const lx = line + dir * CHAIN.textGapPx
        ink.labels.push({
          text,
          x: lx,
          y: mid,
          angle: -Math.PI / 2,
          baseline: run.side === 'min' ? 'bottom' : 'top',
        })
        labelBoxes.push({
          // The glyphs extend from the baseline toward the outside of the
          // line — the same side `dir` points.
          cx: lx + (dir * CHAIN_LABEL_H) / 2,
          cy: mid,
          w: textWidth,
          h: CHAIN_LABEL_H,
          angle: -Math.PI / 2,
        })
      }
    }

    inks.push(ink)
  }

  return { inks, labelBoxes }
}

/**
 * Paints the chains and hands back their label boxes — the obstacles every
 * per-wall label must yield to. The chains are painted regardless: they are
 * the statement of record (finding 52), and nothing outranks them.
 */
function drawDimensionChains(
  ctx: CanvasRenderingContext2D,
  scene: PlanScene,
): LabelBox[] {
  ctx.save()
  ctx.font = LABEL_FONT
  ctx.strokeStyle = COLORS.dimension
  ctx.fillStyle = COLORS.dimensionLabel
  ctx.lineWidth = 1
  ctx.lineCap = 'butt'
  ctx.setLineDash([])

  const { inks, labelBoxes } = buildChainInks(
    scene,
    (text) => ctx.measureText(text).width,
  )
  for (const ink of inks) strokeRunInk(ctx, ink)

  ctx.restore()
  return labelBoxes
}

/**
 * The unit normal to put the dimension on: whichever side faces away from the
 * middle of the plan, so annotation lands outside the building instead of
 * through its rooms.
 *
 * A wall straddling that middle — a lone wall is always its own centre — has no
 * outside, so the tie falls to screen-down, then screen-right. Arbitrary, but it
 * has to be decided here rather than left to the sign of a near-zero dot, or the
 * side would jitter from one repaint to the next.
 */
function outwardNormal(
  ux: number,
  uy: number,
  away: { x: number; y: number },
): { x: number; y: number } {
  const nx = -uy
  const ny = ux
  const facing = nx * away.x + ny * away.y
  const flip = (keep: boolean) =>
    keep ? { x: nx, y: ny } : { x: -nx, y: -ny }

  if (Math.abs(facing) > OUTWARD_EPSILON_PX) return flip(facing > 0)
  return flip(ny !== 0 ? ny > 0 : nx > 0)
}

/**
 * Rotation that runs text along a dimension line without ever standing it on
 * its head: past vertical, the line is read from the other end.
 */
function readingAngle(ux: number, uy: number): number {
  const angle = Math.atan2(uy, ux)
  return Math.abs(angle) > Math.PI / 2 ? angle + Math.PI : angle
}

/**
 * Draggable endpoint handles on the selected wall.
 *
 * ── Told apart from B28's snap markers, which sit in the same places ──
 * A handle is a CONTROL on the current selection; a snap marker is a TARGET
 * the pointer has found. So a handle is a filled circle in the selection
 * colour, and the markers stay amber squares, triangles and rings. Both need
 * the same paper halo, because both are drawn on a wall's centreline, which is
 * inside the wall body and therefore always over dark poché — the lesson B28's
 * first rendered frame taught.
 *
 * When both are on screen the snap marker is drawn AFTER, so the target wins:
 * during a drag, where the endpoint is GOING matters more than where the grab
 * started.
 *
 * ── Refusal is drawn, not just returned ──
 * At a junction of three or more the handle turns red and says how many walls
 * meet there. It appears the instant the handle is pressed, because
 * `grabEndpoint` asks before the drag begins — a drag that silently does
 * nothing reads as a broken app.
 */
function drawEndpointHandles(
  ctx: CanvasRenderingContext2D,
  scene: PlanScene,
  handles: { wallId: string; blocked: number; which?: 'start' | 'end' },
) {
  const { width, height, viewport: vp } = scene
  const wall = scene.walls.find((w) => w.id === handles.wallId)
  if (!wall) return

  // Only the endpoint that was GRABBED is blocked. Reddening both would say
  // the wall cannot be moved at all, when the other end is usually free —
  // which the first rendered frame of this feature showed doing exactly that.
  const blockedEnd = handles.blocked > 0 ? handles.which : undefined

  for (const which of ['start', 'end'] as const) {
    const p = worldToScreen(wall[which], vp, width, height)
    const blocked = which === blockedEnd

    ctx.beginPath()
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
    ctx.strokeStyle = COLORS.snapHalo
    ctx.lineWidth = 4
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
    ctx.fillStyle = blocked ? COLORS.handleBlockedFill : COLORS.handleFill
    ctx.fill()
    ctx.strokeStyle = blocked ? COLORS.handleBlocked : COLORS.handle
    ctx.lineWidth = 1.75
    ctx.stroke()
  }

  if (blockedEnd) {
    // At the endpoint the hand is on. Drawing it at `wall.start` regardless —
    // which the first build did — puts the explanation up to a wall's length
    // away from the thing it explains.
    const p = worldToScreen(wall[blockedEnd], vp, width, height)
    label(
      ctx,
      `${handles.blocked} walls meet here — move them apart first`,
      p.x,
      p.y - 18,
      '#ffffff',
      LABEL_FONT,
      COLORS.handleBlocked,
    )
  }
}

/**
 * The snap indicator: a distinct shape per target kind, at the target.
 *
 * Distinct shapes rather than one marker in four colours, because the four
 * targets mean different things and the user has to be able to AVOID the one
 * they did not want — a snap you cannot tell apart is a snap you cannot
 * refuse. The shapes are the drafting conventions: a square for a vertex, a
 * triangle for a midpoint, a circle for a point on a line, and a diamond for
 * a face-caught aim (B34).
 *
 * The diamond sits at the COMMITTED point — the centreline behind the face —
 * not under the cursor. That gap IS the communication: the user aims at the
 * drawn edge and the marker shows, before the click, that the endpoint lands
 * on the centreline where the join actually closes. A marker at the cursor
 * would promise a landing the commit would then not honour.
 *
 * Drawn last, over the walls and over the draft rubber-band, because it is the
 * thing being aimed at.
 */
function drawSnapIndicator(
  ctx: CanvasRenderingContext2D,
  scene: PlanScene,
  snap: SnapTarget,
) {
  const { width, height, viewport: vp } = scene
  const p = worldToScreen(snap.point, vp, width, height)
  const r = 6

  // The shape, traced once and stroked twice.
  //
  // Every one of these targets lies ON a wall's centreline, which is INSIDE
  // the wall body — so the marker is always drawn over dark poché, never over
  // paper. Looking at the first build showed exactly that: the midpoint
  // triangle was legible only where its tip cleared the wall. The halo is a
  // wide paper-coloured stroke laid down first, so the marker reads against
  // the wall it is necessarily sitting on.
  // Every kind named, none left to a bare `else` — SD16: a fifth kind must be
  // a compile error here (the `Record` in snap.ts), never a silent circle.
  const trace = () => {
    ctx.beginPath()
    if (snap.kind === 'endpoint') {
      ctx.rect(p.x - r, p.y - r, r * 2, r * 2)
    } else if (snap.kind === 'midpoint') {
      ctx.moveTo(p.x, p.y - r)
      ctx.lineTo(p.x + r, p.y + r * 0.7)
      ctx.lineTo(p.x - r, p.y + r * 0.7)
      ctx.closePath()
    } else if (snap.kind === 'centreline') {
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    } else if (snap.kind === 'face') {
      ctx.moveTo(p.x, p.y - r * 1.2)
      ctx.lineTo(p.x + r * 1.2, p.y)
      ctx.lineTo(p.x, p.y + r * 1.2)
      ctx.lineTo(p.x - r * 1.2, p.y)
      ctx.closePath()
    }
  }

  ctx.save()
  trace()
  ctx.strokeStyle = COLORS.snapHalo
  ctx.lineWidth = 4.5
  ctx.stroke()

  trace()
  ctx.fillStyle = COLORS.snapFill
  ctx.fill()
  ctx.strokeStyle = COLORS.snap
  ctx.lineWidth = 1.75
  ctx.stroke()
  ctx.restore()
}

function drawDraft(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const { width, height, viewport: vp, anchor, cursor } = scene
  if (!anchor) return

  const a = worldToScreen(anchor, vp, width, height)

  if (cursor) {
    const b = worldToScreen(cursor, vp, width, height)

    ctx.save()
    ctx.beginPath()
    ctx.strokeStyle = COLORS.draft
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.restore()

    const length = distance(anchor, cursor)

    /*
     * The length reads out at the midpoint of the draft, and the typed field
     * REPLACES it in the same place.
     *
     * That position is the argument. The user is watching this number change
     * as they move — it is already where their eye is, and it is anchored to
     * the segment rather than to the pointer, so it does not jitter with the
     * mouse. A status-bar field would split their attention between the line
     * they are drawing and a corner of the chrome; a field pinned to the
     * cursor would put the LENGTH control on top of the DIRECTION control and
     * move it on every mouse motion.
     *
     * Typing swaps a readout for an input, so it has to LOOK like one: a
     * caret, and the entry colour rather than the label colour. A numeric mode
     * with no visible field is a mode the user cannot trust or escape.
     */
    if (scene.typed !== null && scene.typed !== undefined) {
      label(
        ctx,
        `${scene.typed}▏`,
        (a.x + b.x) / 2,
        (a.y + b.y) / 2 - 12,
        COLORS.entry,
        LABEL_FONT,
        COLORS.entryBg,
      )

      /*
       * B34 — the typed length is about to strand its end (finding 53).
       *
       * The commit is NEVER altered — L2, the typed number is the
       * highest-authority input in the app — so the honest move is to show
       * the miss WHILE the number can still be retyped: the same amber ring
       * the loose-end scan will draw after the commit, at the predicted
       * endpoint, plus one line under the entry naming the shortfall and the
       * length that would land on the wall. The warning is computed with the
       * scan's own machinery (`probeTypedMiss`), so what it predicts is
       * exactly what the status bar will report if Enter is pressed anyway.
       */
      const miss = scene.typedMiss
      if (miss) {
        const at = worldToScreen(miss.at, vp, width, height)
        const to = worldToScreen(miss.to, vp, width, height)

        ctx.save()
        ctx.beginPath()
        ctx.strokeStyle = COLORS.looseJoint
        ctx.lineWidth = 1.25
        ctx.setLineDash([3, 3])
        ctx.moveTo(at.x, at.y)
        ctx.lineTo(to.x, to.y)
        ctx.stroke()
        ctx.setLineDash([])

        ctx.beginPath()
        ctx.lineWidth = 2
        ctx.arc(at.x, at.y, LOOSE_JOINT_RADIUS_PX, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()

        label(
          ctx,
          `ends ${formatLengthCompact(miss.gap, scene.units)} short — ${formatLengthCompact(miss.reaches, scene.units)} reaches`,
          (a.x + b.x) / 2,
          (a.y + b.y) / 2 + 10,
          '#ffffff',
          LABEL_FONT,
          COLORS.looseJoint,
        )
      }
    } else if (length > 0) {
      // The full form, not the compact one: this is the number the user is
      // aiming with, and it has the whole canvas to sit in.
      const measured = formatLength(length, scene.units)

      /*
       * B31 — numeric entry announces itself.
       *
       * The field only appears once a digit has been typed, so before B31 you
       * had to know it existed to discover it existed. The hint rides on the
       * readout the user is already watching rather than adding chrome.
       *
       * It is DROPPED rather than truncated when the segment is too short to
       * hold it — the caption ladder's rule, and for the same reason: a
       * clipped hint is noise, and the number underneath it is the thing that
       * must survive.
       */
      ctx.font = LABEL_FONT
      const hinted = `${measured} · type to set`
      const span = Math.hypot(b.x - a.x, b.y - a.y)
      const fits = ctx.measureText(hinted).width + 16 <= span

      label(ctx, fits ? hinted : measured, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12)
    }
  }

  // The open end of the chain.
  ctx.beginPath()
  ctx.fillStyle = COLORS.draft
  ctx.arc(a.x, a.y, 4, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * The open-space outline being dragged, with the size it will commit at.
 *
 * Dashed, like the committed outline: a space with no walls has no built edge
 * to draw, and a solid line would read as one. The two figures are the same
 * `width x length` pair `roomSize` reports and the references print under the
 * name, so what the drag shows is what the schedule will say.
 */
function drawSpaceDraft(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const corner = scene.spaceCorner
  const { cursor, width, height, viewport: vp, units } = scene
  if (!corner || !cursor) return

  const a = worldToScreen(corner, vp, width, height)
  const b = worldToScreen(cursor, vp, width, height)

  ctx.save()
  ctx.beginPath()
  ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y)
  ctx.fillStyle = COLORS.draftFill
  ctx.fill()
  ctx.strokeStyle = COLORS.draft
  ctx.lineWidth = 1.5
  ctx.setLineDash(OPEN_SPACE_DASH)
  ctx.stroke()
  ctx.restore()

  const across = Math.abs(cursor.x - corner.x)
  const down = Math.abs(cursor.z - corner.z)
  if (across > 0 && down > 0) {
    label(
      ctx,
      `${formatLengthCompact(across, units)} x ${formatLengthCompact(down, units)}`,
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
    )
  }
}

/**
 * Wall ends that look joined and are not, ringed where they sit.
 *
 * The status bar counts these and offers to close them; this is what makes
 * that offer legible rather than blind. Each ring is drawn at the endpoint,
 * with a hairline to where connecting would move it — so the user can see
 * exactly what the repair will do before agreeing to it.
 *
 * Amber rather than the setback red: an unjoined end is a mistake in the
 * drawing, not a wall over a legal line.
 */
function drawLooseJoints(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const joints = scene.looseJoints
  if (!joints || joints.length === 0) return

  const { width, height, viewport: vp } = scene

  ctx.save()
  for (const joint of joints) {
    const from = worldToScreen(joint.at, vp, width, height)
    const to = worldToScreen(joint.to, vp, width, height)

    ctx.beginPath()
    ctx.strokeStyle = COLORS.looseJoint
    ctx.lineWidth = 1.25
    ctx.setLineDash([3, 3])
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.beginPath()
    ctx.strokeStyle = COLORS.looseJoint
    ctx.lineWidth = 2
    ctx.arc(from.x, from.y, LOOSE_JOINT_RADIUS_PX, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawCursor(ctx: CanvasRenderingContext2D, scene: PlanScene) {
  const { width, height, viewport: vp, cursor } = scene
  if (!cursor) return

  const p = worldToScreen(cursor, vp, width, height)

  ctx.beginPath()
  ctx.fillStyle = COLORS.draftFill
  ctx.strokeStyle = COLORS.draft
  ctx.lineWidth = 1.5
  ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  label(ctx, `${cursor.x.toFixed(1)}, ${cursor.z.toFixed(1)}`, p.x, p.y + 20)
}

/** Small centred text chip with a legible background. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  color = COLORS.label,
  font = LABEL_FONT,
  background = COLORS.labelBg,
) {
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const padding = LABEL_CHIP.padding
  const w = ctx.measureText(text).width + padding * 2
  const h = LABEL_CHIP.height

  ctx.fillStyle = background
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h)

  ctx.fillStyle = color
  ctx.fillText(text, cx, cy)
}
