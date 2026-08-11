import { create } from 'zustand'
import { createHistory, type History } from './history'
import {
  DEFAULT_FLOOR_MATERIAL,
  DEFAULT_WALL_MATERIAL,
  type MaterialId,
} from '../materials/palette'
import type { FurnitureType } from '../furniture/catalog'
import { provenance } from './provenance'
import { samePlacePoint } from '../units/tolerance'
import { findLooseJoints, weldJoints } from '../plan/repairJoints'

/**
 * A point on the floor plane, in metres.
 *
 * Named `x`/`z` (not `x`/`y`) to match three.js world axes: the floor is the
 * XZ plane and `y` is height. The 2D editor draws `z` as its vertical screen
 * axis, so a plan drawn top-down lines up with the 3D scene with no conversion.
 */
export type Point = { x: number; z: number }

/**
 * Where an element came from. Satisfies L5 — provenance on every element.
 *
 * `'unknown'` is not in §6's original list and was added by amendment: the
 * v2→v3 migration cannot tell a hand-drawn wall from one `buildWallsFromBlueprint`
 * detected or an AI edit produced, and writing `'manual'` would assert
 * something unknowable. L5 exists so the user can judge what to trust, and a
 * false provenance is worse than none.
 */
export type ProvenanceSource =
  | 'manual'
  | 'cv'
  | 'ai'
  | 'import-dxf'
  | 'import-json'
  | 'copy'
  | 'unknown'

export type Provenance = {
  source: ProvenanceSource
  /**
   * How much the source trusted itself, 0–1. OPTIONAL by amendment to §6:
   * absent means "not assessed", which is a different claim from `0`, meaning
   * "assessed as worthless". Deterministic paths write 1.0. The migration
   * writes nothing, and so does the wall detector — see `provenance.cv` for
   * why its score cannot honestly be rescaled into one.
   */
  confidence?: number
  /**
   * When the element came into being. From the document's `savedAt` for
   * migrated elements, never from the clock — a clock read would migrate the
   * same file to a different document on each run, breaking L6 and making the
   * round-trip test unwritable. Absent when even that is unknown.
   */
  createdAt?: string
  /**
   * A stable reference to the origin, whose meaning is determined by `source`:
   * the original element id for `'copy'`, the blueprint filename for `'cv'`,
   * layer + handle for `'import-dxf'`, the request id for `'ai'`.
   */
  sourceRef?: string
}

export type OpeningType = 'door' | 'window' | 'cased'

/**
 * Which jamb a door hangs on and which way its leaf sweeps.
 *
 * ── Why this is in the model ──
 * Before v4 nothing carried it, and FOUR sites decided it independently: the
 * canvas arc, the print sheet's arc, the sheet's `doorSweep` (which reserves
 * page space for the leaf), and the 3D leaf — which picked its side at RUNTIME
 * from where the walkthrough figure was standing. The same saved plan therefore
 * rendered with the door swinging either way depending on how you walked up to
 * it. That is a violation of L6, and of the rule that the 2D model is the
 * source of truth and no renderer may decide an architectural fact.
 *
 * ── The frame, which is the whole design ──
 * Both members are expressed in the WALL's own frame, never in world space. A
 * swing stored as a world direction silently flips the moment a wall is redrawn
 * end-to-start — the wall looks identical and its doors reverse.
 *
 * With `u = (ux, uz)` the unit vector from `wall.start` to `wall.end`:
 *
 * | | meaning |
 * |---|---|
 * | `hand: 'start'` | hinge at the jamb at `position - width/2` |
 * | `hand: 'end'`   | hinge at the jamb at `position + width/2` |
 * | `side: 'left'`  | the leaf sweeps toward `( uz, -ux)` |
 * | `side: 'right'` | the leaf sweeps toward `(-uz,  ux)` |
 *
 * Left and right are as seen standing at `wall.start` looking toward
 * `wall.end`, in PLAN — viewed from above, with world +z running DOWN the page,
 * so that observer's right hand points along `(-uz, ux)`.
 *
 * Reading that backwards is a live hazard of exactly the kind §4 invariant 3
 * names (`rotationY = atan2(-dz, dx)`, invisible on a symmetric plan). So the
 * naming is not left to be re-derived: `doorSwing.test.ts` pins both directions
 * against an explicit north-wall fixture, in world coordinates.
 */
export type Swing = {
  hand: 'start' | 'end'
  side: 'left' | 'right'
}

/**
 * What every door drawn before v4 actually looked like, and so what a new door
 * is given and what a swing-less door falls back to.
 *
 * Deliberately NOT reused by the v3→v4 migration, which writes the same pair as
 * a literal: a migration is a statement about what the past meant, and it must
 * not change if this default ever does.
 */
export const DEFAULT_SWING: Swing = { hand: 'start', side: 'left' }

export type Opening = {
  id: string
  type: OpeningType
  provenance?: Provenance
  /** Distance in metres from the wall's start to the opening's centre. */
  position: number
  /** Metres. */
  width: number
  /** Metres. */
  height: number
  /** Height of the opening's bottom edge above the floor. Doors are 0. */
  sill: number
  /**
   * The schedule key the user typed — `D1`, `MD`, `W2`, `KW2`, `V`.
   *
   * Free text and USER-OWNED (L2): nothing auto-assigns it and nothing
   * overwrites it. An automatic `D1`/`D2` sequence was considered and is
   * exactly what L2 forbids — the moment the app mints marks, renumbering on
   * insert silently rewrites a key the drawing, the schedule and the builder's
   * order all refer to.
   *
   * Repeated marks assert that the openings are IDENTICAL UNITS. The schedule
   * checks that assertion rather than trusting it; see `openings/schedule.ts`.
   *
   * Absent, never empty — `parseOpening` trims and drops a blank, so `''` and
   * `undefined` cannot both mean "unmarked".
   */
  mark?: string
  /**
   * How the leaf hangs. Meaningful on a door and dropped from a window at the
   * parse boundary — a window that does not swing must not carry a swing into
   * a file.
   *
   * Optional in the type, required in practice: `addOpening` sets it on every
   * door and the v3→v4 migration backfills every existing one. It stays
   * optional so a v3 fixture, a hand-edited file or an older code path still
   * typechecks and still draws — `doorSwing()` falls back to `DEFAULT_SWING`,
   * which is the pre-v4 convention, so nothing renders differently for want of
   * the field.
   */
  swing?: Swing
}

export type Wall = {
  id: string
  provenance?: Provenance
  start: Point
  end: Point
  /** Metres. */
  height: number
  /** Metres. */
  thickness: number
  openings: Opening[]
  material: MaterialId
}

/**
 * The room types offered when naming a space. Ordered as they are offered.
 *
 * Pooja, toilet-separate-from-bathroom, and a named staircase are all standard
 * on Indian residential plans, which is what this list is drawn for.
 */
export type RoomType =
  | 'living'
  | 'bedroom'
  | 'master-bedroom'
  | 'kitchen'
  | 'dining'
  | 'pooja'
  | 'toilet'
  | 'bathroom'
  | 'study'
  | 'store'
  | 'balcony'
  | 'guest-room'
  | 'staircase'

/**
 * The identity of a named space, and the only durable handle on one.
 *
 * It lives on the LABEL, not on the room: the room is re-derived from the walls
 * on every edit, so an id stored "on the room" would be minted afresh each pass
 * and identify nothing. The label is the user's assertion that a space exists
 * here and is called this — that assertion is what persists (L2), and the
 * geometry is computed around it (L6).
 */
export type RoomId = string

/**
 * A name the user has given to an enclosed space.
 *
 * Rooms themselves are derived from the walls every time they change, so a name
 * cannot be stored "on" a room. It is pinned to `anchor` — a point inside the
 * space when it was named — and re-matched afterwards by testing which detected
 * loop contains that point. Move a wall and the name follows its room; move a
 * wall straight past the anchor and the name DETACHES rather than following the
 * wrong space: it stays in the document, unresolved, and re-attaches when the
 * walls close around it again. See `detachedLabels` in `rooms/resolve.ts`.
 */
