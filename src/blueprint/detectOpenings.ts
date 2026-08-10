import {
  useDesignStore,
  type Blueprint,
  type OpeningType,
  type Point,
  type RoomType,
  type Wall,
} from '../store/useDesignStore'
import { getFurniture, type FurnitureType } from '../furniture/catalog'
import { pickWall, pointAlongWall } from '../scene/wallGeometry'
import { resolveRooms, roomAtPoint, type ResolvedRoom } from '../rooms/resolve'
import {
  AI_TIMEOUT_MS,
  AI_UNAVAILABLE_MESSAGE,
  AiUnavailableError,
  aiFetch,
  isTimeout,
} from '../ai/endpoint'
import { proposeCalibration } from './calibration'
import { provenance } from '../store/provenance'

/**
 * Largest edge, in pixels, of the image sent for analysis.
 *
 * Kept at 1100 rather than higher because the image dominates the request size,
 * and the free vision model reads a smaller payload more reliably. Still enough
 * resolution to read a plan's walls, labels and furniture.
 */
const MAX_SEND_DIMENSION = 1100

/** Exact: one foot in metres. */
const METRES_PER_FOOT = 0.3048

/**
 * How close a detected opening's centre must land to a wall to be placed on it,
 * in metres. The vision model's coordinates are approximate, so this is
 * generous — wide enough to catch a window the model placed a little off its
 * wall, narrow enough that it does not usually grab the next room's wall.
 */
const SNAP_TOLERANCE_M = 2.2

/**
 * Clearance kept between a placed piece and its room's walls, in metres. The
 * vision model's furniture point is only roughly where the piece sits, so its
 * footprint is pulled this far clear of every wall — enough that a bed no
 * longer straddles the wall it was read against.
 */
const FURNITURE_MARGIN_M = 0.15

type RawOpening = { type: OpeningType; x: number; y: number; width: number }

/** A named point read off the plan — a room label or a furniture piece. */
type RawLabel = { name: string; x: number; y: number }

type PlanBox = { x0: number; y0: number; x1: number; y1: number }

export type PlanAnalysis = {
  widthFeet: number | null
  depthFeet: number | null
  box: PlanBox | null
  openings: RawOpening[]
  rooms: RawLabel[]
  furniture: RawLabel[]
}

export type PlacedRooms = { named: number }
export type PlacedFurniture = { placed: number }

export type AnalyseResult =
  | { ok: true; analysis: PlanAnalysis }
  | { ok: false; error: string }

/**
 * How the building's real size was arrived at, for an honest status line.
 *
 * `estimated` used to be spelled `calibrated`, which is what made the banner
 * read "Sized to 40′ from the drawing" for a number a free vision model had
 * guessed off a JPEG. Only a user measurement is a calibration; this is a
 * reading, and it says so.
 */
export type ScaleSource =
  | { kind: 'estimated'; feet: number }
  | { kind: 'guess' }
  /** A measurement already in force, which the read was not allowed to replace. */
  | { kind: 'kept-measured' }

export type PlacedOpenings = { found: number; added: number; dropped: number }

/**
 * Runs the vision model over the current blueprint and returns what it read —
 * the plan's real dimensions and its doors and windows.
 *
 * Pure fetch + validation; it changes nothing. The caller decides whether to
 * apply the scale and where to place the openings.
 */
export async function analyseBlueprint(): Promise<AnalyseResult> {
  const blueprint = useDesignStore.getState().blueprint
  if (!blueprint) return { ok: false, error: 'Load a blueprint image first.' }
  if (!blueprint.src) {
    return {
      ok: false,
      error:
        `This project remembers ${blueprint.fileName} and its scale, but not ` +
        'the image itself. Choose the file again to read it.',
    }
  }

  let dataUrl: string
  try {
    dataUrl = await toSendableJpeg(blueprint.src)
  } catch {
    return { ok: false, error: 'That blueprint image could not be read.' }
  }

  try {
    const response = await aiFetch(
      '/api/ai/openings',
      { image: dataUrl },
      AI_TIMEOUT_MS.vision,
    )
    const payload = (await response.json()) as PlanAnalysis & { error?: string }
    if (!response.ok) {
      return { ok: false, error: payload.error ?? 'Detection failed.' }
    }
    return {
      ok: true,
      analysis: {
        widthFeet: payload.widthFeet ?? null,
        depthFeet: payload.depthFeet ?? null,
        box: payload.box ?? null,
        openings: payload.openings ?? [],
        rooms: payload.rooms ?? [],
        furniture: payload.furniture ?? [],
      },
    }
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      return { ok: false, error: AI_UNAVAILABLE_MESSAGE }
    }
    if (isTimeout(error)) {
      return {
        ok: false,
        error: 'Reading the plan took too long and was cancelled. Try again, ' +
          'or place the doors and windows by hand.',
      }
    }
    return { ok: false, error: 'Could not reach the detection service.' }
  }
}

