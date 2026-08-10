import {
  DEFAULT_FACING,
  DEFAULT_UNIT,
  FLOOR_NAMES,
  isFacing,
  isUnit,
  OPENING_DEFAULTS,
  STAIR_DEFAULTS,
  WALL_DEFAULTS,
  type Blueprint,
  type Calibration,
  type CalibrationSource,
  type FurnitureItem,
  type Opening,
  type OpeningType,
  type Facing,
  type FloorData,
  type Plot,
  type Point,
  type Provenance,
  type ProvenanceSource,
  type RoomLabel,
  type RoomType,
  type Stair,
  type Swing,
  type Unit,
  type ViewMode,
  type Wall,
} from '../store/useDesignStore'
import {
  DEFAULT_FLOOR_MATERIAL,
  DEFAULT_WALL_MATERIAL,
  isMaterialId,
  type MaterialId,
} from '../materials/palette'
import { isFurnitureType } from '../furniture/catalog'
import { withBoundaryHints } from '../rooms/resolve'

/**
 * Bump when the on-disk shape changes, and add an entry to `MIGRATIONS`.
 * Files carry their version so an old export stays loadable.
 *
 * v1 → v2: `blueprint` added. A v1 file has no traced underlay recorded, so it
 *          migrates to `blueprint: null`.
 * v2 → v3: room identity + provenance. Every element gains an optional
 *          `Provenance`, and room labels gain stable ids where they had none.
 * v3 → v4: a door's swing is in the model. Every door gains the `Swing` its
 *          renderers had been hard-coding, so a saved plan states which way its
 *          doors open instead of letting each renderer decide.
 */
export const DESIGN_VERSION = 4

/**
 * A traced blueprint as it is saved: everything except the pixels.
 *
 * `src` is an object URL — valid for one session of one tab — so it is the one
 * field that cannot be persisted. Everything that took the user effort can be:
 * which file it was, how big it is, where it sits, and above all the scale and
 * how it was arrived at. Reopening a project therefore remembers a measurement
 * instead of asking for it again.
 */
export type PersistedBlueprint = Omit<Blueprint, 'src'>

export type DesignDocument = {
  version: number
  name: string
  /** ISO 8601. */
  savedAt: string
  settings: {
    viewMode: ViewMode
    floorMaterial: MaterialId
    units: Unit
    /** Rupees per square foot, or 0 when no rate has been set. */
    constructionRate: number
    /** Degrees clockwise from plan-up. */
    northOffset: number
    plotFacing: Facing
  }
  walls: Wall[]
  furniture: FurnitureItem[]
  rooms: RoomLabel[]
  /** The site boundary, or null when the design is not on a defined plot. */
  plot: Plot | null
  /**
   * Every storey. The top-level `walls` / `furniture` / `rooms` remain the
   * ground floor so that a file written now still opens in a build that
   * predates multiple floors, and one written then still opens here.
   */
  floors: FloorData[]
  /** The traced underlay's placement and scale, without its pixels. */
  blueprint: PersistedBlueprint | null
}

export type ParseResult =
  | {
      ok: true
      doc: DesignDocument
      warnings: string[]
      /**
       * The version the file was actually written at, before migration.
       *
       * `doc.version` is always `DESIGN_VERSION` — the document has been
       * brought forward. Callers that need to know where it came from (to say
       * "upgraded from an older format", or to decide whether re-saving is
       * lossy) need the original, and the old code discarded it.
       */
      originalVersion: number
    }
  | { ok: false; error: string }