export type RoomLabel = {
  id: RoomId
  provenance?: Provenance
  type: RoomType
  anchor: Point
  /**
   * A name the user typed to override the type's default label — "Kids' Room",
   * "Home Office". Blank or absent falls back to the type's name, so the type
   * still drives the zone colour while the caption can read as anything.
   */
  name?: string
  /**
   * The polygon this name last resolved to, for re-attaching it after the walls
   * move (B7.6). Written at SERIALIZE time and read at parse time — never
   * during editing or rendering.
   *
   * That timing is the whole design, not an optimisation. Writing it from
   * inside `resolveRooms` would replace `roomLabels`, which (a) gives B8's
   * cache a new key on every call so it never hits, (b) triggers a render,
   * which resolves, which writes — an infinite loop, and (c) is seen by
   * `designChanged`, a pure reference compare, so every resolve would record an
   * undo step the user cannot see (§4 invariant 1, §10 rule 10). Computed at
   * save time instead, `resolveRooms` stays a pure function of its arguments
   * and the hint is still durable across the reload it exists for.
   */
  boundaryHint?: Point[]
  /**
   * The extent the USER drew for a space that no closed wall loop bounds — a
   * porch, a sitout, a wash area, a balcony. Every reference drawing names AND
   * dimensions these, and before B25 they could not even be selected.
   *
   * ── Why this is on `RoomLabel` and not a `Space` element ──
   * A separate element type forks `resolveRooms`, the room schedule, the area
   * statement, Vastu and the BOQ into two code paths for one concept. This
   * type already carries `boundaryHint: Point[]`, a polygon field of exactly
   * this shape, so extending it is §3's "extend rather than replace".
   *
   * ── How it differs from `boundaryHint`, which looks identical ──
   * `boundaryHint` is DERIVED — written by `serializeDesign` from geometry the
   * walls produced, and used only to re-find a room after an edit. This is
   * AUTHORED: the user drew it, nothing may recompute it (L2), and it is the
   * space's actual outline rather than a memory of one.
   *
   * ── Precedence ──
   * Last, deliberately. A label resolves by containment first, then by
   * `boundaryHint`, and only then by this. If walls ever close around the
   * point, the walls win — they are the more specific architectural fact, and
   * B7's whole design is that geometry is recomputed while the name persists.
   */
  openBoundary?: Point[]
}

/**
 * The site: a rectangular plot and its legal setbacks, all in metres.
 *
 * Rectangular only, deliberately — it covers the overwhelming majority of
 * residential plots, and an arbitrary polygon boundary would need its own
 * editing tools to be worth anything.
 *
 * `front` is the edge the plot faces, which follows `plotFacing` and the north
 * rotation rather than being pinned to the bottom of the drawing. `left` and
 * `right` are as seen standing at the front looking into the plot.
 */
export type Plot = {
  /** Extent along world x, in metres. */
  width: number
  /** Extent along world z, in metres. */
  depth: number
  /** World position of the plot's minimum-x, minimum-z corner. */
  origin: Point
  setbacks: {
    front: number
    rear: number
    left: number
    right: number
  }
}

export const PLOT_DEFAULTS = {
  /** 30 x 40 ft, the size the brief tests with. */
  width: 30 * 0.3048,
  depth: 40 * 0.3048,
  setback: 5 * 0.3048,
} as const

/**
 * A flight of stairs rising from the floor it sits on to the one above.
 *
 * Kept as its own collection rather than a furniture item because it is
 * structural: it occupies a footprint the Vastu check reads, and it is the only
 * object whose meaning spans two floors.
 */
export type Stair = {
  id: string
  provenance?: Provenance
  /** Centre of the flight's footprint. */
  position: Point
  /** Rotation about the vertical axis, in radians. Zero ascends toward -z. */
  rotation: number
  /** Metres across the flight. */
  width: number
  /** Metres along the flight, in plan. */
  run: number
}

export const STAIR_DEFAULTS = {
  width: 1.0,
  run: 3.6,
  /** A comfortable domestic rise; the tread count follows the floor height. */
  riserHeight: 0.17,
} as const

export type FurnitureItem = {
  id: string
  provenance?: Provenance
  type: FurnitureType
  /** Centre of the piece on the floor plane. */
  position: Point
  /** Rotation about the vertical axis, in radians. */
  rotation: number
  /**
   * Footprint overrides, in metres. Absent means "use the catalogue's default
   * size for this type", so an untouched piece needs nothing stored; set them to
   * stretch or shrink one piece — a longer sofa, a wider kitchen counter —
   * without affecting the others.
   */
  width?: number
  depth?: number
}

/**
 * How a blueprint's scale was arrived at. Ordered by trust in
 * `CALIBRATION_RANK` — see `blueprint/calibration.ts`, which owns the ladder
 * and is the only module allowed to write a scale.
 */
export type CalibrationSource =
  | 'manual'
  | 'dxf-units'
  | 'vector'
  | 'ocr'
  | 'heuristic'
  | 'ai'
  | 'none'

/** How the scale was arrived at, kept so the UI can be specific about it. */
export type CalibrationEvidence = {
  /** The two world points picked, for `manual`. */
  picks?: [Point, Point]
  /** What the user typed, in metres, for `manual`. */
  typedMetres?: number
  /** The dimension the model read, in feet, for `ai`. */
  readFeet?: number
  /** Free text for anything else — a DXF unit code, an OCR string. */
  note?: string
}

/**
 * The provenance of a blueprint's scale, carried beside the number itself.
 *
 * The number alone was not enough: two sources wrote it, neither recorded
 * which had, and so an estimate could silently replace a measurement and still
 * be reported as "calibrated". Storing the source next to the value is what
 * makes that impossible rather than merely discouraged.
 */
export type Calibration = {
  source: CalibrationSource
  /** The value in force. Always within `BLUEPRINT.min/maxMetresPerPixel`. */
  metresPerPixel: number
  /** Set when the user measured it. Nothing automated may then replace it. */
  lockedByUser: boolean
  /** ISO 8601. */
  setAt: string
  evidence?: CalibrationEvidence
}

/**
 * A blueprint image traced under the plan.
 *
 * The image is positioned by two numbers rather than a transform matrix:
 * `origin` is where its top-left pixel sits in world metres, and
 * `metresPerPixel` is its scale. Calibration writes both, so a photographed
 * or scanned drawing at any resolution lands at true size.
 *
 * `metresPerPixel` and `calibration.metresPerPixel` are always equal. The
 * duplication is deliberate: every reader of the scale already reads
 * `blueprint.metresPerPixel`, and forcing thirteen call sites through
 * `blueprint.calibration.metresPerPixel` to add provenance would have been a
 * large diff with no benefit to any of them. `proposeCalibration` writes both
 * in one `updateBlueprint` call and is the only writer of either.
 */
export type Blueprint = {
  /**
   * Object URL for the decoded image, or null when the pixels are not loaded.
   *
   * Null is the state a saved design comes back in. An object URL is valid for
   * one session of one tab, so it cannot be persisted — but the placement and
   * the calibration around it can, and losing a measurement to a page reload
   * was one of the reasons the scale bug was unrecoverable. So a reopened
   * project remembers that it was traced from `site-plan.png` at 1 px = 1.9 cm,
   * and re-picking that file restores the drawing underneath the walls rather
   * than starting the measurement again.
   */
  src: string | null
  fileName: string
  /** Natural pixel dimensions of the source image. */
  width: number
  height: number
  metresPerPixel: number
  /** World position of the image's top-left corner, in metres. */
  origin: Point
  opacity: number
  visible: boolean
  /** Where `metresPerPixel` came from and whether the user locked it. */
  calibration: Calibration
}

export const BLUEPRINT_DEFAULTS = {
  /** 1 px = 1 cm, i.e. a 1000 px drawing spans 10 m until calibrated. */
  metresPerPixel: 0.01,
  opacity: 0.5,
} as const

export const WALL_DEFAULTS = {
  height: 3,
  thickness: 0.2,
} as const

export const OPENING_DEFAULTS: Record<
  OpeningType,
  Pick<Opening, 'width' | 'height' | 'sill'>
> = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  /**
   * A cased opening — a gap with no leaf and no glass, tagged `O` on a plan.
   * Standard between kitchen and dining in Indian residential work.
   *
   * **1.2 m** because a cased opening is a pass-through, not a doorway: it is
   * deliberately wider than the 0.9 m single leaf beside it, and 1200 is the
   * width these are commonly drawn at. It coincides with the window default
   * for an unrelated reason, so changing one must not change the other.
   *
   * **Height 2.1 m, sill 0** — the same head as a door, not the full wall.
   * Openings in one wall share a head height; a cased opening at 2100 lines
   * up with the doors next to it and leaves the lintel band that is actually
   * built over it. Floor-to-soffit is the deliberate exception, not the
   * default.
   *
   * ── Why a constant rather than tracking `wall.height` ──
   * It was considered and rejected. `OPENING_DEFAULTS` is a static table read
   * by `addOpening`, by `parseOpening`'s per-field fallbacks and by the CV
   * path; making one entry a function of the wall would change its type for
   * all three and widen this session well past its scope.
   *
   * Nothing is lost by it. A user who wants floor-to-soffit types the wall's
   * height, and `constrainOpening` clamps to `wall.height - sill`, so the
   * result is exact. `wallPieces` then computes `head === wall.height`, the
   * lintel piece gets zero rise and is skipped — a clean full-height void with
   * no degenerate geometry.
   */
  cased: { width: 1.2, height: 2.1, sill: 0 },
}