/**
 * PROPOSES a size for the blueprint from what the model read.
 *
 * The model reads the plan's dimension labels (a "40'" along one edge) and the
 * pixel box those measure across; the ratio is an estimate of metres-per-pixel.
 * That is worth having on an image nobody has measured — it stops an untouched
 * import coming in at twice its real size — and it is worth nothing at all
 * against an image the user measured themselves.
 *
 * So this is a proposal, not a write. `proposeCalibration` ranks `ai` below
 * every other source and refuses outright once the user has locked a
 * measurement, which is the whole of the fix for the defect where switching to
 * 3D on a freshly calibrated plan silently replaced the measurement with this
 * estimate and then built every wall from it.
 *
 * Must run BEFORE the walls are built, since they inherit whatever scale is in
 * force — including, now, the one the proposal was refused in favour of.
 */
export function applyPlanScale(analysis: PlanAnalysis): ScaleSource {
  const blueprint = useDesignStore.getState().blueprint
  if (!blueprint) return { kind: 'guess' }

  // Report the refusal before doing the arithmetic: when the user has already
  // measured, there is nothing for this function to contribute and the banner
  // should say the measurement was kept rather than imply a fresh reading.
  if (blueprint.calibration.lockedByUser) return { kind: 'kept-measured' }
  if (!analysis.box) return { kind: 'guess' }

  const spanX = (analysis.box.x1 - analysis.box.x0) * blueprint.width
  const spanZ = (analysis.box.y1 - analysis.box.y0) * blueprint.height

  // Prefer whichever dimension the model read, and cross-check when it read
  // both; averaging two independent readings steadies a shaky box edge.
  const estimates: number[] = []
  if (analysis.widthFeet && spanX > 0) {
    estimates.push((analysis.widthFeet * METRES_PER_FOOT) / spanX)
  }
  if (analysis.depthFeet && spanZ > 0) {
    estimates.push((analysis.depthFeet * METRES_PER_FOOT) / spanZ)
  }
  if (estimates.length === 0) return { kind: 'guess' }

  const result = proposeCalibration({
    source: 'ai',
    metresPerPixel: estimates.reduce((a, b) => a + b, 0) / estimates.length,
    // No anchor: the image's own centre is held. The old code re-centred on the
    // world origin instead, which slid the underlay out from beneath anything
    // already traced against it.
    evidence: { readFeet: analysis.widthFeet ?? analysis.depthFeet ?? undefined },
  })

  if (!result.applied) {
    return blueprint.calibration.source === 'none'
      ? { kind: 'guess' }
      : { kind: 'kept-measured' }
  }

  return {
    kind: 'estimated',
    feet: analysis.widthFeet ?? analysis.depthFeet ?? 0,
  }
}

/**
 * Places already-detected openings on the walls, snapping each to the nearest
 * wall. Reports how many were placed and how many were dropped, so a miss is
 * visible rather than silent — a dropped opening usually means the wall it
 * belonged to was not detected.
 */
export function placeOpenings(openings: RawOpening[]): PlacedOpenings {
  const store = useDesignStore.getState()
  const blueprint = store.blueprint
  if (!blueprint) return { found: openings.length, added: 0, dropped: 0 }

  const widthPx = blueprint.width
  const heightPx = blueprint.height
  const mpp = blueprint.metresPerPixel

  let added = 0
  for (const opening of openings) {
    const world: Point = {
      x: blueprint.origin.x + opening.x * widthPx * mpp,
      z: blueprint.origin.z + opening.y * heightPx * mpp,
    }

    const hit = pickWall(store.walls, world, SNAP_TOLERANCE_M)
    if (!hit) continue

    const id = store.addOpening(
      hit.wall.id,
      opening.type,
      hit.projection.t,
      // 'ai', not 'cv': this module reads the sheet with a VISION MODEL, not
      // with `detectWalls`'s deterministic binarisation. Its own comments call
      // the coordinates approximate.
      provenance.ai(blueprint.fileName),
    )
    if (!id) continue

    const width = sensibleWidth(opening.width * widthPx * mpp, opening.type, hit.wall)
    if (width > 0) store.updateOpening(hit.wall.id, id, { width })
    added += 1
  }

  return { found: openings.length, added, dropped: openings.length - added }
}

