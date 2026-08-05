import type { Facing, FloorData, Plot } from '../store/useDesignStore'
import type { ResolvedRoom } from '../rooms/resolve'
import type { VastuStatus } from '../vastu/analyse'
import { analyseVastu } from '../vastu/analyse'
import { roomDisplayName } from '../rooms/catalog'
import { resolveRooms, totalBuiltUpArea } from '../rooms/resolve'
import { buildableRect, plotRect, rectArea } from '../site/plot'
import { SQUARE_METRES_PER_SQUARE_FOOT } from '../units/length'
import { zoneLabel } from '../vastu/ruleset'

/**
 * The area statement, cost estimate and Vastu summary — as data.
 *
 * Everything here is pure: a design goes in, a plain object comes out. The PDF
 * sheet, the CSV export and the on-screen panel all render THIS, so a number
 * printed on the drawing and the same number in a spreadsheet can never drift.
 *
 * Every storey is measured, not just the one that happens to be open. A
 * builder's "total built-up area" is the sum across the building, and it is
 * that total the cost multiplies.
 */

/**
 * How the areas in this document were measured, in words.
 *
 * Carried in the statement rather than hard-coded into one renderer, because
 * every rendering of it has to say the same thing. In Indian practice carpet,
 * built-up and super built-up are three different numbers with legal meaning,
 * and a document that does not name its basis invites the reader to assume
 * whichever one suits them.
 */
export const MEASUREMENT_BASIS =
  'Areas are measured to wall centrelines, so each room includes half the ' +
  'thickness of the walls enclosing it. These are not carpet areas, and not ' +
  'super built-up areas.'

/** The name given to a space the user has not labelled. */
const UNNAMED = 'Unnamed'

/** One room on one storey. */
export type RoomRow = {
  floorName: string
  /**
   * Display name. Unlabelled spaces read `Unnamed`, and a name repeated on a
   * storey is numbered — `Bedroom 1`, `Bedroom 2` — so that a row in the table
   * can be pointed at on the drawing.
   */
  name: string
  areaSqM: number
  areaSqFt: number
}

/** One storey: its rooms, its built-up area, and what it costs to build. */
export type FloorSummary = {
  name: string
  /** Largest room first, as `resolveRooms` orders them. */
  rooms: RoomRow[]
  builtUpSqM: number
  builtUpSqFt: number
  /** Rupees, or null when no rate is set. */
  cost: number | null
}

/**
 * The estimate, or null when no construction rate has been set.
 *
 * Null rather than a total of zero: a rate of 0 means "not quoted", and a
 * document showing ₹0 would read as a quotation for free work.
 */
export type CostEstimate = {
  ratePerSqFt: number
  totalSqFt: number
  /**
   * Rupees. The sum of the per-floor costs, so the column adds up to the
   * total on the page — rounding the total separately would leave a document
   * whose own arithmetic looks wrong by a rupee or two.
   */
  total: number
  perFloor: { name: string; sqFt: number; cost: number }[]
} | null

export type VastuCounts = {
  good: number
  okay: number
  avoid: number
  noRule: number
}

/** One room's Vastu reading, flattened for a table. */
export type VastuRow = {
  floorName: string
  /** The same display name as the matching `RoomRow`. */
  name: string
  /** The zone the room mostly occupies, e.g. `North-East`. */
  zone: string
  /** Fraction of the room's area in that zone, 0..1. */
  coverage: number
  status: VastuStatus
  message: string
}

/**
 * The whole-building Vastu reading, or null when nothing has been named.
 *
 * Null is the honest answer for an unnamed plan: the ruleset has nothing to
 * say about a space with no purpose, and averaging no readings gives 0, which
 * would read as a terrible score rather than as no score.
 */
export type VastuSummary = {
  /** 0-100. */
  score: number
  counts: VastuCounts
  /** One sentence, ready to print above the table. */
  headline: string
  rows: VastuRow[]
  /**
   * The findings that are not about a single room — the plot's entrance
   * direction, and whether the centre zone is clear on each storey.
   */
  notes: string[]
}