export function serializeDesign(input: {
  name: string
  walls: Wall[]
  viewMode: ViewMode
  furniture?: FurnitureItem[]
  roomLabels?: RoomLabel[]
  /**
   * Ground-floor stairs. Accepted but NOT written: `DesignDocument` has no
   * top-level `stairs`, and every storey's stairs already travel inside
   * `floors[]`. Kept in the signature because four call sites pass it and
   * removing it would read as a behaviour change when it is a no-op.
   */
  stairs?: Stair[]
  floors?: FloorData[]
  plot?: Plot | null
  floorMaterial?: MaterialId
  units?: Unit
  constructionRate?: number
  northOffset?: number
  plotFacing?: Facing
  /** The traced underlay, if any. Its `src` is dropped — see PersistedBlueprint. */
  blueprint?: Blueprint | null
  savedAt?: string
}): DesignDocument {
  return {
    version: DESIGN_VERSION,
    name: input.name,
    savedAt: input.savedAt ?? new Date().toISOString(),
    settings: {
      viewMode: input.viewMode,
      floorMaterial: input.floorMaterial ?? DEFAULT_FLOOR_MATERIAL,
      units: input.units ?? DEFAULT_UNIT,
      constructionRate: input.constructionRate ?? 0,
      northOffset: input.northOffset ?? 0,
      plotFacing: input.plotFacing ?? DEFAULT_FACING,
    },
    walls: input.walls,
    furniture: input.furniture ?? [],
    // Hinted HERE, at save time, and nowhere else — see `RoomLabel.boundaryHint`
    // for why writing it during a resolve would break B8's cache, the render
    // loop and the undo recorder at once. Only the active storey: the other
    // floors' walls are frozen in `floors[]`, so their hints cannot be stale,
    // and resolving all three would take autosave from a measured 2.2 ms to
    // ~35 ms against §9.2's 20 ms budget.
    rooms: withBoundaryHints(input.walls, input.roomLabels ?? []),
    plot: input.plot ?? null,
    floors: input.floors ?? [],
    blueprint: input.blueprint ? stripSrc(input.blueprint) : null,
  }
}

/** Everything about a blueprint except the object URL, which cannot outlive the tab. */
function stripSrc(blueprint: Blueprint): PersistedBlueprint {
  const { src: _src, ...persisted } = blueprint
  return persisted
}

/**
 * A remembered placement, ready for the store, with no image attached.
 *
 * `src: null` is the whole difference between "this project was traced from
 * site-plan.png at a scale you measured" and "there is no blueprint". The
 * first is worth keeping across a reload; only the pixels are not.
 */
export const attachable = (
  blueprint: PersistedBlueprint | null,
): Blueprint | null => (blueprint ? { ...blueprint, src: null } : null)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Numbers only, and only real ones. `Number.isFinite` is the important part:
 * JSON cannot encode NaN or Infinity, but `1e999` parses to Infinity and would
 * otherwise flow into geometry and produce an unrenderable scene.
 */
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function parsePoint(value: unknown): Point | null {
  if (!isRecord(value)) return null
  const x = num(value.x)
  const z = num(value.z)
  return x === null || z === null ? null : { x, z }
}

function parseOpening(
  value: unknown,
  /** Position within the document, for the id fallback: "<wall>-<n>". */
  key: string,
  ids: Set<string>,
): Opening | null {
  if (!isRecord(value)) return null

  const type = value.type
  // No version bump for `'cased'`: a v4 file containing one is still v4, and
  // a build that predates it rejects the opening rather than misreading it.
  // Forward-rejection is the correct behaviour here and is already covered —
  // the parser drops an unknown type with a warning instead of guessing.
  if (!isOpeningType(type)) return null
  const defaults = OPENING_DEFAULTS[type]

  const position = num(value.position)
  if (position === null) return null

  const swing = parseSwing(value.swing, type)

  return withProvenance<Opening>(
    {
      id: uniqueId(str(value.id), ids, `opening-${key}`),
      type,
      position,
      // Dimensions fall back to the type's defaults rather than failing the
      // whole import; they are clamped against the wall on load anyway.
      width: num(value.width) ?? defaults.width,
      height: num(value.height) ?? defaults.height,
      sill: num(value.sill) ?? defaults.sill,
      ...(swing ? { swing } : {}),
    },
    value,
  )
}

/**
 * Derived from `OPENING_DEFAULTS` rather than written out again, so a fourth
 * opening type cannot be added to the model and silently rejected at the file
 * boundary — which is what a hand-maintained list of accepted strings would
 * do, and what the old `type !== 'door' && type !== 'window'` did.
 */
const isOpeningType = (value: unknown): value is OpeningType =>
  typeof value === 'string' && value in OPENING_DEFAULTS

const SWING_HANDS: Swing['hand'][] = ['start', 'end']
const SWING_SIDES: Swing['side'][] = ['left', 'right']