/**
 * Maps a room name read off the plan to one of the app's room types.
 *
 * Matched on keywords rather than exact strings — plans write "MASTER BEDROOM",
 * "M. Bed", "Bed 2", "Family / Living" and every variant in between, so an
 * exact table would miss most of them. Order matters where names nest: "master"
 * and "guest" are checked before the bare "bed" they contain. Unrecognised
 * names return null and are simply not placed.
 */
function toRoomType(raw: string): RoomType | null {
  const s = raw.toLowerCase()
  if (s.includes('master')) return 'master-bedroom'
  if (s.includes('guest')) return 'guest-room'
  if (s.includes('bed')) return 'bedroom'
  if (s.includes('kitchen')) return 'kitchen'
  if (s.includes('dining')) return 'dining'
  if (
    s.includes('living') ||
    s.includes('family') ||
    s.includes('hall') ||
    s.includes('lounge') ||
    s.includes('drawing')
  ) {
    return 'living'
  }
  if (s.includes('pooja') || s.includes('puja') || s.includes('prayer')) return 'pooja'
  if (s.includes('bath')) return 'bathroom'
  if (
    s.includes('toilet') ||
    s.includes('wc') ||
    s.includes('washroom') ||
    s.includes('powder')
  ) {
    return 'toilet'
  }
  if (s.includes('study') || s.includes('office')) return 'study'
  if (s.includes('stair')) return 'staircase'
  if (
    s.includes('store') ||
    s.includes('storage') ||
    s.includes('closet') ||
    s.includes('wardrobe') ||
    s.includes('utility')
  ) {
    return 'store'
  }
  if (
    s.includes('balcony') ||
    s.includes('terrace') ||
    s.includes('deck') ||
    s.includes('porch') ||
    s.includes('veranda')
  ) {
    return 'balcony'
  }
  return null
}

/** Maps a furniture name to one of the five catalogue pieces, or null. */
function toFurnitureType(raw: string): FurnitureType | null {
  const s = raw.toLowerCase()
  // `\bbed\b` matches "bed" and "double bed" but NOT "bedroom" — the word is
  // shared with the room name, and a bedroom is not a bed. Desk before table so
  // a "study table" is not miscounted as a dining one.
  if (/\bbed\b/.test(s)) return 'bed'
  if (s.includes('sofa') || s.includes('couch') || s.includes('settee')) return 'sofa'
  if (s.includes('desk') || s.includes('workstation')) return 'desk'
  if (s.includes('table')) return 'table'
  if (s.includes('chair') || s.includes('stool') || s.includes('seat')) return 'chair'
  return null
}

/** Normalized image point to world metres — the same map openings use. */
function toWorld(blueprint: Blueprint, x: number, y: number): Point {
  return {
    x: blueprint.origin.x + x * blueprint.width * blueprint.metresPerPixel,
    z: blueprint.origin.z + y * blueprint.height * blueprint.metresPerPixel,
  }
}

/**
 * Names the rooms the read found, by dropping a label at each room's centre.
 *
 * A label resolves against whichever wall loop encloses its point, so this must
 * run AFTER the walls are built. A point that lands in no room (a name the model
 * mis-placed, or a room whose walls were not detected) simply never resolves —
 * harmless, and better than refusing the rest.
 */
export function placeRooms(rooms: RawLabel[]): PlacedRooms {
  const store = useDesignStore.getState()
  const blueprint = store.blueprint
  if (!blueprint) return { named: 0 }

  let named = 0
  for (const room of rooms) {
    const type = toRoomType(room.name)
    if (!type) continue
    store.nameRoom(
      toWorld(blueprint, room.x, room.y),
      type,
      provenance.ai(blueprint.fileName),
    )
    named += 1
  }
  return { named }
}

/**
 * Places the furniture the read found, each at its point in the plan.
 *
 * The model's point is only roughly where a piece sits, and it takes no account
 * of the piece's size — a bed read against a wall lands centred on the wall,
 * half in the next room. So each piece is seated in whichever room encloses its
 * point: turned to face into the room, then pulled fully within that room's
 * walls. A point that falls in no room keeps the raw placement, rotation 0.
 */
