import type {
  Facing,
  FloorData,
  Plot,
  Unit,
} from '../store/useDesignStore'
import type { PdfBlock, PdfCell, PdfColumn, PdfDoc } from './pdf'
import type { AreaStatement, VastuRow } from './statement'
import type { VastuStatus } from '../vastu/analyse'
import {
  A4_LANDSCAPE,
  addImagePage,
  addTextPage,
  buildPdf,
  createPdf,
} from './pdf'
import {
  buildAreaStatement,
  formatRupees,
  formatRupeesApprox,
  statementToCsv,
} from './statement'
import { renderPlanSheet } from '../plan/planSheet'
import { toFileName } from '../persistence/files'
import { openingSchedule } from '../openings/schedule'
import { OPENING_LABELS } from '../store/useDesignStore'
import { formatLength } from '../units/length'

/**
 * The finished documents: the drawing set, the area statement, the CSV.
 *
 * This module only composes. The plan sheet is drawn by `plan/planSheet`, the
 * numbers come from `export/statement`, and the file is written by
 * `export/pdf`; nothing here re-derives an area or re-draws a wall, so a figure
 * on the drawing, in the table and in the spreadsheet is the same figure.
 */

/**
 * Everything a document needs from the store.
 *
 * `floors` must be every storey — pass `allFloors(state)`. Passing
 * `state.floors` would measure and draw the open storey as it was when the
 * user last switched away from it.
 */
export type DocumentInput = {
  projectName: string | null
  /** ISO date for the title block and the sheet. Defaults to now. */
  date?: string
  floors: FloorData[]
  plot: Plot | null
  northOffset: number
  plotFacing: Facing
  constructionRate: number
  /** Display unit for every reading on the drawing. */
  units: Unit
}

/**
 * Pixels rendered for one plan page: 1.5x the PNG export's sheet.
 *
 * The page is A4 landscape, 297 mm across, so 3000 px is about 256 dpi. The
 * PNG sheet's 2000 px (171 dpi) is fine for a screen and marginal on paper —
 * dimension text on this sheet is set small, and JPEG's chroma subsampling
 * softens thin dark lines on white, so the extra pixels are spent where the
 * drawing is weakest. Above this the file grows faster than the drawing
 * improves.
 */
const PLAN_PAGE_PIXELS = { width: 3000, height: 2121 }

/**
 * JPEG quality for a plan page.
 *
 * Line art is the worst case for JPEG: every stroke is a hard edge, and the
 * ringing that quality 0.8 leaves around a dimension figure is exactly the
 * mush that makes a drawing undeliverable. 0.92 keeps the edges clean, and
 * because the sheet is mostly flat white it still compresses hard: a measured
 * storey came out around 135 kB, so even a three-storey set emails. (PNG is
 * not an option — the PDF writer embeds JPEG only.)
 */
const PLAN_JPEG_QUALITY = 0.92

/**
 * The full drawing set: one plan sheet per storey, then the area statement,
 * the cost estimate and the Vastu reading.
 */
export async function downloadPlanPdf(input: DocumentInput): Promise<void> {
  const date = input.date ?? new Date().toISOString()
  const statement = toStatement(input, date)
  const doc = createPdf(documentTitle(statement.projectName, 'floor plans'))

  const drawn = input.floors.filter(hasDrawing)
  // Nothing drawn on any storey: still issue one sheet. `renderPlanSheet`
  // writes "nothing drawn yet" inside the frame, which tells the user what
  // happened; a document that opens on the area statement does not.
  const sheets = drawn.length > 0 ? drawn : input.floors.slice(0, 1)

  for (const floor of sheets) {
    const jpeg = await renderFloorSheet({
      floor,
      title: `${statement.projectName} — ${floor.name}`,
      date,
      northOffset: input.northOffset,
      units: input.units,
    })
    addImagePage(doc, jpeg, { size: A4_LANDSCAPE, margin: 0 })
  }

  addStatementPages(doc, statement, input.floors, input.units)
  triggerDownload(buildPdf(doc), documentName(statement.projectName, 'plans'))
}

/** The area statement, the cost estimate and the Vastu reading on their own. */
export async function downloadAreaStatementPdf(
  input: DocumentInput,
): Promise<void> {
  const statement = toStatement(input, input.date ?? new Date().toISOString())
  const doc = createPdf(documentTitle(statement.projectName, 'area statement'))

  addStatementPages(doc, statement, input.floors, input.units)
  triggerDownload(
    buildPdf(doc),
    documentName(statement.projectName, 'area-statement'),
  )
}