/**
 * A door's swing off an untrusted document, or undefined.
 *
 * Three things drop it, and all three are deliberate:
 *
 * - **A window carrying one.** A window does not swing, so a swing on one is
 *   noise at best and a lie in the file at worst. Dropped here rather than in
 *   `constrainOpening`, because this is the trust boundary — §3's reason for
 *   `parseDesign` existing at all — and the geometry clamp is not.
 * - **A malformed hand or side.** `'middle'`, `1e999`, an object, a null.
 * - **A missing one**, which is every v3 file that skipped the migration and
 *   every hand-written fixture.
 *
 * Dropping is safe because it is not the same as losing the door: `doorSwing()`
 * falls back to `DEFAULT_SWING`, which IS the pre-v4 convention, so an opening
 * with no swing draws exactly as it drew in v3. Failing the whole opening
 * instead would cost the user a door over an annotation they never typed.
 */
function parseSwing(value: unknown, type: OpeningType): Swing | undefined {
  if (type !== 'door' || !isRecord(value)) return undefined
  const { hand, side } = value
  if (!(SWING_HANDS as unknown[]).includes(hand)) return undefined
  if (!(SWING_SIDES as unknown[]).includes(side)) return undefined
  return { hand: hand as Swing['hand'], side: side as Swing['side'] }
}

/**
 * Keeps ids unique across the document; React keys and selection depend on it.
 *
 * The fallback is DERIVED FROM POSITION, not random. It used to be
 * `crypto.randomUUID()`, which meant an element with no id got a different one
 * on every load — harmless while ids were decoration, corrupting the moment
 * they became identity-bearing (v3), because the same file would then diff
 * against itself and no future merge could line two copies up. Position is
 * stable for the same bytes, which is exactly the property required.
 */
function uniqueId(
  candidate: string | null,
  seen: Set<string>,
  fallback: string,
): string {
  let id = candidate && !seen.has(candidate) ? candidate : fallback
  // The fallback can itself collide with an explicit id elsewhere in the file.
  for (let n = 2; seen.has(id); n++) id = `${fallback}-${n}`
  seen.add(id)
  return id
}

const PROVENANCE_SOURCES: ProvenanceSource[] = [
  'manual',
  'cv',
  'ai',
  'import-dxf',
  'import-json',
  'copy',
  'unknown',
]

const isProvenanceSource = (value: unknown): value is ProvenanceSource =>
  typeof value === 'string' &&
  (PROVENANCE_SOURCES as string[]).includes(value)

/**
 * Provenance off an untrusted document, or undefined.
 *
 * An unrecognised `source` degrades to `'unknown'` rather than dropping the
 * record: the fact that SOMETHING claimed an origin is itself worth keeping,
 * and a future version's source name must not silently become "hand-drawn"
 * when opened in an older build. A missing or malformed `source` drops it
 * entirely — absent means "not recorded", which is honest.
 *
 * `confidence` is only kept when it is a real number in [0, 1]. Out-of-range
 * values are dropped rather than clamped: a clamp would turn a bug into a
 * plausible-looking figure, and this one is shown to the user (L5).
 */
function parseProvenance(value: unknown): Provenance | undefined {
  if (!isRecord(value)) return undefined
  if (value.source === undefined) return undefined

  const provenance: Provenance = {
    source: isProvenanceSource(value.source) ? value.source : 'unknown',
  }
  const confidence = num(value.confidence)
  if (confidence !== null && confidence >= 0 && confidence <= 1) {
    provenance.confidence = confidence
  }
  const createdAt = str(value.createdAt)
  if (createdAt) provenance.createdAt = createdAt
  const sourceRef = str(value.sourceRef)
  if (sourceRef) provenance.sourceRef = sourceRef
  return provenance
}

/** Attaches provenance only when there is some — an absent field stays absent. */
function withProvenance<T extends object>(element: T, raw: unknown): T {
  const provenance = parseProvenance(isRecord(raw) ? raw.provenance : null)
  return provenance ? { ...element, provenance } : element
}

type WallParse =
  | { ok: true; wall: Wall }
  | { ok: false; reason: string }
  | { ok: 'skip'; reason: string }

