import {
  DEFAULT_FACING,
  DEFAULT_UNIT,
  FLOOR_NAMES,
  isFacing,
  isUnit,
  OPENING_DEFAULTS,
  STAIR_DEFAULTS,
  WALL_DEFAULTS,
  type FurnitureItem,
  type Opening,
  type OpeningType,
  type Facing,
  type FloorData,
  type Plot,
  type Point,
  type RoomLabel,
  type RoomType,
  type Stair,
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

/**
 * Bump when the on-disk shape changes incompatibly, and add a migration in
 * `parseDesign`. Files carry their version so an old export stays loadable.
 */
export const DESIGN_VERSION = 1

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
}

export type ParseResult =
  | { ok: true; doc: DesignDocument; warnings: string[] }
  | { ok: false; error: string }

export function serializeDesign(input: {
  name: string
  walls: Wall[]
  viewMode: ViewMode
  furniture?: FurnitureItem[]
  roomLabels?: RoomLabel[]
  stairs?: Stair[]
  floors?: FloorData[]
  plot?: Plot | null
  floorMaterial?: MaterialId
  units?: Unit
  constructionRate?: number
  northOffset?: number
  plotFacing?: Facing
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
    rooms: input.roomLabels ?? [],
    plot: input.plot ?? null,
    floors: input.floors ?? [],
  }
}

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

function parseOpening(value: unknown, ids: Set<string>): Opening | null {
  if (!isRecord(value)) return null

  const type = value.type
  if (type !== 'door' && type !== 'window') return null
  const defaults = OPENING_DEFAULTS[type as OpeningType]

  const position = num(value.position)
  if (position === null) return null

  return {
    id: uniqueId(str(value.id), ids),
    type,
    position,
    // Dimensions fall back to the type's defaults rather than failing the
    // whole import; they are clamped against the wall on load anyway.
    width: num(value.width) ?? defaults.width,
    height: num(value.height) ?? defaults.height,
    sill: num(value.sill) ?? defaults.sill,
  }
}

/** Keeps ids unique across the document; React keys and selection depend on it. */
function uniqueId(candidate: string | null, seen: Set<string>): string {
  const id = candidate && !seen.has(candidate) ? candidate : crypto.randomUUID()
  seen.add(id)
  return id
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
  for (const raw of rawOpenings ?? []) {
    const opening = parseOpening(raw, openingIds)
    // Silently dropping a bad opening is better than failing an otherwise
    // good file; the caller reports the count as a warning.
    if (opening) openings.push(opening)
  }

  return {
    ok: true,
    wall: {
      id: uniqueId(str(value.id), wallIds),
      start,
      end,
      height: num(value.height) ?? WALL_DEFAULTS.height,
      thickness: num(value.thickness) ?? WALL_DEFAULTS.thickness,
      openings,
      // An unknown material id (older file, hand-edited, renamed palette entry)
      // falls back rather than failing the import — a wall in the wrong colour
      // is recoverable; a rejected file is not.
      material: isMaterialId(value.material) ? value.material : DEFAULT_WALL_MATERIAL,
    },
  }
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

function parseRoomLabel(value: unknown, ids: Set<string>): RoomLabel | null {
  if (!isRecord(value)) return null
  if (!isRoomType(value.type)) return null

  const anchor = parsePoint(value.anchor)
  if (!anchor) return null

  const label: RoomLabel = {
    id: uniqueId(str(value.id), ids),
    type: value.type,
    anchor,
  }
  // The user's own label, when the saved document carries one.
  if (typeof value.name === 'string' && value.name.trim()) {
    label.name = value.name
  }
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

function parseStair(value: unknown, ids: Set<string>): Stair | null {
  if (!isRecord(value)) return null
  const position = parsePoint(value.position)
  if (!position) return null

  return {
    id: uniqueId(str(value.id), ids),
    position,
    rotation: num(value.rotation) ?? 0,
    width: num(value.width) ?? STAIR_DEFAULTS.width,
    run: num(value.run) ?? STAIR_DEFAULTS.run,
  }
}

function parseFurniture(value: unknown, ids: Set<string>): FurnitureItem | null {
  if (!isRecord(value)) return null
  if (!isFurnitureType(value.type)) return null

  const position = parsePoint(value.position)
  if (!position) return null

  const item: FurnitureItem = {
    id: uniqueId(str(value.id), ids),
    type: value.type,
    position,
    rotation: num(value.rotation) ?? 0,
  }
  // Footprint overrides are optional — kept only when the saved document sets a
  // positive value, so an untouched piece round-trips with no size stored.
  const width = num(value.width)
  if (width !== null && width > 0) item.width = width
  const depth = num(value.depth)
  if (depth !== null && depth > 0) item.depth = depth
  return item
}

/**
 * Validates untrusted JSON into a design document.
 *
 * Anything structurally wrong fails with a message the UI can show. Anything
 * merely odd — a missing id, a bad opening, a zero-length wall — is repaired or
 * dropped and reported as a warning, so one bad row cannot cost the user their
 * whole file.
 */
export function parseDesign(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, error: 'File is not a JSON object.' }

  const version = num(value.version)
  if (version === null) {
    return { ok: false, error: 'Missing "version" — not a Space Designer file.' }
  }
  if (version > DESIGN_VERSION) {
    return {
      ok: false,
      error: `File version ${version} is newer than this app supports (${DESIGN_VERSION}).`,
    }
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
    for (const raw of value.furniture) {
      const item = parseFurniture(raw, furnitureIds)
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
    for (const raw of value.rooms) {
      const label = parseRoomLabel(raw, roomIds)
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
        for (const rawItem of raw.furniture) {
          const item = parseFurniture(rawItem, fFurnitureIds)
          if (item) floorFurniture.push(item)
        }
      }

      const floorRooms: RoomLabel[] = []
      const fRoomIds = new Set<string>()
      if (Array.isArray(raw.roomLabels)) {
        for (const rawLabel of raw.roomLabels) {
          const label = parseRoomLabel(rawLabel, fRoomIds)
          if (label) floorRooms.push(label)
        }
      }

      const floorStairs: Stair[] = []
      const fStairIds = new Set<string>()
      if (Array.isArray(raw.stairs)) {
        for (const rawStair of raw.stairs) {
          const stair = parseStair(rawStair, fStairIds)
          if (stair) floorStairs.push(stair)
        }
      }

      floors.push({
        id: str(raw.id) ?? crypto.randomUUID(),
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

  return {
    ok: true,
    warnings,
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
    },
  }
}