export function placeFurniture(items: RawLabel[]): PlacedFurniture {
  const store = useDesignStore.getState()
  const blueprint = store.blueprint
  if (!blueprint) return { placed: 0 }

  const rooms = resolveRooms(store.walls, store.roomLabels)

  let placed = 0
  for (const item of items) {
    const type = toFurnitureType(item.name)
    if (!type) continue

    const point = toWorld(blueprint, item.x, item.y)
    const id = store.addFurniture(type, point, provenance.ai(blueprint.fileName))
    placed += 1

    const room = roomAtPoint(rooms, point)
    if (room) store.updateFurniture(id, fitToRoom(type, point, room, store.walls))
  }
  return { placed }
}

/**
 * Drops a fitted fixture into every space whose name is one of `roomTypes`.
 *
 * The blueprint read never returns fixtures — a vision model reports named
 * points, not cabinet runs or sanitaryware — so a kitchen or bathroom comes
 * back an empty floor. This gives each a real, movable piece instead, seated
 * against the wall nearest that space's anchor by the same `fitToRoom` that
 * seats detected furniture. Open-plan zones are covered, since a name sharing
 * an enclosure with others is an `extraLabels` entry, not the room's own name.
 *
 * Furniture items, not baked scenery, so they select, drag and delete like
 * anything else the user placed.
 */
function placeFixtures(
  furniture: FurnitureType,
  roomTypes: RoomType[],
): { placed: number } {
  const store = useDesignStore.getState()
  const rooms = resolveRooms(store.walls, store.roomLabels)

  let placed = 0
  for (const room of rooms) {
    const matches = [
      ...(room.label && roomTypes.includes(room.label.type) ? [room.label] : []),
      ...room.extraLabels.filter((label) => roomTypes.includes(label.type)),
    ]
    for (const label of matches) {
      // 'ai' with no sourceRef: the piece itself is a local default seated by
      // `fitToRoom`, but it exists ONLY because a vision model named this room,
      // and the user did not place it. 'manual' would be the lie.
      const id = store.addFurniture(furniture, label.anchor, provenance.ai())
      store.updateFurniture(
        id,
        fitToRoom(furniture, label.anchor, room, store.walls),
      )
      placed += 1
    }
  }
  return { placed }
}

/** A kitchen counter in every space named "Kitchen". */
export const placeKitchenCounters = (): { placed: number } =>
  placeFixtures('kitchen-counter', ['kitchen'])

/** A WC in every space named "Toilet" or "Bathroom". */
export const placeToiletFixtures = (): { placed: number } =>
  placeFixtures('toilet', ['toilet', 'bathroom'])

/**
 * Seats a piece inside a room: turns its back to the nearest wall, then pulls
 * its centre in until the whole rotated footprint clears the room's walls by
 * `FURNITURE_MARGIN_M`. Returns the transform to hand to `updateFurniture`.
 */
function fitToRoom(
  type: FurnitureType,
  point: Point,
  room: ResolvedRoom,
  walls: Wall[],
): { position: Point; rotation: number } {
  const { width, depth } = getFurniture(type)
  const box = boundsOf(room.polygon)

  // Face into the room: turn the back (local -z) toward the nearest wall. A
  // piece inside a room is nearer its own walls than any other's, and a reach
  // spanning the room guarantees `pickWall` returns one to face.
  let rotation = 0
  const reach = Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ)
  const hit = pickWall(walls, point, reach)
  if (hit) {
    const foot = pointAlongWall(hit.wall, hit.projection.t)
    const inX = point.x - foot.x
    const inZ = point.z - foot.z
    // A Y rotation sends local +z to (sin, cos), so aiming the facing along the
    // inward normal is `atan2(inX, inZ)` — which puts the back at the wall.
    if (Math.hypot(inX, inZ) > 1e-6) rotation = Math.atan2(inX, inZ)
  }

  // Half-extents of the turned footprint along each world axis, plus clearance.
  const cos = Math.abs(Math.cos(rotation))
  const sin = Math.abs(Math.sin(rotation))
  const halfX = (width * cos + depth * sin) / 2 + FURNITURE_MARGIN_M
  const halfZ = (width * sin + depth * cos) / 2 + FURNITURE_MARGIN_M

  return {
    position: {
      x: clampAxis(point.x, box.minX + halfX, box.maxX - halfX),
      z: clampAxis(point.z, box.minZ + halfZ, box.maxZ - halfZ),
    },
    rotation,
  }
}