function parseWall(
  value: unknown,
  index: number,
  wallIds: Set<string>,
  openingIds: Set<string>,
): WallParse {
  if (!isRecord(value)) return { ok: false, reason: `wall ${index} is not an object` }

  const start = parsePoint(value.start)
  const end = parsePoint(value.end)
  if (!start || !end) {
    return { ok: false, reason: `wall ${index} has invalid start/end points` }
  }

  // A zero-length wall has no direction and no valid geometry. Drop it rather
  // than reject the file — it is meaningless, not malformed.
  if (start.x === end.x && start.z === end.z) {
    return { ok: 'skip', reason: `wall ${index} has zero length` }
  }

  const rawOpenings = value.openings
  if (rawOpenings !== undefined && !Array.isArray(rawOpenings)) {
    return { ok: false, reason: `wall ${index} has a non-array "openings"` }
  }

  const openings: Opening[] = []
  for (const [at, raw] of (rawOpenings ?? []).entries()) {
    const opening = parseOpening(raw, `${index}-${at}`, openingIds)
    // Silently dropping a bad opening is better than failing an otherwise
    // good file; the caller reports the count as a warning.
    if (opening) openings.push(opening)
  }

  return {
    ok: true,
    wall: withProvenance<Wall>(
      {
        id: uniqueId(str(value.id), wallIds, `wall-${index}`),
        start,
        end,
        height: num(value.height) ?? WALL_DEFAULTS.height,
        thickness: num(value.thickness) ?? WALL_DEFAULTS.thickness,
        openings,
        // An unknown material id (older file, hand-edited, renamed palette
        // entry) falls back rather than failing the import — a wall in the
        // wrong colour is recoverable; a rejected file is not.
        material: isMaterialId(value.material)
          ? value.material
          : DEFAULT_WALL_MATERIAL,
      },
      value,
    ),
  }
}

/**
 * A saved `boundaryHint`, or undefined.
 *
 * Three points minimum — fewer is not a polygon, and a hint that cannot bound
 * anything is worse than none because B7.6's matcher would still try to use it.
 * Every coordinate goes through `parsePoint`, so `1e999` is caught here rather
 * than in the geometry (§3).
 */
function parseBoundaryHint(value: unknown): Point[] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined
  const points: Point[] = []
  for (const raw of value) {
    const point = parsePoint(raw)
    // All or nothing: a ring with a hole punched in it describes a shape the
    // user never had.
    if (!point) return undefined
    points.push(point)
  }
  return points
}

const ROOM_TYPES: RoomType[] = [
  'living',
  'bedroom',
  'master-bedroom',
  'kitchen',
  'dining',
  'pooja',
  'toilet',
  'bathroom',
  'study',
  'store',
  'balcony',
  'guest-room',
  'staircase',
]

const isRoomType = (value: unknown): value is RoomType =>
  typeof value === 'string' && (ROOM_TYPES as string[]).includes(value)

function parseRoomLabel(
  value: unknown,
  index: number,
  ids: Set<string>,
): RoomLabel | null {
  if (!isRecord(value)) return null
  if (!isRoomType(value.type)) return null

  const anchor = parsePoint(value.anchor)
  if (!anchor) return null

  const label: RoomLabel = withProvenance<RoomLabel>(
    {
      // Position-derived when the file has no id. From v3 this id IS the
      // room's identity, so a random fallback would make the same file
      // disagree with itself between loads.
      id: uniqueId(str(value.id), ids, `room-${index}`),
      type: value.type,
      anchor,
    },
    value,
  )
  // The user's own label, when the saved document carries one.
  if (typeof value.name === 'string' && value.name.trim()) {
    label.name = value.name
  }
  const hint = parseBoundaryHint(value.boundaryHint)
  if (hint) label.boundaryHint = hint
  return label
}

/**
 * A plot is all-or-nothing: a boundary with a missing dimension is not a
 * boundary, so anything malformed drops the whole thing rather than inventing
 * a size the user never set.
 */
function parsePlot(value: unknown): Plot | null {
  if (!isRecord(value)) return null

  const width = num(value.width)
  const depth = num(value.depth)
  const origin = parsePoint(value.origin)
  if (width === null || depth === null || !origin) return null
  if (width <= 0 || depth <= 0) return null

  const raw = isRecord(value.setbacks) ? value.setbacks : {}
  const side = (v: unknown, span: number) => {
    const n = num(v)
    return n === null ? 0 : Math.min(Math.max(n, 0), span)
  }

  return {
    width,
    depth,
    origin,
    setbacks: {
      front: side(raw.front, depth),
      rear: side(raw.rear, depth),
      left: side(raw.left, width),
      right: side(raw.right, width),
    },
  }
}