export type AreaStatement = {
  projectName: string
  date: string
  /** See `MEASUREMENT_BASIS`. Every renderer must print this. */
  basis: string
  /**
   * Storeys that have something to measure. A storey with no enclosed space
   * is left out rather than listed as a row of zeroes.
   */
  floors: FloorSummary[]
  totalBuiltUpSqM: number
  totalBuiltUpSqFt: number
  cost: CostEstimate
  vastu: VastuSummary | null
  plot: {
    areaSqM: number
    areaSqFt: number
    /** Zero when the setbacks meet and nothing is left to build on. */
    buildableSqM: number
    buildableSqFt: number
  } | null
}

/** Exact, by definition. */
const toSqFt = (squareMetres: number) =>
  squareMetres / SQUARE_METRES_PER_SQUARE_FOOT

/** A storey with its rooms resolved once, so nothing is detected twice. */
type MeasuredFloor = {
  floor: FloorData
  rooms: ResolvedRoom[]
  /** Display names, index-aligned with `rooms`. */
  names: string[]
}

/**
 * Builds the whole statement from a design.
 *
 * `floors` must be every storey — use `allFloors(state)`, never `state.floors`,
 * or the storey the user currently has open will be measured as it was when
 * they last switched away from it.
 */
export function buildAreaStatement(input: {
  projectName: string | null
  date: string
  floors: FloorData[]
  plot: Plot | null
  northOffset: number
  plotFacing: Facing
  constructionRate: number
}): AreaStatement {
  const measured = measureFloors(input.floors)
  const rate =
    Number.isFinite(input.constructionRate) && input.constructionRate > 0
      ? input.constructionRate
      : 0

  const floors = measured.map(({ floor, rooms, names }) => {
    const builtUpSqM = totalBuiltUpArea(rooms)
    const builtUpSqFt = toSqFt(builtUpSqM)

    return {
      name: floor.name,
      rooms: rooms.map((room, index) => ({
        floorName: floor.name,
        name: names[index],
        areaSqM: room.area,
        areaSqFt: toSqFt(room.area),
      })),
      builtUpSqM,
      builtUpSqFt,
      // Costed off the unrounded area, then rounded to the rupee: money is
      // reported to the rupee, areas are not.
      cost: rate > 0 ? Math.round(builtUpSqFt * rate) : null,
    }
  })

  const totalBuiltUpSqM = floors.reduce((sum, f) => sum + f.builtUpSqM, 0)

  return {
    projectName: input.projectName?.trim() || 'Untitled Project',
    date: input.date,
    basis: MEASUREMENT_BASIS,
    floors,
    totalBuiltUpSqM,
    totalBuiltUpSqFt: toSqFt(totalBuiltUpSqM),
    cost: estimateCost(floors, rate),
    vastu: summariseVastu(measured, input.northOffset, input.plotFacing),
    plot: measurePlot(input.plot, input.plotFacing, input.northOffset),
  }
}

/**
 * Resolves the rooms on every storey, dropping the ones with nothing enclosed.
 *
 * An empty upper storey is a slot the app always provides, not a floor someone
 * drew, so listing it would put "Second Floor — 0 sq ft" into a document handed
 * to a builder.
 */
function measureFloors(floors: FloorData[]): MeasuredFloor[] {
  const measured: MeasuredFloor[] = []

  for (const floor of floors) {
    const rooms = resolveRooms(floor.walls, floor.roomLabels)
    if (rooms.length === 0) continue
    measured.push({ floor, rooms, names: displayNames(rooms) })
  }

  return measured
}

/**
 * Room names for one storey, numbering any name that appears more than once.
 *
 * Three rows all reading "Bedroom" cannot be checked against the drawing;
 * "Bedroom 1/2/3" can. Numbering follows the room order, which is largest
 * first, so Bedroom 1 is the biggest bedroom.
 */
function displayNames(rooms: ResolvedRoom[]): string[] {
  const base = rooms.map((room) =>
    room.label ? roomDisplayName(room.label) : UNNAMED,
  )

  const totals = new Map<string, number>()
  for (const name of base) totals.set(name, (totals.get(name) ?? 0) + 1)

  const used = new Map<string, number>()
  return base.map((name) => {
    if ((totals.get(name) ?? 0) < 2) return name
    const nth = (used.get(name) ?? 0) + 1
    used.set(name, nth)
    return `${name} ${nth}`
  })
}