/** Axis-aligned extents of a room ring. */
function boundsOf(polygon: Point[]) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of polygon) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  return { minX, maxX, minZ, maxZ }
}

/** Clamps to [lo, hi], or to the gap's midpoint when the piece is too big to fit. */
function clampAxis(value: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2
  return Math.min(hi, Math.max(lo, value))
}

export type OpeningsResult =
  | {
      ok: true
      added: number
      found: number
      dropped: number
      roomsNamed: number
      furniturePlaced: number
    }
  | { ok: false; error: string }

/**
 * The manual "Detect doors & windows" path: analyse the current blueprint and
 * place its openings on the walls already drawn, plus name the rooms and drop
 * in the furniture the same read found. Leaves the scale alone — the walls
 * exist, and re-sizing them under the user is not what this button does.
 */
export async function detectAndPlaceOpenings(): Promise<OpeningsResult> {
  if (useDesignStore.getState().walls.length === 0) {
    return { ok: false, error: 'Detect the walls first, then find the openings.' }
  }

  const result = await analyseBlueprint()
  if (!result.ok) return result

  const placed = placeOpenings(result.analysis.openings)
  const rooms = placeRooms(result.analysis.rooms)
  const furniture = placeFurniture(result.analysis.furniture)
  // After the rooms are named, so a kitchen or bathroom has its label to find.
  const counters = placeKitchenCounters()
  const toilets = placeToiletFixtures()
  return {
    ok: true,
    ...placed,
    roomsNamed: rooms.named,
    furniturePlaced: furniture.placed + counters.placed + toilets.placed,
  }
}

/** Standard leaf width, in metres, to fall back on per opening type. */
const OPENING_DEFAULT_M: Record<OpeningType, number> = {
  door: 0.9,
  window: 1.2,
  // UNREACHABLE TODAY, and deliberately not presented as tuned: `classify`
  // emits only 'door' and 'window', so nothing in the CV path can produce a
  // cased opening. The entry exists because `OpeningType` widened and this is
  // a `Record`, which is the mechanism that made the widening visible at all.
  // If a detector ever learns to read an `O` tag, revalidate on the corpus
  // (§10 rule 6) before trusting either of these numbers.
  cased: 1.2,
}

/**
 * The believable width band for each opening type, in metres. A single-leaf
 * door is ~0.75–1.0 m; even a double door or a wide window rarely passes these.
 */
const OPENING_BAND_M: Record<OpeningType, [min: number, max: number]> = {
  door: [0.6, 1.4],
  window: [0.5, 3.0],
  // Wider than a door at both ends — a pass-through can legitimately be most
  // of a partition — but not unbounded. Unreachable today; see above.
  cased: [0.7, 2.4],
}

/**
 * Turns a detected opening width into one worth drawing.
 *
 * The free vision model's width is unreliable — it routinely over-reports, and
 * an over-report used to survive as anything up to 90% of the wall, which is
 * why doors rendered as wall-sized panels. So the detected width is trusted
 * only when it lands in a sane band for its type; otherwise the opening keeps a
 * real-world default (0.9 m door, 1.2 m window). Either way it is never wider
 * than the wall can hold.
 */
function sensibleWidth(metres: number, type: OpeningType, wall: Wall): number {
  const [min, max] = OPENING_BAND_M[type]
  const believable = Number.isFinite(metres) && metres >= min && metres <= max
  const chosen = believable ? metres : OPENING_DEFAULT_M[type]
  return Math.min(chosen, wallLength(wall) * 0.9)
}

const wallLength = (wall: Wall) =>
  Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z)

/**
 * Decodes the blueprint and re-encodes it as a bounded JPEG data URL.
 *
 * JPEG and a size cap keep the upload well under the endpoint's limit — a phone
 * photo of a plan can be tens of megabytes, which no vision request wants.
 */
function toSendableJpeg(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(
        1,
        MAX_SEND_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
      )
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.naturalWidth * scale)
      canvas.height = Math.round(image.naturalHeight * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('no 2d context'))
        return
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.82))
    }
    image.onerror = () => reject(new Error('decode failed'))
    image.src = src
  })
}