const CALIBRATION_SOURCES: CalibrationSource[] = [
  'manual',
  'dxf-units',
  'vector',
  'ocr',
  'heuristic',
  'ai',
  'none',
]

const isCalibrationSource = (value: unknown): value is CalibrationSource =>
  typeof value === 'string' && (CALIBRATION_SOURCES as string[]).includes(value)

/**
 * A saved blueprint placement, or null when anything essential is missing.
 *
 * All-or-nothing like the plot, and for the same reason: a placement without a
 * scale is not a placement, and inventing one would put the underlay at a size
 * nobody chose. An unreadable `calibration` degrades to `source: 'none'`
 * instead — the numbers are still usable, only their provenance is lost, and
 * downgrading provenance is always safe because it can only make the authority
 * ladder more permissive toward a fresh measurement, never less.
 */
function parseBlueprint(value: unknown): PersistedBlueprint | null {
  if (!isRecord(value)) return null

  const fileName = str(value.fileName)
  const width = num(value.width)
  const height = num(value.height)
  const metresPerPixel = num(value.metresPerPixel)
  const origin = parsePoint(value.origin)
  if (fileName === null || width === null || height === null) return null
  if (metresPerPixel === null || metresPerPixel <= 0 || !origin) return null
  if (width <= 0 || height <= 0) return null

  const raw = isRecord(value.calibration) ? value.calibration : {}
  const calibrated = num(raw.metresPerPixel)
  const calibration: Calibration = {
    source: isCalibrationSource(raw.source) ? raw.source : 'none',
    // Kept consistent with the placement: the two are written together and a
    // file where they disagree has been hand-edited.
    metresPerPixel: calibrated !== null && calibrated > 0 ? calibrated : metresPerPixel,
    lockedByUser: raw.lockedByUser === true,
    setAt: str(raw.setAt) ?? new Date().toISOString(),
  }
  // A lock without a measurement behind it is not a lock. Only `manual` locks.
  if (calibration.source !== 'manual') calibration.lockedByUser = false

  const opacity = num(value.opacity)
  return {
    fileName,
    width,
    height,
    metresPerPixel,
    origin,
    opacity: opacity === null ? 0.5 : Math.min(1, Math.max(0.05, opacity)),
    visible: value.visible !== false,
    calibration,
  }
}

function parseStair(
  value: unknown,
  index: number,
  ids: Set<string>,
): Stair | null {
  if (!isRecord(value)) return null
  const position = parsePoint(value.position)
  if (!position) return null

  return withProvenance<Stair>(
    {
      id: uniqueId(str(value.id), ids, `stair-${index}`),
      position,
      rotation: num(value.rotation) ?? 0,
      width: num(value.width) ?? STAIR_DEFAULTS.width,
      run: num(value.run) ?? STAIR_DEFAULTS.run,
    },
    value,
  )
}

function parseFurniture(
  value: unknown,
  index: number,
  ids: Set<string>,
): FurnitureItem | null {
  if (!isRecord(value)) return null
  if (!isFurnitureType(value.type)) return null

  const position = parsePoint(value.position)
  if (!position) return null

  const item: FurnitureItem = withProvenance<FurnitureItem>(
    {
      id: uniqueId(str(value.id), ids, `furniture-${index}`),
      type: value.type,
      position,
      rotation: num(value.rotation) ?? 0,
    },
    value,
  )
  // Footprint overrides are optional — kept only when the saved document sets a
  // positive value, so an untouched piece round-trips with no size stored.
  const width = num(value.width)
  if (width !== null && width > 0) item.width = width
  const depth = num(value.depth)
  if (depth !== null && depth > 0) item.depth = depth
  return item
}

