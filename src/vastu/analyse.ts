import type { Facing, Point, Wall } from '../store/useDesignStore'
import type { ResolvedRoom } from '../rooms/resolve'
import type { VastuRule, VastuZone } from './ruleset'
import type { ZoneFrame, ZoneRect } from './zones'
import { getRoomType } from '../rooms/catalog'
import { getFacing } from '../site/orientation'
import {
  BRAHMASTHAN_AVOID,
  ENTRANCE_RULE,
  ruleForRoom,
  zoneLabel,
  zoneList,
} from './ruleset'
import { toNorthUp, zoneFrame, zoneOfFramePoint } from './zones'

/**
 * Reading a plan against the Vastu table in `ruleset.ts`.
 *
 * Everything here reports; nothing here judges. A room in a zone the table
 * names as one to avoid is described as exactly that — what this ruleset says —
 * and where the table is silent the report says it is silent rather than
 * inventing a verdict.
 */

/**
 * `no-rule` means the table has nothing to say about this subject, which is a
 * different statement from `okay`.
 */
export type VastuStatus = 'good' | 'okay' | 'avoid' | 'no-rule'

export type RoomVerdict = {
  room: ResolvedRoom
  /** The zone the room MOSTLY falls in. */
  zone: VastuZone
  /** Fraction of the room's area in that zone, 0..1 — the confidence. */
  coverage: number
  status: VastuStatus
  /** One sentence, in the informative register described above. */
  message: string
}

export type VastuReport = {
  /**
   * One entry per detected space, largest first — including unnamed spaces and
   * rooms the table is silent about, which carry `no-rule` and take no part in
   * the score.
   */
  rooms: RoomVerdict[]
  entrance: { facing: Facing; status: VastuStatus; message: string }
  brahmasthan: { clear: boolean; intruders: RoomVerdict[]; message: string }
  /** 0-100, or null when no room carries a rule and there is nothing to score. */
  score: number | null
  counts: { good: number; okay: number; avoid: number; noRule: number }
}

/** Below this share of its own area, a room is not "in" the centre zone. */
const BRAHMASTHAN_MIN_OVERLAP = 0.1

/** Points knocked off the score when the centre zone is occupied. */
const BRAHMASTHAN_PENALTY = 10

/** Under this coverage, the report names the fraction rather than implying all. */
const COVERAGE_HEDGE = 0.75

/**
 * Reads every room, the plot facing and the centre against the ruleset.
 *
 * `rooms` come from `resolveRooms`, so their polygons are on the wall
 * centrelines and share the coordinate frame the zone grid is built from.
 */
export function analyseVastu(
  rooms: ResolvedRoom[],
  walls: Wall[],
  northOffset: number,
  plotFacing: Facing,
): VastuReport {
  const frame = zoneFrame(walls, northOffset)
  const verdicts = frame ? rooms.map((room) => verdictFor(room, frame)) : []

  const intruders = frame
    ? verdicts.filter((v) => intrudesOnCentre(v, frame))
    : []

  return {
    rooms: verdicts,
    entrance: entranceVerdict(plotFacing),
    brahmasthan: {
      clear: intruders.length === 0,
      intruders,
      message: brahmasthanMessage(intruders),
    },
    score: scoreOf(verdicts, intruders.length > 0),
    counts: countBy(verdicts),
  }
}

/**
 * The score, 0-100.
 *
 * good = 1, okay = 0.5, avoid = 0, averaged over the rooms that HAVE a rule
 * only — an unnamed space or a balcony neither lifts nor drags the number —
 * times 100, less a flat `BRAHMASTHAN_PENALTY` if the centre is occupied. The
 * plot facing is reported but not scored: it is one line item, and letting it
 * swing a whole-plan average would make a one-room plan read as half a compass
 * reading. Null when no room carries a rule, because an average of nothing is
 * not a zero.
 */
function scoreOf(
  verdicts: RoomVerdict[],
  centreOccupied: boolean,
): number | null {
  const scored = verdicts.filter((v) => v.status !== 'no-rule')
  if (scored.length === 0) return null

  const weights = { good: 1, okay: 0.5, avoid: 0, 'no-rule': 0 }
  const total = scored.reduce((sum, v) => sum + weights[v.status], 0)
  const base = (total / scored.length) * 100
  const penalty = centreOccupied ? BRAHMASTHAN_PENALTY : 0

  return Math.round(Math.max(0, base - penalty))
}