/**
 * What each opening type is called on screen.
 *
 * A table rather than three `type === 'door' ? … : 'Window'` expressions,
 * which is what the inspector header, the inspector's opening list and the 3D
 * dimension chip each carried. Every one of them called a cased opening a
 * window — a binary test silently mislabels whatever a widened union adds,
 * and no compiler catches it. A `Record<OpeningType, …>` does.
 */
export const OPENING_LABELS: Record<OpeningType, string> = {
  door: 'Door',
  window: 'Window',
  cased: 'Opening',
}

/**
 * Smallest open space worth keeping, in square metres.
 *
 * A click with the Space tool is a zero-size drag, and 0.05 m² is well under
 * anything anyone would draw on purpose while being large enough that a
 * mis-click cannot leave an invisible entry in the schedule.
 */
const MIN_OPEN_SPACE_AREA = 0.05

/** Keeps edits physically meaningful without fighting the user mid-typing. */
export const LIMITS = {
  wallLength: { min: 0.05, max: 500 },
  wallHeight: { min: 0.2, max: 20 },
  wallThickness: { min: 0.02, max: 2 },
  openingWidth: { min: 0.1, max: 20 },
  openingHeight: { min: 0.1, max: 20 },
  furnitureSize: { min: 0.2, max: 10 },
}

/**
 * How lengths and areas are shown. The model is always metric — this only
 * changes what the user reads and types.
 *
 * `ftin` leads because feet-and-inches is what building drawings use across
 * India, where this is aimed.
 */
export type Unit = 'ftin' | 'm'

export const DEFAULT_UNIT: Unit = 'ftin'

export const isUnit = (value: unknown): value is Unit =>
  value === 'ftin' || value === 'm'

/**
 * A compass direction, to eight points. Used for which way the plot faces.
 *
 * Eight is what building practice (and Vastu, which builds on this next) works
 * in — the four cardinals plus the four corners, no finer.
 */
export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'

export const DEFAULT_FACING: Facing = 'N'

const FACING_VALUES: Facing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export const isFacing = (value: unknown): value is Facing =>
  typeof value === 'string' && (FACING_VALUES as string[]).includes(value)

/**
 * One storey's worth of design. The plot, the north rotation and the unit
 * setting are properties of the site, not of a storey, so they stay top-level
 * and every floor shares them.
 */
export type FloorData = {
  id: string
  name: string
  walls: Wall[]
  furniture: FurnitureItem[]
  roomLabels: RoomLabel[]
  stairs: Stair[]
}

export const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor']

/** Floor-to-floor height in metres: the wall, plus the slab it stands on. */
export const FLOOR_HEIGHT = WALL_DEFAULTS.height + 0.15

/** Height of a floor's finished level above the ground floor's. */
export const floorElevation = (index: number) => index * FLOOR_HEIGHT

export const emptyFloor = (index: number): FloorData => ({
  id: crypto.randomUUID(),
  name: FLOOR_NAMES[index] ?? `Floor ${index}`,
  walls: [],
  furniture: [],
  roomLabels: [],
  stairs: [],
})

/**
 * What autosave last did, for the status bar.
 *
 * `conflict` is its own state rather than a flavour of `failed`: nothing went
 * wrong technically, but another tab is writing the same two localStorage keys
 * and whichever saves last wins. The user is the only one who can resolve that,
 * so they have to be told it is happening.
 *
 * `held-back` is likewise not a failure: the draft is intact and saving works.
 * It says the app declined to REOPEN a draft because the previous boot crashed
 * before it finished — see the boot guard in `persistence/storage.ts`. Starting
 * empty without saying so would read as the work having been lost.
 */
export type AutosaveState =
  | { kind: 'idle' }
  | { kind: 'saved'; at: string }
  | { kind: 'failed'; message: string }
  | { kind: 'conflict' }
  | { kind: 'held-back' }

export type ViewMode = '2d' | '3d'

/**
 * Where the camera sits during a walkthrough.
 *
 * `first` is eyes-only. `third` follows a human figure from behind, which is
 * what most people need to judge a room: you cannot feel a doorway's width
 * without seeing a body pass through it.
 */
export type WalkView = 'first' | 'third'

/** Active pointer tool. `wall` draws; the rest act on existing walls. */
export type Tool =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'cased'
  | 'space'
  | 'stair'

/**
 * Whether this tool places an opening on a wall — and, if so, which type.
 *
 * The three opening tools are named after the three `OpeningType`s on purpose,
 * so the click handlers can pass the tool straight to `addOpening`. Testing
 * membership of `OPENING_DEFAULTS` rather than listing them means a fourth
 * opening type is placeable the moment it exists, instead of compiling
 * cleanly and silently doing nothing when clicked — which is what
 * `tool === 'door' || tool === 'window'` did.
 */
export const isOpeningTool = (tool: Tool): tool is Tool & OpeningType =>
  tool in OPENING_DEFAULTS

/**
 * A selected space is a selected NAME.
 *
 * Rooms are derived from the walls, so there is nothing durable to point at
 * except the label the user attached. `room` therefore carries a `RoomId` and
 * `space` carries a point, and the two are separate variants rather than one
 * variant with a nullable id — because they mean different things and the
 * inspector does different work for each.
 *
 * This replaced a single `{ kind: 'room'; anchor: Point }` whose `anchor` meant
 * a label's own anchor when the schedule panel set it and a raw click point
 * when the plan set it. `RoomInspector` told them apart by comparing both
 * coordinates as floats, which only ever matched the first — so clicking an
 * open-plan zone in the plan and renaming it rewrote the enclosure's PRIMARY
 * name instead. See `rooms/identity.test.tsx`.
 */
export type Selection =
  | { kind: 'wall'; wallId: string }
  | { kind: 'room'; roomId: RoomId }
  | { kind: 'space'; anchor: Point }
  | { kind: 'stair'; stairId: string }
  | { kind: 'opening'; wallId: string; openingId: string }
  | { kind: 'furniture'; furnitureId: string }
  | { kind: 'floor' }
  | null

/** Selections that belong to a wall. Narrows away `floor` and `furniture`. */
const selectionWallId = (selection: Selection): string | null =>
  selection && (selection.kind === 'wall' || selection.kind === 'opening')
    ? selection.wallId
    : null