/**
 * One step forward in the on-disk format, keyed by the version it upgrades FROM.
 *
 * Every entry is a pure `(doc) => doc` on loosely-typed JSON, applied in order
 * by `migrate` below, so a v1 file opened in a v5 build runs 1→2→3→4→5 rather
 * than needing an N×N table of direct conversions.
 *
 * Rules for adding one:
 *   - never mutate the input; return a new object;
 *   - assume nothing about the input beyond the version it claims — it is
 *     untrusted JSON, and the per-field validators below still run afterwards;
 *   - ship an old-format fixture and a round-trip test with it (L7).
 *
 * `schema.ts` has carried a comment promising this mechanism since v1 and did
 * not have one: the only version handling was a forward-rejection. Building it
 * before it was needed rather than after is the whole point of L7.
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: the traced blueprint became part of the document. A v1 file was
  // written by a build that never persisted one, so there is nothing to
  // recover and `null` is the honest value — not a fabricated placement.
  1: (doc) => ({ ...doc, blueprint: null, version: 2 }),

  // v2 → v3: room identity + provenance.
  2: (doc) => {
    // From the FILE, never from the clock. `new Date()` here would migrate the
    // same bytes to a different document on each run — breaking L6, and making
    // the round-trip test below unwritable. Absent when the file has no
    // `savedAt`: an omitted date is honest, an invented one is not.
    const createdAt = str(doc.savedAt) ?? undefined

    // `'unknown'`, emphatically not `'manual'`. A v2 file can hold walls that
    // `buildWallsFromBlueprint` detected or that an AI edit produced, and
    // nothing on disk distinguishes them. L5 exists so the user can judge what
    // to trust; a confident lie is worse than an admission of ignorance. No
    // `confidence` either — absent means "not assessed", which is the truth.
    const stamp = <T>(element: T): T =>
      isRecord(element) && element.provenance === undefined
        ? { ...element, provenance: { source: 'unknown', ...(createdAt && { createdAt }) } }
        : element

    const stampAll = (raw: unknown): unknown =>
      Array.isArray(raw) ? raw.map(stamp) : raw

    // Walls carry openings, which are elements in their own right.
    const stampWalls = (raw: unknown): unknown =>
      Array.isArray(raw)
        ? raw.map((wall) =>
            isRecord(wall)
              ? stamp({ ...wall, openings: stampAll(wall.openings) })
              : wall,
          )
        : raw

    // Room ids become identity in v3. A label with none used to be handed a
    // fresh `crypto.randomUUID()` on every load, so the same file disagreed
    // with itself between sessions. Index-derived is stable for the same bytes.
    const stampRooms = (raw: unknown): unknown =>
      Array.isArray(raw)
        ? raw.map((label, i) =>
            isRecord(label)
              ? stamp({ ...label, id: str(label.id) ?? `room-${i}` })
              : label,
          )
        : raw

    const floors = Array.isArray(doc.floors)
      ? doc.floors.map((floor) =>
          isRecord(floor)
            ? {
                ...floor,
                walls: stampWalls(floor.walls),
                furniture: stampAll(floor.furniture),
                roomLabels: stampRooms(floor.roomLabels),
                stairs: stampAll(floor.stairs),
              }
            : floor,
        )
      : doc.floors

    return {
      ...doc,
      walls: stampWalls(doc.walls),
      furniture: stampAll(doc.furniture),
      rooms: stampRooms(doc.rooms),
      floors,
      version: 3,
    }
  },

  // v3 → v4: a door's swing is in the model.
  3: (doc) => {
    /**
     * The v3 convention, written as a LITERAL and deliberately not as
     * `DEFAULT_SWING`.
     *
     * Every renderer hinged at the jamb nearer the wall's start and swung the
     * leaf to the wall's left; this records exactly that, which is what makes
     * the migration invisible — a v3 document opens in v4 drawing precisely
     * what it drew before, so nobody's plans silently change.
     *
     * It is a literal because a migration is a statement about what the PAST
     * meant. Reaching for the current default would make this step's output
     * depend on a constant a future session is free to change, and the same
     * bytes would then migrate to two different documents — the same L6 failure
     * the v2→v3 step avoided by taking `createdAt` from the file, never the
     * clock.
     */
    const v3Swing = () => ({ hand: 'start', side: 'left' })

    const swingDoors = (raw: unknown): unknown =>
      Array.isArray(raw)
        ? raw.map((opening) =>
            isRecord(opening) &&
            opening.type === 'door' &&
            opening.swing === undefined
              ? { ...opening, swing: v3Swing() }
              : opening,
          )
        : raw

    const swingWalls = (raw: unknown): unknown =>
      Array.isArray(raw)
        ? raw.map((wall) =>
            isRecord(wall) ? { ...wall, openings: swingDoors(wall.openings) } : wall,
          )
        : raw

    const floors = Array.isArray(doc.floors)
      ? doc.floors.map((floor) =>
          isRecord(floor) ? { ...floor, walls: swingWalls(floor.walls) } : floor,
        )
      : doc.floors

    return {
      ...doc,
      walls: swingWalls(doc.walls),
      floors,
      version: 4,
    }
  },
}