function countBy(verdicts: RoomVerdict[]): VastuReport['counts'] {
  return {
    good: verdicts.filter((v) => v.status === 'good').length,
    okay: verdicts.filter((v) => v.status === 'okay').length,
    avoid: verdicts.filter((v) => v.status === 'avoid').length,
    noRule: verdicts.filter((v) => v.status === 'no-rule').length,
  }
}

/** The zone a room mostly occupies, and what the table makes of it. */
function verdictFor(room: ResolvedRoom, frame: ZoneFrame): RoomVerdict {
  const { zone, coverage } = dominantZone(room, frame)
  const rule = room.label ? ruleForRoom(room.label.type) : null
  const name = room.label ? getRoomType(room.label.type).label : null

  if (!rule || !name) {
    return {
      room,
      zone,
      coverage,
      status: 'no-rule',
      message: name
        ? `${name} sits in the ${zoneLabel(zone)} zone; this ruleset has no ` +
          'placement rule for it.'
        : `An unnamed space sits in the ${zoneLabel(zone)} zone — name it to ` +
          'check it against this ruleset.',
    }
  }

  const status = statusFor(rule, zone)
  return {
    room,
    zone,
    coverage,
    status,
    message: roomMessage(name, rule, zone, coverage, status),
  }
}

/**
 * Where the table is silent about a zone — Living names three preferred zones
 * and no zones to avoid — the reading is `okay`, and the sentence says the
 * table is silent rather than implying it approves.
 */
function statusFor(rule: VastuRule, zone: VastuZone): VastuStatus {
  if (rule.ideal.includes(zone)) return 'good'
  if (rule.avoid.includes(zone)) return 'avoid'
  return 'okay'
}

function roomMessage(
  name: string,
  rule: VastuRule,
  zone: VastuZone,
  coverage: number,
  status: VastuStatus,
): string {
  const where =
    coverage >= COVERAGE_HEDGE
      ? `sits in the ${zoneLabel(zone)} zone`
      : `sits mostly in the ${zoneLabel(zone)} zone ` +
        `(${Math.round(coverage * 100)}% of its floor area)`

  const preferred = zoneList(rule.ideal)

  if (status === 'good') {
    return `${name} ${where}, which this ruleset prefers for it.`
  }

  if (status === 'avoid') {
    return (
      `${name} ${where}, which this ruleset lists among the placements to ` +
      `avoid; it prefers ${preferred}.`
    )
  }

  if (rule.ok.includes(zone)) {
    return (
      `${name} ${where}, which this ruleset allows; it puts ` +
      `${preferred} first.`
    )
  }

  return (
    `${name} ${where}; this ruleset prefers ${preferred} and says nothing ` +
    `either way about ${zoneLabel(zone)}.`
  )
}

/**
 * The plot facing read against the main-entrance rule. It is the direction the
 * plot and its entrance look out on, not a room, and is labelled as such.
 */
function entranceVerdict(facing: Facing): VastuReport['entrance'] {
  const label = getFacing(facing).label
  const status = statusFor(ENTRANCE_RULE, facing)
  const preferred = zoneList(ENTRANCE_RULE.ideal)

  if (status === 'good') {
    return {
      facing,
      status,
      message: `The plot faces ${label}, one of the entrance directions this ` +
        'ruleset prefers.',
    }
  }

  if (status === 'avoid') {
    return {
      facing,
      status,
      message: `The plot faces ${label}, which this ruleset lists as an ` +
        `entrance direction to avoid; it prefers ${preferred}.`,
    }
  }

  return {
    facing,
    status,
    message: `The plot faces ${label}; this ruleset prefers ${preferred} for ` +
      `the entrance and is silent on ${label}.`,
  }
}

/** More than a sliver of a keep-out room inside the centre cell. */
function intrudesOnCentre(verdict: RoomVerdict, frame: ZoneFrame): boolean {
  const type = verdict.room.label?.type
  if (!type || !BRAHMASTHAN_AVOID.includes(type)) return false

  const centre = frame.cells.find((cell) => cell.zone === 'C')
  if (!centre) return false

  const polygon = verdict.room.polygon.map((p) =>
    toNorthUp(p, frame.pivot, frame.northOffset),
  )
  const total = polygonArea(polygon)
  if (total <= 0) return false

  return polygonArea(clipToRect(polygon, centre)) / total > BRAHMASTHAN_MIN_OVERLAP
}