type DesignState = {
  viewMode: ViewMode
  /** Walkthrough navigation. Only meaningful in 3D. */
  walkMode: boolean
  walkView: WalkView
  tool: Tool
  selection: Selection
  /**
   * Storage for every storey.
   *
   * The entry at `activeFloor` is deliberately allowed to go stale: while a
   * floor is open, the top-level `walls` / `furniture` / `roomLabels` / `stairs`
   * ARE that floor, and every one of the thirty-odd things that read the design
   * keeps reading them without knowing floors exist. The two are reconciled in
   * exactly three places — switching floor, copying up, and `allFloors` — so
   * read whole-building state through `allFloors(state)`, never through
   * `floors` directly.
   */
  floors: FloorData[]
  activeFloor: number

  walls: Wall[]
  furniture: FurnitureItem[]
  /** User-given room names. The rooms themselves are derived from the walls. */
  roomLabels: RoomLabel[]
  stairs: Stair[]
  floorMaterial: MaterialId
  units: Unit
  /**
   * Construction rate in rupees per square foot, or 0 when it has not been
   * set. Zero means "no estimate", not "free" — nothing should print a cost
   * of ₹0 as though it were a quotation.
   */
  constructionRate: number
  /**
   * Where North points, in degrees clockwise from the top of the plan.
   *
   * 0 means the drawing is oriented conventionally, North up. Rotating this
   * turns the compass, not the walls: the design keeps its own coordinates and
   * only its relationship to the real world changes.
   */
  northOffset: number
  /** Which way the plot faces in the real world. */
  plotFacing: Facing
  /** The site boundary, or null when the design is not on a defined plot. */
  plot: Plot | null
  /** Traced-under reference drawing, or null when none is loaded. */
  blueprint: Blueprint | null
  /** Name of the open project, or null for an unsaved draft. */
  projectName: string | null
  aiPanelOpen: boolean
  furniturePanelOpen: boolean
  blueprintPanelOpen: boolean
  roomPanelOpen: boolean
  vastuPanelOpen: boolean
  plotPanelOpen: boolean
  /** The nine-zone directional grid drawn over the plan. */
  vastuGrid: boolean
  /**
   * Reveals the full set of measurements on the model: wall lengths and
   * thicknesses, and every door and window's size. A view-only overlay, so it
   * lives here beside `vastuGrid` rather than in the saved document.
   */
  showDimensions: boolean
  /** Whether the floating site compass is shown. View-only, defaults on. */
  showCompass: boolean
  /**
   * Set while the user is picking the two ends of a known distance on the
   * blueprint. Lives in the store because the panel starts it and the plan
   * canvas finishes it.
   */
  blueprintCalibrating: boolean
  /** Chrome-free walkthrough for showing the design to someone. */
  presentMode: boolean
  /** A design opened from a share link. Editing is disabled throughout. */
  readOnly: boolean
  /**
   * What autosave last did. Shown in the status bar.
   *
   * It used to have no state at all: on a full-quota write it returned without
   * updating its dirty marker and retried silently every four seconds, forever,
   * while the user carried on believing their work was being saved. A failure
   * this quiet is worse than no autosave.
   */
  autosave: AutosaveState
  setAutosave: (state: AutosaveState) => void
  /**
   * Bumped whenever what is on screen has moved enough to need reframing —
   * a load, a new design, a floor switch, or a wholesale wall replacement.
   * Views watch it to refit. A counter rather than a boolean so consecutive
   * loads each trigger one.
   */
  viewEpoch: number
  /**
   * Bumped only when the undo stack has become meaningless: the document the
   * history described is gone, so stepping back into it would restore a design
   * the user did not ask for.
   *
   * Deliberately separate from `viewEpoch`. The two used to be one counter, and
   * that is why an AI edit — which must refit the view — also silently wiped
   * every undo step, leaving the user no way back from a bad generation. A
   * floor switch had the same problem for the same reason. Refitting the camera
   * and discarding the user's history are different claims and now say so.
   */
  historyEpoch: number

  /**
   * Undo/redo history for the design (walls, openings, rooms, furniture,
   * stairs, floors, plot and north). View-only state — panels, tool, camera —
   * is deliberately left out, so an undo never yanks the UI around. `past` holds
   * states you can step back to; `future` holds ones you stepped back from.
   */
  past: DesignSnapshot[]
  future: DesignSnapshot[]
  /** Steps the design back one edit; a no-op when there is nothing to undo. */
  undo: () => void
  /** Re-applies the last undone edit; a no-op when there is nothing to redo. */
  redo: () => void

  setViewMode: (mode: ViewMode) => void
  setWalkMode: (walking: boolean) => void
  setWalkView: (view: WalkView) => void
  setTool: (tool: Tool) => void
  select: (selection: Selection) => void
  setProjectName: (name: string | null) => void
  setAiPanelOpen: (open: boolean) => void
  setFurniturePanelOpen: (open: boolean) => void
  setBlueprintPanelOpen: (open: boolean) => void
  setRoomPanelOpen: (open: boolean) => void
  setVastuPanelOpen: (open: boolean) => void
  setPlotPanelOpen: (open: boolean) => void
  setShowDimensions: (show: boolean) => void
  setShowCompass: (show: boolean) => void

  /** Opens a storey, filing the one being left back into `floors`. */
  setActiveFloor: (index: number) => void
  /**
   * Copies this floor's layout onto the one above as a starting point.
   * Returns false when there is no floor above, or the target is not empty —
   * overwriting a storey someone has already drawn is not recoverable.
   */
  copyToNextFloor: () => boolean

  addStair: (position: Point, provenance: Provenance) => string
  updateStair: (
    id: string,
    patch: Partial<Pick<Stair, 'position' | 'rotation' | 'width' | 'run'>>,
  ) => void
  removeStair: (id: string) => void

  /** Replaces the plot outright, or clears it with null. */
  setPlot: (plot: Plot | null) => void
  updatePlot: (patch: Partial<Omit<Plot, 'setbacks'>>) => void
  setSetback: (edge: keyof Plot['setbacks'], metres: number) => void
  setVastuGrid: (on: boolean) => void
  setBlueprintCalibrating: (on: boolean) => void

  /** Names the space containing `anchor`. Returns the new label's id. */
  nameRoom: (anchor: Point, type: RoomType, provenance: Provenance) => string
  /**
   * Names a space no walls enclose, from an outline the user drew — a porch,
   * a sitout, a balcony. Returns the new label's id, or null for a degenerate
   * outline, which a click rather than a drag produces.
   */
  nameOpenSpace: (
    boundary: Point[],
    type: RoomType,
    provenance: Provenance,
  ) => string | null
  updateRoomLabel: (
    id: string,
    patch: Partial<Pick<RoomLabel, 'type' | 'name'>>,
  ) => void
  removeRoomLabel: (id: string) => void
  setPresentMode: (on: boolean) => void
  setFloorMaterial: (material: MaterialId) => void
  setUnits: (units: Unit) => void
  setConstructionRate: (rupeesPerSqFt: number) => void
  /** Degrees clockwise from plan-up; wrapped into [0, 360). */
  setNorthOffset: (degrees: number) => void
  setPlotFacing: (facing: Facing) => void

  /** Replaces the traced image, revoking the previous one's object URL. */
  setBlueprint: (blueprint: Blueprint | null) => void
  /**
   * Patches the traced image's placement and appearance.
   *
   * `metresPerPixel` and `calibration` are in this patch type but must only
   * ever be supplied by `proposeCalibration` in `blueprint/calibration.ts`,
   * which enforces the authority ladder. Writing them from anywhere else is
   * how an AI estimate came to overwrite a user's measurement;
   * `calibration.test.ts` fails the build if another module tries.
   */
  updateBlueprint: (
    patch: Partial<
      Pick<
        Blueprint,
        'metresPerPixel' | 'origin' | 'opacity' | 'visible' | 'calibration'
      >
    >,
  ) => void

  addFurniture: (
    type: FurnitureType,
    position: Point,
    provenance: Provenance,
  ) => string
  updateFurniture: (
    id: string,
    patch: Partial<Pick<FurnitureItem, 'position' | 'rotation' | 'width' | 'depth'>>,
  ) => void
  removeFurniture: (id: string) => void

  /**
   * Swaps the walls and nothing else, keeping every other part of the design.
   *
   * This is what an assistant edit actually means: the model was shown the
   * walls, it returned walls, and it was never told the furniture, the room
   * names, the stairs, the plot, the north rotation or the upper storeys
   * existed — so it cannot have an opinion about them, and taking its silence
   * as "delete them" is not a reading anyone asked for. The AI paths used
   * `loadDesign` for this, which defaults every field it is not handed, and so
   * destroyed all of it on every edit.
   *
   * Recorded as one ordinary undo step: unlike a load, this is an edit to the
   * open document, and it must be reversible like any other.
   *
   * Openings ride inside their walls, so they are replaced along with them —
   * that is the whole point of the edit. Room names are pinned to points and
   * re-resolve against the new walls; a name whose space no longer exists
   * simply stops resolving, which is the same thing that happens when the user
   * drags a wall past it by hand.
   */
  replaceWalls: (walls: Wall[], name?: string | null) => void

  /** Replaces the entire design — used by project load, import, and share links. */
  loadDesign: (design: {
    name?: string | null
    walls: Wall[]
    furniture?: FurnitureItem[]
    roomLabels?: RoomLabel[]
    stairs?: Stair[]
    /** Upper storeys. The arguments above are the ground floor. */
    floors?: FloorData[]
    floorMaterial?: MaterialId
    viewMode?: ViewMode
    units?: Unit
    constructionRate?: number
    plot?: Plot | null
    northOffset?: number
    plotFacing?: Facing
    /**
     * The traced underlay's remembered placement, with no pixels — its `src`
     * is null until the user re-picks the file. Absent clears it.
     */
    blueprint?: Blueprint | null
    readOnly?: boolean
  }) => void
  /** Clears everything back to an empty, unnamed draft. */
  newDesign: () => void

  /**
   * An empty document, in a named view state. The compliant way to say
   * "show nothing, like this".
   *
   * Exists because §10 rule 3 — *"never call `loadDesign` with a partial field
   * set; it defaults everything absent to empty"* — is unconditional, and the
   * damaged-share-link path was violating it. That path genuinely wants an
   * empty read-only viewer, so the defaults-to-empty behaviour was the intent
   * there; but intent does not make a call compliant, and relying on
   * `loadDesign`'s defaulting keeps alive the exact mechanism that produced the
   * worst bug in the codebase. Asking for emptiness explicitly costs two lines
   * and removes the reliance.
   */
  resetToEmpty: (view?: { readOnly?: boolean; viewMode?: ViewMode }) => void

  /**
   * Appends a wall. Returns its id, or `null` if the segment was rejected.
   *
   * Zero-length segments are rejected here rather than in the editor: a wall
   * with no length has no valid 3D geometry, so keeping it out of the model
   * means nothing downstream has to defend against it.
   */
  /**
   * `provenance` is REQUIRED, and deliberately not defaulted to `manual`. Two
   * of this action's three callers are the CV path — `buildWallsFromBlueprint`
   * and the blueprint panel's "add detected walls" — so a default would label
   * machine output as hand-drawn. See `store/provenance.ts`.
   */
  addWall: (
    start: Point,
    end: Point,
    options: Partial<Pick<Wall, 'height' | 'thickness'>> & {
      provenance: Provenance
    },
  ) => string | null
  updateWall: (
    id: string,
    patch: Partial<Pick<Wall, 'height' | 'thickness' | 'material'>>,
  ) => void
  /**
   * Resizes a wall to an exact length in metres, pivoting on its start point
   * so the end swings along the wall's existing direction.
   *
   * The start is held rather than the centre because walls are drawn as chains:
   * moving the start would detach this wall from the one before it.
   */
  setWallLength: (id: string, length: number) => boolean
  /** Closes joints that look connected but are not. Returns how many moved. */
  repairJoints: () => number
  removeWall: (id: string) => void
  clearWalls: () => void
  /**
   * Empties the open storey — walls, names, furniture and stairs — as one edit,
   * so starting a trace over takes a single undo to reverse rather than one per
   * object. The blueprint underlay is left alone; removing that is separate.
   */
  clearFloor: () => void

  /**
   * Places an opening on a wall, centred `position` metres along it. Returns
   * the new opening's id, or `null` if the wall is too short to hold it.
   */
  /** `provenance` required — `detectOpenings` is one of the three callers. */
  addOpening: (
    wallId: string,
    type: OpeningType,
    position: number,
    provenance: Provenance,
  ) => string | null
  updateOpening: (
    wallId: string,
    openingId: string,
    patch: Partial<Omit<Opening, 'id' | 'type'>>,
  ) => void
  removeOpening: (wallId: string, openingId: string) => void
}