/** The same numbers as a spreadsheet. */
export function downloadAreaStatementCsv(input: DocumentInput): void {
  const statement = toStatement(input, input.date ?? new Date().toISOString())
  const blob = new Blob([statementToCsv(statement)], {
    type: 'text/csv;charset=utf-8',
  })

  triggerDownload(
    blob,
    documentName(statement.projectName, 'area-statement', 'csv'),
  )
}

const toStatement = (input: DocumentInput, date: string): AreaStatement =>
  buildAreaStatement({
    projectName: input.projectName,
    date,
    floors: input.floors,
    plot: input.plot,
    northOffset: input.northOffset,
    plotFacing: input.plotFacing,
    constructionRate: input.constructionRate,
  })

/** A storey worth putting on a sheet: something on it would actually draw. */
const hasDrawing = (floor: FloorData) =>
  floor.walls.length > 0 || floor.furniture.length > 0

/* --------------------------------------------------------------- drawing */

/** Draws one storey at print resolution and encodes it as JPEG bytes. */
async function renderFloorSheet(options: {
  floor: FloorData
  title: string
  date: string
  northOffset: number
  units: Unit
}): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = PLAN_PAGE_PIXELS.width
  canvas.height = PLAN_PAGE_PIXELS.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not open a 2D canvas.')

  renderPlanSheet(ctx, {
    walls: options.floor.walls,
    furniture: options.floor.furniture,
    title: options.title,
    date: options.date,
    width: PLAN_PAGE_PIXELS.width,
    height: PLAN_PAGE_PIXELS.height,
    northOffset: options.northOffset,
    units: options.units,
    roomLabels: options.floor.roomLabels,
  })

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', PLAN_JPEG_QUALITY),
  )
  if (!blob) throw new Error('This browser could not encode the plan sheet.')

  return new Uint8Array(await blob.arrayBuffer())
}

/* ------------------------------------------------------------- statement */

/**
 * Why a total might not be a quotation. Printed with the estimate so a figure
 * lifted off this page is not mistaken for a builder's price.
 */
const COST_CAVEAT =
  'One rate applied to built-up area. It covers construction only — not the ' +
  'land, statutory approvals, or anything specified above the standard the ' +
  'rate assumes.'

/** The same sentence the Vastu panel closes with, for the same reason. */
const VASTU_CAVEAT =
  'Vastu Shastra is a traditional guideline system: this sheet reports what ' +
  'one written ruleset says, and you and your client decide what to follow.'

/** The reading words the on-screen panel uses, so both read alike. */
const STATUS_WORD: Record<VastuStatus, string> = {
  good: 'Preferred',
  okay: 'Not first choice',
  avoid: 'On avoid list',
  'no-rule': 'No rule',
}

/** Appends the statement page, and the Vastu page when there is a reading. */
function addStatementPages(
  doc: PdfDoc,
  statement: AreaStatement,
  floors: FloorData[],
  units: Unit,
): void {
  const subtitle = `${statement.projectName} — ${displayDate(statement.date)}`

  addTextPage(doc, {
    title: 'Area Statement',
    subtitle,
    footer: statement.projectName,
    blocks: areaBlocks(statement),
  })

  // Its own page, not a section on the area statement: a door and window
  // schedule is a sheet a builder is handed on its own, and §5.2 lists it as
  // a deliverable in its own right rather than as part of the area statement.
  const schedule = scheduleBlocks(floors, units)
  if (schedule.length > 0) {
    addTextPage(doc, {
      title: 'Door & Window Schedule',
      subtitle,
      footer: statement.projectName,
      blocks: schedule,
    })
  }

  if (statement.vastu) {
    addTextPage(doc, {
      title: 'Vastu Reading',
      subtitle,
      footer: statement.projectName,
      blocks: vastuBlocks(statement.vastu),
    })
  }
}

/**
 * The door and window schedule, one storey per table.
 *
 * Per storey rather than one merged table because a mark is scoped to a
 * drawing: `D1` on the ground floor and `D1` upstairs are two different sheets'
 * keys, and silently merging them would report a count nobody can check
 * against either plan.
 *
 * A conflicting mark is printed with both sizes and a line saying so. This is
 * the document a joiner quotes from, so a mark naming two different units has
 * to be visible on the paper — collapsing it to one size would put a wrong
 * number in an order, and that is the failure this schedule exists to prevent.
 */