function brahmasthanMessage(intruders: RoomVerdict[]): string {
  // The table's "any heavy room" is not enumerated anywhere in this ruleset, so
  // the check covers only the subjects it names — and says so.
  const scope =
    'This check covers toilets, bathrooms and staircases; the ruleset asks ' +
    'that the centre stay open but does not list which other rooms it counts.'

  if (intruders.length === 0) {
    return `The centre zone (Brahmasthan) is open. ${scope}`
  }

  const names = intruders
    .map((v) => (v.room.label ? getRoomType(v.room.label.type).label : 'A room'))
    .join(', ')

  return (
    `${names} overlaps the centre zone (Brahmasthan), which this ruleset ` +
    `prefers to keep open. ${scope}`
  )
}

/**
 * The zone holding the largest share of a room, by AREA.
 *
 * Centroid tests are the obvious shortcut and they are wrong here: a long room
 * across three zones can have its centroid in the zone holding a third of it.
 * The polygon is carried into the north-up frame — where the cells are
 * axis-aligned rectangles — clipped against each cell, and the areas compared.
 * `coverage` is the winner's share of the whole room, so a 40/35/25 split
 * reports as 0.4 and the UI can be honest about it.
 */
function dominantZone(
  room: ResolvedRoom,
  frame: ZoneFrame,
): { zone: VastuZone; coverage: number } {
  const framed = room.polygon.map((p) =>
    toNorthUp(p, frame.pivot, frame.northOffset),
  )
  const total = polygonArea(framed)
  const centre = toNorthUp(room.centroid, frame.pivot, frame.northOffset)

  if (total <= 0) {
    return { zone: zoneOfFramePoint(centre, frame) ?? 'C', coverage: 0 }
  }

  // A room split exactly down a zone line is a real case on a symmetric plan,
  // so ties go to the zone holding the room's own label point rather than to
  // whichever cell happened to be visited first.
  const anchor = zoneOfFramePoint(centre, frame)
  const tie = total * 1e-9
  let best: VastuZone | null = null
  let bestArea = 0

  for (const cell of frame.cells) {
    const area = polygonArea(clipToRect(framed, cell))
    if (area < bestArea - tie) continue
    if (area < bestArea + tie && cell.zone !== anchor) continue
    bestArea = Math.max(bestArea, area)
    best = cell.zone
  }

  if (!best) return { zone: 'C', coverage: 0 }
  return { zone: best, coverage: Math.min(1, bestArea / total) }
}

/** Unsigned shoelace area. */
function polygonArea(polygon: Point[]): number {
  if (polygon.length < 3) return 0

  let twice = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    twice += a.x * b.z - b.x * a.z
  }

  return Math.abs(twice) / 2
}

/**
 * Sutherland-Hodgman clip against an axis-aligned rectangle — exact, and short
 * enough not to need a geometry dependency. Concave rooms come back with the
 * degenerate zero-width bridges the algorithm is known for, which is harmless
 * because the only thing asked of the result is its area.
 */
function clipToRect(polygon: Point[], rect: ZoneRect): Point[] {
  const edges: ((p: Point) => boolean)[] = [
    (p) => p.x >= rect.minX,
    (p) => p.x <= rect.maxX,
    (p) => p.z >= rect.minZ,
    (p) => p.z <= rect.maxZ,
  ]
  const cuts: ((a: Point, b: Point) => Point)[] = [
    (a, b) => atX(a, b, rect.minX),
    (a, b) => atX(a, b, rect.maxX),
    (a, b) => atZ(a, b, rect.minZ),
    (a, b) => atZ(a, b, rect.maxZ),
  ]

  let output = polygon

  for (let e = 0; e < edges.length; e++) {
    const input = output
    output = []

    for (let i = 0; i < input.length; i++) {
      const current = input[i]
      const previous = input[(i + input.length - 1) % input.length]
      const currentIn = edges[e](current)
      const previousIn = edges[e](previous)

      if (currentIn) {
        if (!previousIn) output.push(cuts[e](previous, current))
        output.push(current)
      } else if (previousIn) {
        output.push(cuts[e](previous, current))
      }
    }

    if (output.length === 0) return []
  }

  return output
}

/** Where segment a-b crosses the vertical line x = value. */
function atX(a: Point, b: Point, value: number): Point {
  const t = (value - a.x) / (b.x - a.x)
  return { x: value, z: a.z + t * (b.z - a.z) }
}

/** Where segment a-b crosses the horizontal line z = value. */
function atZ(a: Point, b: Point, value: number): Point {
  const t = (value - a.z) / (b.z - a.z)
  return { x: a.x + t * (b.x - a.x), z: value }
}