const samePoint = (a: Point, b: Point) => a.x === b.x && a.z === b.z

/** One wall's endpoint resting on a shared point. */
type Join = { wallId: string; which: 'start' | 'end' }

/**
 * Every OTHER wall endpoint sitting on `point`, within `JOIN_TOLERANCE`.
 *
 * This is what makes a corner a corner. `detectRooms` welds on the same
 * tolerance, so a join the editor preserves is a join the traversal sees —
 * before this, the two disagreed and only the traversal noticed.
 */
function joinsAt(walls: Wall[], point: Point, exceptWallId: string): Join[] {
  const found: Join[] = []
  for (const wall of walls) {
    if (wall.id === exceptWallId) continue
    if (samePlacePoint(wall.start, point)) found.push({ wallId: wall.id, which: 'start' })
    if (samePlacePoint(wall.end, point)) found.push({ wallId: wall.id, which: 'end' })
  }
  return found
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const wallLength = (wall: Wall) =>
  Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z)

/**
 * Keeps an opening inside its wall: never wider than the wall, never poking out
 * either end, and never taller than the wall it sits in. Applied on every write
 * so the geometry layer can trust the data it renders.
 */
function constrainOpening(opening: Opening, wall: Wall): Opening {
  const length = wallLength(wall)

  const width = clamp(
    opening.width,
    LIMITS.openingWidth.min,
    Math.max(LIMITS.openingWidth.min, length),
  )
  const sill = clamp(opening.sill, 0, Math.max(0, wall.height - 0.05))
  const height = clamp(
    opening.height,
    LIMITS.openingHeight.min,
    Math.max(LIMITS.openingHeight.min, wall.height - sill),
  )
  // Half a width of clearance at each end keeps the opening fully on the wall.
  const position = clamp(opening.position, width / 2, length - width / 2)

  // The mark is trimmed and a blank dropped here as well as in `parseOpening`,
  // because this is the one funnel every in-memory write passes through. Left
  // alone, clearing the inspector's field would store `''` — which the
  // schedule would group as a unit distinct from "no mark", invisibly, until
  // the document was saved and reloaded.
  const mark = opening.mark?.trim()
  const marked = mark ? { ...opening, mark } : omitMark(opening)

  return { ...marked, width, height, sill, position }
}

/** An opening with no `mark` key at all — not one set to `''` or `undefined`. */
function omitMark(opening: Opening): Opening {
  if (opening.mark === undefined) return opening
  const { mark: _mark, ...rest } = opening
  return rest
}

/**
 * Clamps a whole wall — its own dimensions, then every opening against them.
 *
 * Shared by the edit path and the load path so a wall arriving from a file
 * lands under exactly the same rules as one edited in the inspector.
 */
export function normalizeWall(wall: Wall): Wall {
  const base: Wall = {
    ...wall,
    height: clamp(wall.height, LIMITS.wallHeight.min, LIMITS.wallHeight.max),
    thickness: clamp(
      wall.thickness,
      LIMITS.wallThickness.min,
      LIMITS.wallThickness.max,
    ),
    material: wall.material ?? DEFAULT_WALL_MATERIAL,
  }
  return { ...base, openings: base.openings.map((o) => constrainOpening(o, base)) }
}

/**
 * The open floor's data, written back into the `floors` array.
 *
 * This is the ONLY place the checked-out top-level design is folded back into
 * storage. Everything that needs the whole building goes through `allFloors`.
 */
function fileActiveFloor(state: DesignState): FloorData[] {
  return state.floors.map((floor, index) =>
    index === state.activeFloor
      ? {
          ...floor,
          walls: state.walls,
          furniture: state.furniture,
          roomLabels: state.roomLabels,
          stairs: state.stairs,
        }
      : floor,
  )
}

/**
 * Every storey, with the open one substituted in.
 *
 * Use this — not `state.floors` — for anything that spans the building: the 3D
 * stack, saving, area totals across floors. Reading `floors` directly gets you
 * a stale copy of whatever the user is currently editing.
 */
export function allFloors(state: {
  floors: FloorData[]
  activeFloor: number
  walls: Wall[]
  furniture: FurnitureItem[]
  roomLabels: RoomLabel[]
  stairs: Stair[]
}): FloorData[] {
  return state.floors.map((floor, index) =>
    index === state.activeFloor
      ? {
          ...floor,
          walls: state.walls,
          furniture: state.furniture,
          roomLabels: state.roomLabels,
          stairs: state.stairs,
        }
      : floor,
  )
}

/**
 * Everything `serializeDesign` reads, as one comparable value.
 *
 * Autosave used to decide whether anything had changed with
 * `walls === savedWallsRef.current`. A session spent naming rooms, arranging
 * furniture, setting the plot and its setbacks, rotating north, entering the
 * construction rate or changing the floor finish touched no wall and was
 * therefore never saved — while the README promised that closing the tab does
 * not lose work.
 *
 * Deliberately WIDER than `DesignSnapshot`: `units` and `constructionRate` are
 * persisted but not undoable, so the two sets are genuinely different and
 * sharing one would silently under-save or over-record.
 *
 * Compared by reference for the collections, which is sound because the store
 * only ever replaces them, and by value for the primitives.
 */
export type PersistedFingerprint = {
  projectName: string | null
  walls: Wall[]
  furniture: FurnitureItem[]
  roomLabels: RoomLabel[]
  stairs: Stair[]
  floors: FloorData[]
  plot: Plot | null
  blueprint: Blueprint | null
  floorMaterial: MaterialId
  viewMode: ViewMode
  units: Unit
  constructionRate: number
  northOffset: number
  plotFacing: Facing
}

export function persistedFingerprint(s: DesignState): PersistedFingerprint {
  return {
    projectName: s.projectName,
    walls: s.walls,
    furniture: s.furniture,
    roomLabels: s.roomLabels,
    stairs: s.stairs,
    floors: s.floors,
    plot: s.plot,
    blueprint: s.blueprint,
    floorMaterial: s.floorMaterial,
    viewMode: s.viewMode,
    units: s.units,
    constructionRate: s.constructionRate,
    northOffset: s.northOffset,
    plotFacing: s.plotFacing,
  }
}

/** True when anything that would be written to disk has moved. */
export function persistedChanged(
  a: PersistedFingerprint | null,
  b: PersistedFingerprint,
): boolean {
  if (!a) return true
  return (Object.keys(b) as (keyof PersistedFingerprint)[]).some(
    (key) => a[key] !== b[key],
  )
}

/** Applies `patch` to one wall, leaving every other wall's identity untouched. */
/**
 * Applies `patch` to one wall, leaving every other wall's identity untouched —
 * and returning the ORIGINAL array when there was no such wall.
 *
 * The early return is not an optimisation. `map` allocates unconditionally, so
 * patching an id that no longer exists used to hand back a new array that was
 * structurally identical to the old one. `designChanged` compares by reference,
 * so the undo recorder read that as an edit and pushed a history step in which
 * nothing had changed — leaving the user a ⌘Z that visibly does nothing.
 *
 * Reachable whenever a write races a delete: the inspector holds an id, the
 * 3D view or the Delete key removes the wall, and the next keystroke in a
 * dimension field patches a wall that is gone. §10 rule 10 names this exact
 * hazard — *"a `.map()` in the store that returns a structurally-identical new
 * array"*.
 */
const patchWall = (walls: Wall[], id: string, fn: (wall: Wall) => Wall) =>
  walls.some((wall) => wall.id === id)
    ? walls.map((wall) => (wall.id === id ? fn(wall) : wall))
    : walls