function estimateCost(floors: FloorSummary[], rate: number): CostEstimate {
  if (rate <= 0 || floors.length === 0) return null

  const perFloor = floors.map((floor) => ({
    name: floor.name,
    sqFt: floor.builtUpSqFt,
    cost: floor.cost ?? 0,
  }))

  return {
    ratePerSqFt: rate,
    totalSqFt: floors.reduce((sum, f) => sum + f.builtUpSqFt, 0),
    total: perFloor.reduce((sum, f) => sum + f.cost, 0),
    perFloor,
  }
}

function measurePlot(
  plot: Plot | null,
  plotFacing: Facing,
  northOffset: number,
): AreaStatement['plot'] {
  if (!plot) return null

  const areaSqM = rectArea(plotRect(plot))
  const buildable = buildableRect(plot, plotFacing, northOffset)
  const buildableSqM = buildable ? rectArea(buildable) : 0

  return {
    areaSqM,
    areaSqFt: toSqFt(areaSqM),
    buildableSqM,
    buildableSqFt: toSqFt(buildableSqM),
  }
}

/**
 * Reads every storey against the ruleset and folds the results into one
 * summary.
 *
 * The score is the per-floor scores weighted by how many rooms each floor
 * actually had a rule for. Re-deriving one score from the pooled counts would
 * mean writing the weighting a second time, where it could drift from
 * `analyseVastu`; weighting the scores it returns keeps a single definition of
 * what the number means, penalties included.
 */
function summariseVastu(
  measured: MeasuredFloor[],
  northOffset: number,
  plotFacing: Facing,
): VastuSummary | null {
  const rows: VastuRow[] = []
  const notes: string[] = []
  const counts: VastuCounts = { good: 0, okay: 0, avoid: 0, noRule: 0 }

  let weighted = 0
  let ruled = 0
  let entrance: string | null = null

  for (const { floor, rooms, names } of measured) {
    const report = analyseVastu(rooms, floor.walls, northOffset, plotFacing)
    entrance ??= report.entrance.message

    for (const [index, verdict] of report.rooms.entries()) {
      rows.push({
        floorName: floor.name,
        name: names[index] ?? UNNAMED,
        zone: zoneLabel(verdict.zone),
        coverage: verdict.coverage,
        status: verdict.status,
        message: verdict.message,
      })
    }

    counts.good += report.counts.good
    counts.okay += report.counts.okay
    counts.avoid += report.counts.avoid
    counts.noRule += report.counts.noRule

    const scored =
      report.counts.good + report.counts.okay + report.counts.avoid
    if (report.score !== null && scored > 0) {
      weighted += report.score * scored
      ruled += scored
    }

    notes.push(
      measured.length > 1
        ? `${floor.name}: ${report.brahmasthan.message}`
        : report.brahmasthan.message,
    )
  }

  // No room anywhere carries a rule, so there is no reading to report.
  if (ruled === 0) return null

  const score = Math.round(weighted / ruled)
  return {
    score,
    counts,
    headline: vastuHeadline(score, counts),
    rows,
    notes: entrance ? [entrance, ...notes] : notes,
  }
}

function vastuHeadline(score: number, counts: VastuCounts): string {
  const parts = [
    `${counts.good} placed as this ruleset prefers`,
    `${counts.okay} it allows`,
    `${counts.avoid} it would place elsewhere`,
  ]
  const tail =
    counts.noRule > 0 ? `; ${counts.noRule} it has no rule for` : ''

  return `Vastu score ${score} of 100 — ${parts.join(', ')}${tail}.`
}

/**
 * Rupees with Indian digit grouping: `₹24,50,000`.
 *
 * Shared so the sheet, the CSV summary and the panel group the same way —
 * `en-IN` does lakh/crore grouping, which is what an Indian reader scans for.
 */
export function formatRupees(rupees: number): string {
  const value = Number.isFinite(rupees) ? Math.round(rupees) : 0
  return `₹${new Intl.NumberFormat('en-IN').format(value)}`
}

/** One lakh, in rupees. */
const LAKH = 100000

/** One crore, in rupees. */
const CRORE = 100 * LAKH

/**
 * The lakh/crore reading — `₹24.5 lakh` — or null below a lakh, where the
 * grouped figure is already the way the number would be said aloud.
 */