function scheduleBlocks(floors: FloorData[], units: Unit): PdfBlock[] {
  const blocks: PdfBlock[] = []

  for (const floor of floors) {
    const rows = openingSchedule(floor.walls)
    if (rows.length === 0) continue

    const sizes = (values: number[]) =>
      values.map((v) => formatLength(v, units)).join(' / ')

    blocks.push(
      { kind: 'heading', text: `${floor.name} — doors & windows` },
      {
        kind: 'table',
        columns: [
          { header: 'Mark', width: 1.2 },
          { header: 'Type', width: 1.6 },
          { header: 'No.', width: 0.8, align: 'right' },
          { header: 'Width', width: 1.6, align: 'right' },
          { header: 'Height', width: 1.6, align: 'right' },
          { header: 'Sill', width: 1.4, align: 'right' },
        ],
        rows: rows.map((row): PdfCell[] => [
          // Bold marks the conflict on paper, where a colour tint would not
          // survive a photocopy and an icon has no font to come from.
          { text: row.mark ?? 'unmarked', bold: row.conflict },
          row.types.map((t) => OPENING_LABELS[t]).join(' / '),
          { text: String(row.count), bold: row.conflict },
          { text: sizes(row.widths), bold: row.conflict },
          { text: sizes(row.heights), bold: row.conflict },
          sizes(row.sills),
        ]),
      },
    )

    const conflicts = rows.filter((row) => row.conflict)
    if (conflicts.length > 0) {
      blocks.push({
        kind: 'text',
        text:
          `${conflicts.map((r) => r.mark).join(', ')} — a repeated mark means ` +
          'an identical unit, and these name more than one. Check the sizes ' +
          'before ordering.',
      })
    }
  }

  return blocks
}

function areaBlocks(statement: AreaStatement): PdfBlock[] {
  const blocks: PdfBlock[] = [
    { kind: 'text', text: statement.basis },
    { kind: 'heading', text: 'Built-up area' },
    builtUpTable(statement),
  ]

  const { cost } = statement
  if (cost) {
    const approx = formatRupeesApprox(cost.total)
    blocks.push(
      { kind: 'heading', text: 'Cost estimate' },
      {
        kind: 'text',
        text:
          `${formatRupees(cost.ratePerSqFt)} per sq ft on ` +
          `${sqFt(cost.totalSqFt)} sq ft of built-up area gives an ` +
          `estimated ${formatRupees(cost.total)}` +
          `${approx ? ` (${approx})` : ''}.`,
      },
      { kind: 'text', text: COST_CAVEAT },
    )
  }

  const { plot } = statement
  if (plot) {
    blocks.push(
      { kind: 'heading', text: 'Plot' },
      {
        kind: 'table',
        columns: [
          { header: 'Site', width: 3 },
          { header: 'sq m', width: 1.6, align: 'right' },
          { header: 'sq ft', width: 1.6, align: 'right' },
        ],
        rows: [
          ['Plot area', sqM(plot.areaSqM), sqFt(plot.areaSqFt)],
          [
            'Buildable within setbacks',
            sqM(plot.buildableSqM),
            sqFt(plot.buildableSqFt),
          ],
        ],
      },
    )

    const ground = statement.floors[0]
    if (ground && plot.areaSqM > 0) {
      const percent = Math.round((ground.builtUpSqM / plot.areaSqM) * 100)
      blocks.push({
        kind: 'text',
        text: `${ground.name} covers ${percent}% of the plot.`,
      })
    }
  }

  for (const floor of statement.floors) {
    blocks.push(
      { kind: 'heading', text: `${floor.name} — rooms` },
      {
        kind: 'table',
        columns: [
          { header: 'Room', width: 3 },
          { header: 'Area (sq m)', width: 1.6, align: 'right' },
          { header: 'Area (sq ft)', width: 1.6, align: 'right' },
        ],
        rows: floor.rooms
          .map((room): PdfCell[] => [
            room.name,
            sqM(room.areaSqM),
            sqFt(room.areaSqFt),
          ])
          .concat([
            [
              { text: 'Built-up area', bold: true },
              { text: sqM(floor.builtUpSqM), bold: true },
              { text: sqFt(floor.builtUpSqFt), bold: true },
            ],
          ]),
      },
    )
  }

  return blocks
}

/**
 * One row per storey and a total.
 *
 * The cost column only exists when a rate has been set: a column of blanks
 * would read as work that has not been priced yet rather than as a document
 * that is not about money.
 */