/**
 * Single source of truth for the design. Both the 2D editor and the 3D scene
 * read from here, so a wall drawn in plan view is the same object either mode
 * renders.
 */
/**
 * The slice of state undo/redo captures: everything that is "the design",
 * nothing that is "how you are looking at it". Kept as references — the store
 * only ever replaces these with new immutable values, never mutates in place,
 * so a snapshot is a handful of pointers, and reference equality is enough to
 * tell a real edit from a view change.
 */
export type DesignSnapshot = Pick<
  DesignState,
  | 'walls'
  | 'roomLabels'
  | 'furniture'
  | 'stairs'
  | 'floors'
  | 'activeFloor'
  | 'plot'
  | 'plotFacing'
  | 'northOffset'
  | 'floorMaterial'
  | 'blueprint'
>

function snapshotOf(s: DesignState): DesignSnapshot {
  return {
    walls: s.walls,
    roomLabels: s.roomLabels,
    furniture: s.furniture,
    stairs: s.stairs,
    floors: s.floors,
    activeFloor: s.activeFloor,
    plot: s.plot,
    plotFacing: s.plotFacing,
    northOffset: s.northOffset,
    floorMaterial: s.floorMaterial,
    blueprint: forgetPixels(s.blueprint),
  }
}

/**
 * A blueprint as history may keep it: everything except the object URL.
 *
 * `setBlueprint` revokes the outgoing URL, because holding it would leak the
 * whole decoded image for the life of the tab. But the outgoing blueprint is
 * also in the undo snapshot, so undo used to hand back a `Blueprint` whose
 * `src` had already been revoked — an image that silently fails to load, with
 * the panel's own "remembers the file but not the image" message never firing,
 * because it tests `!blueprint.src` and a revoked URL is still a string.
 *
 * Dropping the URL on the way into history is the honest resolution. What comes
 * back is the state a reopened project is already in — the file it was traced
 * from and the scale it was measured at, with no pixels — which the panel
 * explains and the user can fix by re-picking the file. The alternative, keeping
 * every replaced image alive in case an undo wants it, trades a confusing bug
 * for an unbounded one.
 *
 * The cost is that redo also comes back without pixels, even though that image
 * may still be on screen. That is the smaller of the two surprises.
 */
const forgetPixels = (blueprint: Blueprint | null): Blueprint | null =>
  blueprint === null || blueprint.src === null ? blueprint : { ...blueprint, src: null }

/**
 * Whether the design — as opposed to the way it is being looked at — moved.
 *
 * Everything but the blueprint is compared by reference, which is sound
 * because the store only ever replaces these with new immutable values.
 *
 * The blueprint is the exception, and deliberately so. It carries two kinds of
 * field: its scale and placement, which ARE the design (a calibration must be
 * undoable — losing one used to be unrecoverable), and its opacity and
 * visibility, which are how you are looking at it. Comparing the object by
 * reference would put an undo step behind every frame of an opacity drag. So
 * only the design-bearing fields are compared here.
 *
 * The cost is that undoing a calibration also restores whatever opacity was in
 * force when it was made. That is a real but invisible side effect, and it is
 * the cheaper of the two mistakes.
 */
function blueprintChanged(a: Blueprint | null, b: Blueprint | null): boolean {
  if (a === b) return false
  if (!a || !b) return true
  return (
    // Which drawing this is. `src` alone used to carry that, but snapshots no
    // longer hold one (see `forgetPixels`), so swapping one underlay for
    // another would otherwise look like no change at all and quietly stop
    // being undoable.
    a.fileName !== b.fileName ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.metresPerPixel !== b.metresPerPixel ||
    a.origin !== b.origin ||
    a.calibration !== b.calibration
  )
}

function designChanged(a: DesignSnapshot, b: DesignSnapshot): boolean {
  return (
    a.walls !== b.walls ||
    a.roomLabels !== b.roomLabels ||
    a.furniture !== b.furniture ||
    a.stairs !== b.stairs ||
    a.floors !== b.floors ||
    a.activeFloor !== b.activeFloor ||
    a.plot !== b.plot ||
    a.plotFacing !== b.plotFacing ||
    a.northOffset !== b.northOffset ||
    a.floorMaterial !== b.floorMaterial ||
    blueprintChanged(a.blueprint, b.blueprint)
  )
}

/**
 * The undo recorder for this store.
 *
 * Assigned immediately after `create` below, because the engine subscribes to
 * the store it records. The actions read it through the optional call, which
 * only matters for the instant between the store existing and the engine being
 * attached — during which `past` is empty and undo had nothing to do anyway.
 */
let history: History | undefined