/**
 * Brings a document forward to `DESIGN_VERSION`, one step at a time.
 *
 * A missing migration for a version we claim to support is a programming
 * error, not a bad file, so it throws rather than silently half-upgrading.
 */
function migrate(doc: Record<string, unknown>, from: number): Record<string, unknown> {
  let current = doc
  for (let version = from; version < DESIGN_VERSION; version++) {
    const step = MIGRATIONS[version]
    if (!step) {
      throw new Error(
        `No migration from design version ${version} to ${version + 1}. ` +
          'Every version between 1 and DESIGN_VERSION needs an entry in MIGRATIONS.',
      )
    }
    current = step(current)
  }
  return current
}

/**
 * Validates untrusted JSON into a design document.
 *
 * Anything structurally wrong fails with a message the UI can show. Anything
 * merely odd — a missing id, a bad opening, a zero-length wall — is repaired or
 * dropped and reported as a warning, so one bad row cannot cost the user their
 * whole file.
 *
 * Older files are migrated forward first, so every validator below only ever
 * sees the current shape.
 */
export function parseDesign(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, error: 'File is not a JSON object.' }

  const originalVersion = num(value.version)
  if (originalVersion === null) {
    return { ok: false, error: 'Missing "version" — not a Space Designer file.' }
  }
  if (originalVersion > DESIGN_VERSION) {
    return {
      ok: false,
      error: `File version ${originalVersion} is newer than this app supports (${DESIGN_VERSION}).`,
    }
  }
  if (originalVersion < 1 || !Number.isInteger(originalVersion)) {
    return { ok: false, error: `"version" ${originalVersion} is not a valid version.` }
  }

  value = migrate(value, originalVersion)
  if (!isRecord(value)) {
    return { ok: false, error: 'Migration produced an unreadable document.' }
  }

  if (!Array.isArray(value.walls)) {
    return { ok: false, error: 'Missing or invalid "walls" array.' }
  }

  const warnings: string[] = []
  const walls: Wall[] = []
  const wallIds = new Set<string>()
  const openingIds = new Set<string>()

  for (const [index, raw] of value.walls.entries()) {
    const parsed = parseWall(raw, index, wallIds, openingIds)
    if (parsed.ok === false) return { ok: false, error: parsed.reason }
    if (parsed.ok === 'skip') {
      warnings.push(parsed.reason)
      continue
    }

    const declared = isRecord(raw) && Array.isArray(raw.openings)
      ? raw.openings.length
      : 0
    const dropped = declared - parsed.wall.openings.length
    if (dropped > 0) {
      warnings.push(`wall ${index}: skipped ${dropped} invalid opening(s)`)
    }

    walls.push(parsed.wall)
  }

  // Furniture is optional — files written before Milestone 7 have none.
  const furniture: FurnitureItem[] = []
  const furnitureIds = new Set<string>()
  if (value.furniture !== undefined) {
    if (!Array.isArray(value.furniture)) {
      return { ok: false, error: 'Invalid "furniture" — expected an array.' }
    }
    for (const [i, raw] of value.furniture.entries()) {
      const item = parseFurniture(raw, i, furnitureIds)
      if (item) furniture.push(item)
    }
    const dropped = value.furniture.length - furniture.length
    if (dropped > 0) warnings.push(`skipped ${dropped} invalid furniture item(s)`)
  }

  // Rooms are optional — files written before Milestone 9 have none, and a
  // name whose anchor no longer lands in a space is simply dropped on load.
  const rooms: RoomLabel[] = []
  const roomIds = new Set<string>()
  if (value.rooms !== undefined) {
    if (!Array.isArray(value.rooms)) {
      return { ok: false, error: 'Invalid "rooms" — expected an array.' }
    }
    for (const [i, raw] of value.rooms.entries()) {
      const label = parseRoomLabel(raw, i, roomIds)
      if (label) rooms.push(label)
    }
    const dropped = value.rooms.length - rooms.length
    if (dropped > 0) warnings.push(`skipped ${dropped} invalid room name(s)`)
  }

  // Optional — files written before Milestone 13 have no floors array, and
  // their top-level walls ARE the ground floor. Reconstructing it here means
  // nothing downstream has to know which era a file came from.
  const floors: FloorData[] = []
  if (Array.isArray(value.floors) && value.floors.length > 0) {
    for (const [index, raw] of value.floors.entries()) {
      if (!isRecord(raw)) continue

      const floorWalls: Wall[] = []
      const fWallIds = new Set<string>()
      const fOpeningIds = new Set<string>()
      if (Array.isArray(raw.walls)) {
        for (const [i, rawWall] of raw.walls.entries()) {
          const parsed = parseWall(rawWall, i, fWallIds, fOpeningIds)
          if (parsed.ok === true) floorWalls.push(parsed.wall)
        }
      }

      const floorFurniture: FurnitureItem[] = []
      const fFurnitureIds = new Set<string>()
      if (Array.isArray(raw.furniture)) {
        for (const [i, rawItem] of raw.furniture.entries()) {
          const item = parseFurniture(rawItem, i, fFurnitureIds)
          if (item) floorFurniture.push(item)
        }
      }

      const floorRooms: RoomLabel[] = []
      const fRoomIds = new Set<string>()
      if (Array.isArray(raw.roomLabels)) {
        for (const [i, rawLabel] of raw.roomLabels.entries()) {
          const label = parseRoomLabel(rawLabel, i, fRoomIds)
          if (label) floorRooms.push(label)
        }
      }

      const floorStairs: Stair[] = []
      const fStairIds = new Set<string>()
      if (Array.isArray(raw.stairs)) {
        for (const [i, rawStair] of raw.stairs.entries()) {
          const stair = parseStair(rawStair, i, fStairIds)
          if (stair) floorStairs.push(stair)
        }
      }

      floors.push({
        // Position-derived, for the same reason as every other id here: a
        // random fallback made the same file parse to a different document on
        // every load. Storeys are indexed by `activeFloor` today and become
        // first-class `Level`s in v4, so this one is going to matter more, not
        // less. Found by the v3 round-trip test, which was comparing two loads
        // of one fixture and saw only the floor id differ.
        id: str(raw.id) ?? `floor-${index}`,
        name: str(raw.name) ?? FLOOR_NAMES[index] ?? `Floor ${index}`,
        walls: floorWalls,
        furniture: floorFurniture,
        roomLabels: floorRooms,
        stairs: floorStairs,
      })
    }
  }

  // Optional — files written before Milestone 12 have no plot at all.
  const plot = value.plot === undefined ? null : parsePlot(value.plot)
  if (value.plot !== undefined && value.plot !== null && !plot) {
    warnings.push('dropped an invalid plot boundary')
  }

  const settings = isRecord(value.settings) ? value.settings : {}
  const viewMode = settings.viewMode === '3d' ? '3d' : '2d'
  const floorMaterial = isMaterialId(settings.floorMaterial)
    ? settings.floorMaterial
    : DEFAULT_FLOOR_MATERIAL
  // Files predating the unit setting simply carry the default.
  const units = isUnit(settings.units) ? settings.units : DEFAULT_UNIT
  // A file from before orientation existed reads as North-up, which is what it
  // was drawn as. Wrapped here so a hand-edited 450 cannot reach the compass.
  const rawRate = num(settings.constructionRate)
  const constructionRate = rawRate !== null && rawRate > 0 ? rawRate : 0
  const rawNorth = num(settings.northOffset)
  const northOffset = rawNorth === null ? 0 : ((rawNorth % 360) + 360) % 360
  const plotFacing = isFacing(settings.plotFacing)
    ? settings.plotFacing
    : DEFAULT_FACING

  // Optional — v1 files carry none, and a placement that fails validation is
  // dropped rather than rejecting an otherwise good design: the underlay is a
  // tracing aid, and losing it costs less than losing the plan.
  const blueprint = value.blueprint == null ? null : parseBlueprint(value.blueprint)
  if (value.blueprint != null && !blueprint) {
    warnings.push('dropped an unreadable blueprint placement')
  }

  return {
    ok: true,
    warnings,
    originalVersion,
    doc: {
      version: DESIGN_VERSION,
      name: str(value.name) ?? 'Untitled',
      savedAt: str(value.savedAt) ?? new Date().toISOString(),
      settings: {
        viewMode,
        floorMaterial,
        units,
        constructionRate,
        northOffset,
        plotFacing,
      },
      walls,
      furniture,
      rooms,
      plot,
      floors,
      blueprint,
    },
  }
}