function builtUpTable(statement: AreaStatement): PdfBlock {
  const { cost } = statement
  const columns: PdfColumn[] = [
    { header: 'Floor', width: 2.6 },
    { header: 'Rooms', width: 1, align: 'right' },
    { header: 'Built-up (sq m)', width: 1.7, align: 'right' },
    { header: 'Built-up (sq ft)', width: 1.7, align: 'right' },
  ]
  // Headed 'Rs.' rather than a symbol the PDF's WinAnsi text cannot carry,
  // and the cells stay bare digits so the column right-aligns on the units.
  if (cost) columns.push({ header: 'Cost (Rs.)', width: 1.9, align: 'right' })

  const rows = statement.floors.map((floor): PdfCell[] => {
    const row: PdfCell[] = [
      floor.name,
      String(floor.rooms.length),
      sqM(floor.builtUpSqM),
      sqFt(floor.builtUpSqFt),
    ]
    if (cost) row.push(grouped(floor.cost ?? 0))
    return row
  })

  const total: PdfCell[] = [
    { text: 'Total', bold: true },
    {
      text: String(statement.floors.reduce((n, f) => n + f.rooms.length, 0)),
      bold: true,
    },
    { text: sqM(statement.totalBuiltUpSqM), bold: true },
    { text: sqFt(statement.totalBuiltUpSqFt), bold: true },
  ]
  if (cost) total.push({ text: grouped(cost.total), bold: true })

  return { kind: 'table', columns, rows: [...rows, total] }
}

function vastuBlocks(vastu: NonNullable<AreaStatement['vastu']>): PdfBlock[] {
  const blocks: PdfBlock[] = [
    { kind: 'text', text: vastu.headline },
    { kind: 'bullets', items: vastu.notes },
    { kind: 'heading', text: 'Room by room' },
    {
      kind: 'table',
      columns: [
        { header: 'Floor', width: 1.6 },
        { header: 'Room', width: 2 },
        { header: 'Zone', width: 1.5 },
        { header: 'In zone', width: 1, align: 'right' },
        { header: 'Reading', width: 1.8 },
      ],
      rows: vastu.rows.map((row): PdfCell[] => [
        row.floorName,
        row.name,
        row.zone,
        `${Math.round(row.coverage * 100)}%`,
        STATUS_WORD[row.status],
      ]),
    },
  ]

  // The messages are sentences, and a table cell truncates rather than wraps,
  // so the ones worth reading are set as prose instead.
  const flagged = vastu.rows.filter((row) => row.status === 'avoid')
  if (flagged.length > 0) {
    blocks.push(
      { kind: 'heading', text: 'On the avoid list' },
      { kind: 'bullets', items: flagged.map(sentence) },
    )
  }

  blocks.push({ kind: 'rule' }, { kind: 'text', text: VASTU_CAVEAT })
  return blocks
}

const sentence = (row: VastuRow) => `${row.floorName}: ${row.message}`

/* ---------------------------------------------------------------- output */

/** Indian grouping, so a lakh reads as one: `41,85,008`. */
const grouped = (value: number) =>
  new Intl.NumberFormat('en-IN').format(Math.round(value))

/** Two decimals of a square metre is a tenth of a square foot. Enough. */
const sqM = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

const sqFt = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)

/** `22 Jul 2026` — unambiguous, unlike any all-numeric ordering. */
function displayDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/**
 * The name a viewer puts in its window bar. ASCII only, deliberately.
 *
 * A page's text lives in a content stream, which really is WinAnsi, but a
 * document title is a PDF *text string* — PDFDocEncoding unless it is marked
 * UTF-16 — and the two disagree over every byte from 0x80 to 0x9F. Chrome
 * shows an em dash written there as `Š`. So the separator here is a plain
 * hyphen; a project name with its own accents is still at the writer's mercy,
 * but nothing this module adds is.
 */
const documentTitle = (project: string, kind: string) =>
  `${project} - ${kind}`

/** The project's own slug rules, with a document suffix and a new tail. */
const documentName = (project: string, suffix: string, extension = 'pdf') =>
  toFileName(project).replace(/\.json$/, `-${suffix}.${extension}`)

/**
 * The anchor dance, once more.
 *
 * `imageExport` has the same six lines but does not export them, and that file
 * belongs to the PNG exports; duplicating beats reaching across.
 */
function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()

  // The click starts the download asynchronously, so revoking inline can lose
  // the file in some browsers; one turn of the event loop is enough.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