export function formatRupeesApprox(rupees: number): string | null {
  const value = Number.isFinite(rupees) ? rupees : 0
  if (value >= CRORE) return `₹${trim(value / CRORE)} crore`
  if (value >= LAKH) return `₹${trim(value / LAKH)} lakh`
  return null
}

/** Two significant decimals at most, with trailing zeros dropped. */
const trim = (value: number) => String(Number(value.toFixed(2)))

/** Excel on Windows reads a UTF-8 CSV as the local code page without this. */
const BOM = '\uFEFF'

/** RFC 4180. Excel accepts bare LF, other spreadsheet tools are fussier. */
const CRLF = '\r\n'

/**
 * The statement as a CSV, ready to write to a file.
 *
 * Laid out as sections separated by blank rows — rooms, then floors, then the
 * estimate, the plot and the Vastu reading — because that is how the printed
 * sheet reads, and someone comparing the two should not have to re-sort it.
 *
 * Units live in the header cells (`Area (sq ft)`), never beside the numbers,
 * so every value stays a number Excel can sum, and money is headed `(INR)`
 * rather than carrying a symbol into the cell.
 *
 * The returned string starts with a byte-order mark. Project names and the
 * Vastu sentences are free text — Devanagari, typographic dashes — and Excel
 * on Windows reads a mark-less UTF-8 file as the local code page and mangles
 * all of it. Parsers that do not expect the mark see it inside the first title
 * cell, which is prose either way, so nothing numeric is at risk.
 */
export function statementToCsv(statement: AreaStatement): string {
  const rows: string[][] = [
    ['Area Statement'],
    ['Project', statement.projectName],
    ['Date', statement.date],
    ['Basis', statement.basis],
    [],
    ['Floor', 'Room', 'Area (sq m)', 'Area (sq ft)'],
  ]

  for (const floor of statement.floors) {
    for (const room of floor.rooms) {
      rows.push([
        floor.name,
        room.name,
        sqM(room.areaSqM),
        sqFt(room.areaSqFt),
      ])
    }
  }

  rows.push(
    [],
    ['Floor', 'Rooms', 'Built-up (sq m)', 'Built-up (sq ft)', 'Cost (INR)'],
  )

  for (const floor of statement.floors) {
    rows.push([
      floor.name,
      String(floor.rooms.length),
      sqM(floor.builtUpSqM),
      sqFt(floor.builtUpSqFt),
      floor.cost === null ? '' : String(floor.cost),
    ])
  }

  rows.push([
    'Total built-up',
    String(statement.floors.reduce((n, f) => n + f.rooms.length, 0)),
    sqM(statement.totalBuiltUpSqM),
    sqFt(statement.totalBuiltUpSqFt),
    statement.cost === null ? '' : String(statement.cost.total),
  ])

  if (statement.cost) {
    rows.push(
      [],
      ['Construction rate (INR per sq ft)', String(statement.cost.ratePerSqFt)],
      ['Estimated cost (INR)', String(statement.cost.total)],
    )
  }

  if (statement.plot) {
    rows.push(
      [],
      ['Plot area (sq m)', 'Plot area (sq ft)', 'Buildable (sq ft)'],
      [
        sqM(statement.plot.areaSqM),
        sqFt(statement.plot.areaSqFt),
        sqFt(statement.plot.buildableSqFt),
      ],
    )
  }

  if (statement.vastu) {
    rows.push([], ['Vastu'], [statement.vastu.headline])
    rows.push(['Floor', 'Room', 'Zone', 'Coverage (%)', 'Status', 'Note'])
    for (const row of statement.vastu.rows) {
      rows.push([
        row.floorName,
        row.name,
        row.zone,
        String(Math.round(row.coverage * 100)),
        row.status,
        row.message,
      ])
    }
    for (const note of statement.vastu.notes) rows.push([note])
  }

  return (
    BOM + rows.map((row) => row.map(csvField).join(',')).join(CRLF) + CRLF
  )
}

const sqM = (value: number) => value.toFixed(2)

const sqFt = (value: number) => value.toFixed(1)

/** RFC 4180 quoting: doubled quotes, and only where a field needs them. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