export const useDesignStore = create<DesignState>()((set, get) => ({
  viewMode: '2d',
  walkMode: false,
  walkView: 'third',
  tool: 'wall',
  selection: null,
  floors: [emptyFloor(0), emptyFloor(1), emptyFloor(2)],
  activeFloor: 0,
  walls: [],
  furniture: [],
  roomLabels: [],
  stairs: [],
  floorMaterial: DEFAULT_FLOOR_MATERIAL,
  units: DEFAULT_UNIT,
  constructionRate: 0,
  plot: null,
  northOffset: 0,
  plotFacing: DEFAULT_FACING,
  blueprint: null,
  projectName: null,
  aiPanelOpen: false,
  furniturePanelOpen: false,
  blueprintPanelOpen: false,
  roomPanelOpen: false,
  vastuPanelOpen: false,
  plotPanelOpen: false,
  vastuGrid: false,
  showDimensions: false,
  showCompass: true,
  blueprintCalibrating: false,
  presentMode: false,
  readOnly: false,
  autosave: { kind: 'idle' },
  viewEpoch: 0,
  historyEpoch: 0,
  past: [],
  future: [],

  // Delegated: the engine owns the guard that stops its own writes being
  // recorded as fresh edits, and the baseline they have to leave behind.
  undo: () => history?.undo(),

  redo: () => history?.redo(),

  // Leaving 3D always drops out of walk mode — otherwise returning to 3D would
  // silently re-enter first-person with the pointer already captured.
  setViewMode: (mode) =>
    set(mode === '3d' ? { viewMode: mode } : { viewMode: mode, walkMode: false }),

  setWalkMode: (walking) => set({ walkMode: walking }),

  setWalkView: (walkView) => set({ walkView }),

  setTool: (tool) => set({ tool }),

  select: (selection) => set({ selection }),

  setProjectName: (projectName) => set({ projectName }),

  setAiPanelOpen: (aiPanelOpen) => set({ aiPanelOpen }),

  setFurniturePanelOpen: (furniturePanelOpen) => set({ furniturePanelOpen }),

  setBlueprintPanelOpen: (blueprintPanelOpen) => set({ blueprintPanelOpen }),

  setRoomPanelOpen: (roomPanelOpen) => set({ roomPanelOpen }),

  setVastuPanelOpen: (vastuPanelOpen) => set({ vastuPanelOpen }),

  setPlotPanelOpen: (plotPanelOpen) => set({ plotPanelOpen }),
  setAutosave: (autosave) => set({ autosave }),

  setShowDimensions: (showDimensions) => set({ showDimensions }),
  setShowCompass: (showCompass) => set({ showCompass }),

  setActiveFloor: (index) =>
    set((state) => {
      if (index === state.activeFloor) return {}
      const floors = fileActiveFloor(state)
      const target = floors[index]
      if (!target) return {}

      return {
        floors,
        activeFloor: index,
        walls: target.walls,
        furniture: target.furniture,
        roomLabels: target.roomLabels,
        stairs: target.stairs,
        // Ids belong to the floor being left, and walking a storey that is no
        // longer on screen would be disorienting.
        selection: null,
        walkMode: false,
        viewEpoch: state.viewEpoch + 1,
      }
    }),

  copyToNextFloor: () => {
    const state = get()
    const next = state.activeFloor + 1
    const target = state.floors[next]
    if (!target) return false
    if (target.walls.length > 0 || target.furniture.length > 0) return false

    // Fresh ids throughout: sharing an id across storeys would make selecting a
    // wall upstairs also select the one below it. The original id is kept in
    // `sourceRef`, which is the one place it stays recoverable.
    const remap = <T extends { id: string }>(items: T[]): T[] =>
      items.map((item) => ({
        ...item,
        id: crypto.randomUUID(),
        provenance: provenance.copy(item.id),
      }))

    set((current) => ({
      floors: fileActiveFloor(current).map((floor, index) =>
        index === next
          ? {
              ...floor,
              walls: current.walls.map((wall) => ({
                ...wall,
                id: crypto.randomUUID(),
                provenance: provenance.copy(wall.id),
                start: { ...wall.start },
                end: { ...wall.end },
                openings: remap(wall.openings).map((o) => ({ ...o })),
              })),
              furniture: current.furniture.map((item) => ({
                ...item,
                id: crypto.randomUUID(),
                provenance: provenance.copy(item.id),
                position: { ...item.position },
              })),
              roomLabels: current.roomLabels.map((label) => ({
                ...label,
                id: crypto.randomUUID(),
                provenance: provenance.copy(label.id),
                anchor: { ...label.anchor },
              })),
              // Stairs are not copied: the flight on this floor already rises
              // into the one above, and duplicating it would stack two flights
              // in the same shaft.
              stairs: [],
            }
          : floor,
      ),
    }))
    return true
  },

  addStair: (position, source) => {
    const stair: Stair = {
      id: crypto.randomUUID(),
      provenance: source,
      position: { ...position },
      rotation: 0,
      width: STAIR_DEFAULTS.width,
      run: STAIR_DEFAULTS.run,
    }
    set((state) => ({ stairs: [...state.stairs, stair] }))
    return stair.id
  },

  updateStair: (id, patch) =>
    set((state) => ({
      stairs: state.stairs.map((stair) =>
        stair.id === id
          ? {
              ...stair,
              position: patch.position ? { ...patch.position } : stair.position,
              rotation: patch.rotation ?? stair.rotation,
              width: clamp(patch.width ?? stair.width, 0.6, 4),
              run: clamp(patch.run ?? stair.run, 1, 12),
            }
          : stair,
      ),
    })),

  removeStair: (id) =>
    set((state) => ({
      stairs: state.stairs.filter((stair) => stair.id !== id),
      selection:
        state.selection?.kind === 'stair' && state.selection.stairId === id
          ? null
          : state.selection,
    })),

  setPlot: (plot) => set({ plot }),

  updatePlot: (patch) =>
    set((state) =>
      state.plot
        ? {
            plot: {
              ...state.plot,
              width: clamp(patch.width ?? state.plot.width, 0.5, 5000),
              depth: clamp(patch.depth ?? state.plot.depth, 0.5, 5000),
              origin: patch.origin ? { ...patch.origin } : state.plot.origin,
            },
          }
        : {},
    ),

  // Setbacks are clamped against the plot itself: two setbacks that together
  // exceed the plot would invert the buildable rectangle, and everything
  // downstream would then be measuring a negative-sized box.
  setSetback: (edge, metres) =>
    set((state) => {
      if (!state.plot) return {}
      const span =
        edge === 'left' || edge === 'right' ? state.plot.width : state.plot.depth
      return {
        plot: {
          ...state.plot,
          setbacks: {
            ...state.plot.setbacks,
            [edge]: clamp(metres, 0, Math.max(0, span)),
          },
        },
      }
    }),

  setVastuGrid: (vastuGrid) => set({ vastuGrid }),

  setBlueprintCalibrating: (blueprintCalibrating) => set({ blueprintCalibrating }),

  nameRoom: (anchor, type, source) => {
    const label: RoomLabel = {
      id: crypto.randomUUID(),
      provenance: source,
      type,
      anchor: { ...anchor },
    }
    set((state) => ({ roomLabels: [...state.roomLabels, label] }))
    return label.id
  },

  nameOpenSpace: (boundary, type, source) => {
    if (boundary.length < 3) return null
    // Shoelace: a ring the user dragged to nothing has no interior, and a
    // zero-area space in the schedule is worse than no space at all.
    let twice = 0
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i]
      const b = boundary[(i + 1) % boundary.length]
      twice += a.x * b.z - b.x * a.z
    }
    if (Math.abs(twice / 2) < MIN_OPEN_SPACE_AREA) return null

    const label: RoomLabel = {
      id: crypto.randomUUID(),
      provenance: source,
      type,
      // The anchor still matters: if walls ever close around this point, pass 1
      // claims the enclosure and the outline stops being used (B25 precedence).
      anchor: {
        x: boundary.reduce((s, p) => s + p.x, 0) / boundary.length,
        z: boundary.reduce((s, p) => s + p.z, 0) / boundary.length,
      },
      openBoundary: boundary.map((p) => ({ ...p })),
    }
    set((state) => ({ roomLabels: [...state.roomLabels, label] }))
    return label.id
  },

  updateRoomLabel: (id, patch) =>
    set((state) => ({
      roomLabels: state.roomLabels.map((label) =>
        label.id === id
          ? {
              ...label,
              type: patch.type ?? label.type,
              name: patch.name !== undefined ? patch.name : label.name,
            }
          : label,
      ),
    })),

  removeRoomLabel: (id) =>
    set((state) => ({
      roomLabels: state.roomLabels.filter((label) => label.id !== id),
    })),

  // Object URLs live until revoked; dropping the reference alone would leak
  // the whole decoded image for the life of the tab. A null `src` is a
  // remembered placement with no pixels attached and has nothing to revoke.
  setBlueprint: (blueprint) =>
    set((state) => {
      const previous = state.blueprint
      if (previous?.src && previous.src !== blueprint?.src) {
        URL.revokeObjectURL(previous.src)
      }
      return { blueprint }
    }),

  updateBlueprint: (patch) =>
    set((state) =>
      state.blueprint
        ? {
            blueprint: {
              ...state.blueprint,
              ...patch,
              origin: patch.origin ? { ...patch.origin } : state.blueprint.origin,
            },
          }
        : {},
    ),

  // Present mode is a 3D walkthrough by definition, so it forces both.
  // Leaving it restores orbit rather than stranding the pointer captured.
  setPresentMode: (on) =>
    set(
      on
        ? { presentMode: true, viewMode: '3d', walkMode: true, selection: null }
        : { presentMode: false, walkMode: false },
    ),

  setFloorMaterial: (floorMaterial) => set({ floorMaterial }),

  setUnits: (units) => set({ units }),

  setConstructionRate: (rupeesPerSqFt) =>
    set({
      constructionRate:
        Number.isFinite(rupeesPerSqFt) && rupeesPerSqFt > 0 ? rupeesPerSqFt : 0,
    }),

  // Wrapped on the way in so nothing downstream has to defend against a
  // northOffset of 720 or -30 arriving from a drag or a loaded file.
  setNorthOffset: (degrees) =>
    set({
      northOffset: Number.isFinite(degrees)
        ? ((degrees % 360) + 360) % 360
        : 0,
    }),

  setPlotFacing: (plotFacing) => set({ plotFacing }),

  addFurniture: (type, position, source) => {
    const item: FurnitureItem = {
      id: crypto.randomUUID(),
      provenance: source,
      type,
      position: { ...position },
      rotation: 0,
    }
    set((state) => ({ furniture: [...state.furniture, item] }))
    return item.id
  },

  updateFurniture: (id, patch) =>
    set((state) => ({
      furniture: state.furniture.map((item) =>
        item.id === id
          ? {
              ...item,
              position: patch.position ? { ...patch.position } : item.position,
              rotation: patch.rotation ?? item.rotation,
              width:
                patch.width !== undefined
                  ? clamp(patch.width, LIMITS.furnitureSize.min, LIMITS.furnitureSize.max)
                  : item.width,
              depth:
                patch.depth !== undefined
                  ? clamp(patch.depth, LIMITS.furnitureSize.min, LIMITS.furnitureSize.max)
                  : item.depth,
            }
          : item,
      ),
    })),

  removeFurniture: (id) =>
    set((state) => ({
      furniture: state.furniture.filter((item) => item.id !== id),
      selection:
        state.selection?.kind === 'furniture' && state.selection.furnitureId === id
          ? null
          : state.selection,
    })),

  loadDesign: ({
    name,
    walls,
    furniture,
    roomLabels,
    stairs,
    floors,
    floorMaterial,
    viewMode,
    units,
    constructionRate,
    plot,
    northOffset,
    plotFacing,
    blueprint,
    readOnly,
  }) =>
    set((state) => {
      // The outgoing underlay owns an object URL; nothing else will revoke it
      // once the store stops pointing at it.
      if (state.blueprint?.src && state.blueprint.src !== blueprint?.src) {
        URL.revokeObjectURL(state.blueprint.src)
      }
      return {
      walls: walls.map(normalizeWall),
      furniture: furniture ?? [],
      roomLabels: roomLabels ?? [],
      stairs: stairs ?? [],
      // A design always has three storeys' worth of slots even when only the
      // ground floor is drawn, so the floor selector never has to grow one.
      floors: (floors ?? []).length
        ? [0, 1, 2].map(
            (index) =>
              floors?.[index] ?? emptyFloor(index),
          )
        : [
            {
              ...emptyFloor(0),
              walls: walls.map(normalizeWall),
              furniture: furniture ?? [],
              roomLabels: roomLabels ?? [],
              stairs: stairs ?? [],
            },
            emptyFloor(1),
            emptyFloor(2),
          ],
      activeFloor: 0,
      floorMaterial: floorMaterial ?? DEFAULT_FLOOR_MATERIAL,
      // A file written before units existed keeps whatever the viewer prefers,
      // rather than silently flipping them to metric.
      units: units ?? state.units,
      constructionRate: constructionRate ?? 0,
      plot: plot ?? null,
      northOffset: northOffset ?? 0,
      plotFacing: plotFacing ?? DEFAULT_FACING,
      projectName: name ?? null,
      viewMode: viewMode ?? state.viewMode,
      readOnly: readOnly ?? state.readOnly,
      blueprint: blueprint ?? null,
      // Selection holds ids from the design being replaced, and walk mode
      // would drop the user inside a building that no longer exists.
      selection: null,
      walkMode: false,
      viewEpoch: state.viewEpoch + 1,
      // A different document entirely: the old history describes a design that
      // is no longer open, so keeping it would let one undo silently restore it.
      historyEpoch: state.historyEpoch + 1,
      }
    }),

  newDesign: () =>
    set((state) => ({
      floors: [emptyFloor(0), emptyFloor(1), emptyFloor(2)],
      activeFloor: 0,
      walls: [],
      furniture: [],
      roomLabels: [],
      stairs: [],
      plot: null,
      floorMaterial: DEFAULT_FLOOR_MATERIAL,
      projectName: null,
      selection: null,
      walkMode: false,
      viewEpoch: state.viewEpoch + 1,
      historyEpoch: state.historyEpoch + 1,
    })),

  resetToEmpty: (view) =>
    set((state) => {
      // The outgoing underlay owns an object URL, and nothing else will revoke
      // it once the store stops pointing at it.
      if (state.blueprint?.src) URL.revokeObjectURL(state.blueprint.src)
      return {
        floors: [emptyFloor(0), emptyFloor(1), emptyFloor(2)],
        activeFloor: 0,
        walls: [],
        furniture: [],
        roomLabels: [],
        stairs: [],
        plot: null,
        blueprint: null,
        floorMaterial: DEFAULT_FLOOR_MATERIAL,
        northOffset: 0,
        plotFacing: DEFAULT_FACING,
        constructionRate: 0,
        projectName: null,
        selection: null,
        walkMode: false,
        readOnly: view?.readOnly ?? state.readOnly,
        viewMode: view?.viewMode ?? state.viewMode,
        viewEpoch: state.viewEpoch + 1,
        // A different document — an empty one. Undoing back into the design
        // that was open before a share link replaced it is not something the
        // viewer asked for.
        historyEpoch: state.historyEpoch + 1,
      }
    }),

  replaceWalls: (walls, name) =>
    set((state) => ({
      // Normalised on the way in for the same reason `loadDesign` does it:
      // these walls came from outside the editor and have not been through
      // `updateWall`, so nothing has yet clamped them or their openings.
      walls: walls.map(normalizeWall),
      // Ids in the old walls are gone; a selection pointing at one would leave
      // the inspector describing a wall that no longer exists.
      selection: null,
      projectName: name === undefined ? state.projectName : name,
      // Refit: the new plan can be anywhere, and leaving the viewport on the
      // old one reads as the edit having done nothing.
      viewEpoch: state.viewEpoch + 1,
      // historyEpoch deliberately NOT bumped — this is an edit, and an edit is
      // undoable.
    })),

  addWall: (start, end, options) => {
    if (samePoint(start, end)) return null

    const wall: Wall = {
      id: crypto.randomUUID(),
      provenance: options.provenance,
      start: { ...start },
      end: { ...end },
      height: options?.height ?? WALL_DEFAULTS.height,
      thickness: options?.thickness ?? WALL_DEFAULTS.thickness,
      openings: [],
      material: DEFAULT_WALL_MATERIAL,
    }

    set((state) => ({ walls: [...state.walls, wall] }))
    return wall.id
  },

  // Shrinking a wall can strand its openings above the new roofline, so
  // `normalizeWall` re-constrains them against the wall's new dimensions.
  updateWall: (id, patch) =>
    set((state) => ({
      walls: patchWall(state.walls, id, (wall) =>
        normalizeWall({
          ...wall,
          height: patch.height ?? wall.height,
          thickness: patch.thickness ?? wall.thickness,
          material: patch.material ?? wall.material,
        }),
      ),
    })),

  setWallLength: (id, length) => {
    const state = get()
    const wall = state.walls.find((w) => w.id === id)
    if (!wall) return false

    const current = wallLength(wall)
    // A zero-length wall has no direction to grow along, so there is nothing
    // sensible to resize it to.
    if (current === 0) return false

    const target = Math.max(LIMITS.wallLength.min, length)
    const ux = (wall.end.x - wall.start.x) / current
    const uz = (wall.end.z - wall.start.z) / current
    const moved: Point = {
      x: wall.start.x + ux * target,
      z: wall.start.z + uz * target,
    }

    // Every OTHER wall endpoint sitting on the point about to move.
    const attached = joinsAt(state.walls, wall.end, id)

    // Three walls or more meeting here: there is no move that is right.
    // Dragging them all deforms walls the user did not select — and a
    // through-wall stored as two collinear segments would visibly bend.
    // Leaving them behind detaches this one, which is the bug being fixed.
    // Telling the user is the only honest option; §4's guidance is that a
    // refusal the user can see beats a change they cannot.
    if (attached.length > 1) return false

    set((s) => ({
      // ONE `set`, so the resize and the neighbour it drags are ONE undo step.
      // Not two writes 200 ms apart relying on the recorder's coalescing —
      // that would make undo depend on how fast the machine ran.
      walls: s.walls.map((w) => {
        if (w.id === id) {
          // Shortening can strand an opening past the new end, so re-clamp.
          return normalizeWall({ ...w, end: moved })
        }
        const join = attached.find((a) => a.wallId === w.id)
        if (!join) return w
        return normalizeWall({ ...w, [join.which]: { ...moved } })
      }),
    }))
    return true
  },

  /**
   * Closes every joint that looks connected and is not. Returns how many
   * endpoints moved, so the caller can say "nothing to connect" rather than
   * appear to have done nothing.
   */
  repairJoints: () => {
    const walls = get().walls
    const welded = weldJoints(walls)
    // Identity, not length: `weldJoints` hands back the ORIGINAL array when
    // there is nothing to do, which is what stops a no-op repair recording an
    // undo step the user cannot see (§10 rule 10).
    if (welded === walls) return 0

    const moved = findLooseJoints(walls).length
    // ONE `set`, so every endpoint that moves is ONE undo step — not one per
    // wall, and not several inside the recorder's coalescing window.
    set({ walls: welded })
    return moved
  },

  removeWall: (id) =>
    set((state) => ({
      walls: state.walls.filter((w) => w.id !== id),
      // Selection holds an id, not a reference — drop it or the panel would
      // point at a wall that no longer exists.
      selection: selectionWallId(state.selection) === id ? null : state.selection,
    })),

  clearWalls: () => set({ walls: [], selection: null }),

  clearFloor: () =>
    set({
      walls: [],
      roomLabels: [],
      furniture: [],
      stairs: [],
      selection: null,
    }),

  addOpening: (wallId, type, position, source) => {
    const wall = get().walls.find((w) => w.id === wallId)
    if (!wall) return null

    const defaults = OPENING_DEFAULTS[type]
    // A wall shorter than the opening cannot hold it at any position.
    if (wallLength(wall) < defaults.width) return null

    const opening = constrainOpening(
      {
        id: crypto.randomUUID(),
        provenance: source,
        type,
        position,
        ...defaults,
        // Only a door swings. A fresh copy rather than the shared constant, so
        // a later `updateOpening` on one door cannot reach every other door.
        ...(type === 'door' ? { swing: { ...DEFAULT_SWING } } : {}),
      },
      wall,
    )

    set((state) => ({
      walls: patchWall(state.walls, wallId, (w) => ({
        ...w,
        openings: [...w.openings, opening],
      })),
    }))
    return opening.id
  },

  updateOpening: (wallId, openingId, patch) =>
    set((state) => ({
      walls: patchWall(state.walls, wallId, (wall) => ({
        ...wall,
        openings: wall.openings.map((o) =>
          o.id === openingId ? constrainOpening({ ...o, ...patch }, wall) : o,
        ),
      })),
    })),

  removeOpening: (wallId, openingId) =>
    set((state) => ({
      walls: patchWall(state.walls, wallId, (wall) => ({
        ...wall,
        openings: wall.openings.filter((o) => o.id !== openingId),
      })),
      selection:
        state.selection?.kind === 'opening' &&
        state.selection.openingId === openingId
          ? null
          : state.selection,
    })),
}))

// ---- Undo/redo recorder ----
//
// Records design edits into `past` as they settle, coalescing a burst (a drag)
// into one step. Attached here rather than built in, so the engine is a thing
// this store HAS and not a thing the module IS — see `history.ts`.
history = createHistory<DesignSnapshot, DesignState>({
  store: useDesignStore,
  snapshotOf,
  changed: designChanged,
  epochOf: (state) => state.historyEpoch,
})
