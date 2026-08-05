/**
 * A PDF writer, written from scratch, because this project ships no PDF
 * library and may not add one.
 *
 * A PDF is a header, a run of numbered objects, a cross-reference table of
 * where each object starts in bytes, and a trailer. All of that is here. The
 * scope is deliberately the smallest thing that can carry this app's
 * deliverable — a drawing sheet, an area statement and a cost sheet — and
 * nothing more.
 *
 * WHAT IT DOES
 * - Multi-page documents, mixing image pages and text pages freely.
 * - Text set in the base-14 fonts Helvetica and Helvetica-Bold. Base-14 means
 *   the viewer supplies the font, so nothing has to be embedded; that single
 *   decision is what keeps a hand-rolled writer tractable.
 * - Headings, wrapped body text, bullets, rules and tables with right-aligned
 *   numeric columns. Long content flows onto continuation pages, and a table
 *   that spans a break repeats its header row.
 * - JPEG images embedded byte-for-byte as /DCTDecode XObjects — no re-encoding
 *   and no compressor of our own. That is exactly why the caller should hand
 *   over `canvas.toBlob('image/jpeg')` bytes and not a PNG: a PNG would need
 *   the zlib we do not have.
 *
 * WHAT IT DOES NOT DO — read this before extending it
 * - No compression of any kind. Content streams are plain text, so a text page
 *   is a few kilobytes. Fine here; wrong for a hundred-page report.
 * - No embedded fonts, so only Helvetica and Helvetica-Bold exist. No italic,
 *   no serif, no font the user chose.
 * - No transparency, no colour beyond greyscale fills for text and rules, no
 *   vector drawing beyond horizontal rules, no links, outlines or metadata
 *   beyond the document title.
 * - Only baseline/progressive JPEG in greyscale or RGB. CMYK JPEGs are
 *   rejected rather than mis-rendered.
 * - **Text is WinAnsi (Windows-1252) only.** There is no Unicode here. Devanagari,
 *   Tamil, or any other non-Latin script will NOT render — it becomes `?`. The
 *   rupee sign ₹ (U+20B9) is *not* in WinAnsi either, and this is the trap
 *   worth naming twice because every money figure in this app wants one.
 *
 * THE ₹ DECISION: `prepareText` transliterates ₹ to `Rs.` automatically, so a
 * caller who passes '₹24,50,000' gets a correct, readable 'Rs. 24,50,000'
 * rather than a `?`. That is the recommended path for tables and body text.
 * When a true ₹ glyph matters — a cover figure, a cost headline — draw the
 * text into a canvas with `renderPlanSheet`-style 2D drawing, encode that as
 * JPEG, and place it with `addImagePage`: canvas text is real Unicode and the
 * glyph survives. Anything else this module cannot map (an em dash has a
 * WinAnsi byte; a Devanagari letter does not) is replaced by `?`, never
 * silently dropped, so a mangled string is visible rather than invisible.
 */

/** A page size in PostScript points. 72 points to the inch, by definition. */
export type PdfPageSize = { width: number; height: number }

/** A4 across: 297 × 210 mm. The house size for a drawing sheet. */
export const A4_LANDSCAPE: PdfPageSize = { width: 841.89, height: 595.28 }

/** A4 upright: 210 × 297 mm. The house size for a statement or a cost sheet. */
export const A4_PORTRAIT: PdfPageSize = { width: 595.28, height: 841.89 }

/** How a table column is sized and aligned. */
export type PdfColumn = {
  header: string
  /**
   * Share of the content width, as a weight. Weights are normalised, so
   * `[3, 1, 1]` and `[0.6, 0.2, 0.2]` lay out identically.
   */
  width: number
  /** Right-align the column — what numbers want. Defaults to left. */
  align?: 'left' | 'right'
}

/** One table cell. Plain text, or text marked bold for a total row. */
export type PdfCell = string | { text: string; bold?: boolean }

/** A unit of flowed content on a text page. */
export type PdfBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'table'; columns: PdfColumn[]; rows: PdfCell[][] }
  | { kind: 'rule' }
  | { kind: 'gap'; height?: number }

/** A page of set text. Overflow continues onto further pages by itself. */
export type PdfTextPage = {
  /** Defaults to A4 portrait. */
  size?: PdfPageSize
  /** Sheet title, set large at the top of the first page. */
  title?: string
  /** One muted line under the title — a project name, a date. */
  subtitle?: string
  blocks: PdfBlock[]
  /** Muted line along the foot of every page this spec produces. */
  footer?: string
}

/** How an image is placed on its own page. */
export type PdfImagePageOptions = {
  /** Defaults to A4 landscape, which is the shape of this app's plan sheet. */
  size?: PdfPageSize
  /**
   * White border in points. Defaults to 0: a sheet from `renderPlanSheet`
   * already draws its own frame and title block, and a second margin around
   * that reads as a mistake.
   */
  margin?: number
}

/** An accumulating document. Build it with `createPdf`, then `buildPdf`. */
export type PdfDoc = {
  /** Pages in order, as specs — nothing is laid out until `buildPdf`. */
  pages: PdfPageSpec[]
  /** Goes into the document's /Title. Optional. */
  title?: string
}

type PdfPageSpec =
  | { kind: 'image'; size: PdfPageSize; margin: number; image: JpegImage }
  | { kind: 'text'; spec: PdfTextPage }

type JpegImage = {
  bytes: Uint8Array
  width: number
  height: number
  /** 1 for greyscale, 3 for RGB. */
  components: number
}

/** Starts an empty document. */
export function createPdf(title?: string): PdfDoc {
  return { pages: [], title }
}

/**
 * Appends a page holding one JPEG, scaled to fit and centred.
 *
 * The bytes are written into the file untouched, so whatever the encoder
 * produced is what a viewer decodes. Throws if the bytes are not a JPEG this
 * writer can describe.
 */
export function addImagePage(
  doc: PdfDoc,
  jpeg: Uint8Array,
  options: PdfImagePageOptions = {},
): void {
  doc.pages.push({
    kind: 'image',
    size: options.size ?? A4_LANDSCAPE,
    margin: options.margin ?? 0,
    image: readJpeg(jpeg),
  })
}

/**
 * Appends a page of text, plus continuation pages if the content overflows.
 *
 * Nothing is measured until `buildPdf`, because the page footers carry
 * "Page n of m" and m is not known until every page has been laid out.
 *
 * A table with rows but no data reads as a single muted "None" row under its
 * header, so an empty schedule looks answered rather than broken. A table with
 * no columns at all is dropped.
 */
export function addTextPage(doc: PdfDoc, page: PdfTextPage): void {
  doc.pages.push({ kind: 'text', spec: page })
}

/** Serialises the document. Bytes, for anywhere a Blob is the wrong shape. */
export function buildPdfBytes(doc: PdfDoc): Uint8Array {
  return serialise(doc)
}

/** Serialises the document as a `application/pdf` Blob, ready to download. */
export function buildPdf(doc: PdfDoc): Blob {
  return new Blob([serialise(doc)], { type: 'application/pdf' })
}

/* ------------------------------------------------------------------ text */

/**
 * Advance widths for Helvetica, in 1/1000 em, for WinAnsi bytes 32–126.
 * Adobe's own metrics. They only affect wrapping and alignment — a wrong
 * number looks untidy, it does not corrupt the file.
 */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
]

/** The same, for Helvetica-Bold. */
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
]

/**
 * Widths for the handful of WinAnsi bytes above 126 this app actually emits.
 * Everything else up there falls back to 556, which is close enough for prose
 * and never lands in a right-aligned number column.
 */
const HIGH_WIDTHS: Record<number, number> = {
  0x95: 350, // bullet
  0x96: 556, // en dash
  0x97: 1000, // em dash
  0xb0: 400, // degree
  0xb2: 333, // superscript two, for m²
  0xbd: 834, // one half
  0xd7: 584, // multiplication sign
}

/** Unicode code points that map to a WinAnsi byte outside Latin-1. */
const WINANSI_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
}

/** Characters with no WinAnsi byte that are worth spelling out anyway. */
const TRANSLITERATIONS: Array<[RegExp, string]> = [
  // The rupee sign, the one this app misses most. Before a figure it takes
  // the space it would have had as a symbol: 'Rs. 24,50,000'.
  [/₹\s*(?=[\d.])/g, 'Rs. '],
  [/₹/g, 'Rs.'],
  [/−/g, '-'], // true minus
  [/′/g, "'"],
  [/″/g, '"'],
  [/ /g, ' '], // non-breaking space: a normal space sets better
  [/\t/g, '    '],
]

/**
 * Turns arbitrary text into a string whose char codes ARE the WinAnsi bytes
 * a PDF viewer will read. Exported because callers sometimes need to know in
 * advance what a string will become.
 */
export function prepareText(text: string): string {
  let source = text
  for (const [pattern, replacement] of TRANSLITERATIONS) {
    source = source.replace(pattern, replacement)
  }

  let out = ''
  for (const character of source) {
    const code = character.codePointAt(0) ?? 0x3f
    if (code === 0x0a || code === 0x0d) {
      out += ' '
      continue
    }
    if (code >= 0x20 && code <= 0x7e) out += character
    else if (code >= 0xa1 && code <= 0xff) out += String.fromCharCode(code)
    else if (WINANSI_HIGH[code]) out += String.fromCharCode(WINANSI_HIGH[code])
    else out += '?'
  }
  return out
}

/** Width of already-prepared text, in points, at a given size. */
function measure(text: string, bold: boolean, size: number): number {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
  let total = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 32 && code <= 126) total += table[code - 32]
    else total += HIGH_WIDTHS[code] ?? 556
  }
  return (total * size) / 1000
}

/** Greedy wrap of prepared text. Words longer than the line are hard-split. */
function wrap(text: string, bold: boolean, size: number, width: number) {
  const lines: string[] = []
  let line = ''

  const flush = () => {
    if (line) lines.push(line)
    line = ''
  }

  for (const word of text.split(/ +/)) {
    if (!word) continue
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate, bold, size) <= width) {
      line = candidate
      continue
    }
    flush()
    if (measure(word, bold, size) <= width) {
      line = word
      continue
    }
    // A single unbreakable run — a URL, a name with no spaces. Cut it.
    let piece = ''
    for (const character of word) {
      if (measure(piece + character, bold, size) > width && piece) {
        lines.push(piece)
        piece = ''
      }
      piece += character
    }
    line = piece
  }
  flush()

  return lines.length ? lines : ['']
}

/** Shortens prepared text to fit, marking the cut with an ellipsis. */
function clamp(text: string, bold: boolean, size: number, width: number) {
  if (measure(text, bold, size) <= width) return text
  let cut = text
  while (cut && measure(`${cut}...`, bold, size) > width) {
    cut = cut.slice(0, -1)
  }
  return `${cut}...`
}

/**
 * A PDF literal string. Escaping `(`, `)` and `\` is not cosmetic: a project
 * name reading "Verma (Phase 2)" would otherwise close the string early and
 * the file would be garbage from that byte on.
 */
function pdfString(prepared: string): string {
  let out = '('
  for (let i = 0; i < prepared.length; i++) {
    const code = prepared.charCodeAt(i)
    if (code === 0x28 || code === 0x29 || code === 0x5c) {
      out += `\\${prepared[i]}`
    } else if (code < 32 || code > 126) {
      out += `\\${code.toString(8).padStart(3, '0')}`
    } else {
      out += prepared[i]
    }
  }
  return `${out})`
}

/* ---------------------------------------------------------------- layout */

/** Type sizes and spacing, in points. One place to retune the look. */
const STYLE = {
  margin: 54,
  footerGap: 26,
  title: 20,
  subtitle: 10.5,
  heading: 12.5,
  body: 10,
  table: 9.5,
  footer: 8,
  /** Line height as a multiple of the font size. */
  lead: 1.4,
  cellPad: 5,
  ink: 0.1,
  muted: 0.42,
  rule: 0.75,
}

type Frag = {
  text: string
  x: number
  bold: boolean
  size: number
  align: 'left' | 'right'
  gray: number
}

type Item =
  | {
      kind: 'frags'
      height: number
      baseline: number
      frags: Frag[]
      table?: number
    }
  | { kind: 'rule'; height: number; offset: number; gray: number; table?: number }
  | { kind: 'gap'; height: number; table?: number }

type LaidPage = { size: PdfPageSize; items: PlacedItem[] }

type PlacedItem = { item: Item; top: number }

/** Lays one text spec out into as many pages as its content needs. */
function layoutText(spec: PdfTextPage): LaidPage[] {
  const size = spec.size ?? A4_PORTRAIT
  const left = STYLE.margin
  const width = size.width - STYLE.margin * 2
  const top = size.height - STYLE.margin
  const bottom = STYLE.margin + STYLE.footerGap

  const headers = new Map<number, Item[]>()
  const items: Item[] = []
  let tableId = 0

  for (const block of spec.blocks) {
    switch (block.kind) {
      case 'heading':
        items.push({ kind: 'gap', height: 8 })
        items.push(
          ...textItems(block.text, left, width, true, STYLE.heading, STYLE.ink),
        )
        items.push({ kind: 'gap', height: 3 })
        break
      case 'text':
        items.push(
          ...textItems(block.text, left, width, false, STYLE.body, STYLE.ink),
        )
        items.push({ kind: 'gap', height: 4 })
        break
      case 'bullets':
        for (const entry of block.items) {
          const lines = textItems(
            entry, left + 14, width - 14, false, STYLE.body, STYLE.ink,
          )
          const first = lines[0]
          if (first.kind === 'frags') {
            first.frags.unshift({
              text: prepareText('•'),
              x: left + 3,
              bold: false,
              size: STYLE.body,
              align: 'left',
              gray: STYLE.muted,
            })
          }
          items.push(...lines)
        }
        items.push({ kind: 'gap', height: 4 })
        break
      case 'table':
        tableId += 1
        items.push(...tableItems(block, left, width, tableId, headers))
        items.push({ kind: 'gap', height: 8 })
        break
      case 'rule':
        items.push({ kind: 'gap', height: 5 })
        items.push({ kind: 'rule', height: 1, offset: 0, gray: 0.75 })
        items.push({ kind: 'gap', height: 5 })
        break
      case 'gap':
        items.push({ kind: 'gap', height: block.height ?? 12 })
        break
    }
  }

  const pages: LaidPage[] = []
  let page: PlacedItem[] = []
  let y = top
  let first = true

  const openPage = () => {
    page = []
    y = top
    if (first) {
      if (spec.title) {
        const line = prepareText(spec.title)
        page.push({
          item: {
            kind: 'frags',
            height: STYLE.title * 1.2,
            baseline: STYLE.title,
            frags: [frag(clamp(line, true, STYLE.title, width), left,
              true, STYLE.title, STYLE.ink)],
          },
          top: y,
        })
        y -= STYLE.title * 1.2
      }
      if (spec.subtitle) {
        const line = prepareText(spec.subtitle)
        page.push({
          item: {
            kind: 'frags',
            height: STYLE.subtitle * 1.6,
            baseline: STYLE.subtitle,
            frags: [frag(clamp(line, false, STYLE.subtitle, width), left,
              false, STYLE.subtitle, STYLE.muted)],
          },
          top: y,
        })
        y -= STYLE.subtitle * 1.6
      }
      if (spec.title || spec.subtitle) {
        page.push({
          item: { kind: 'rule', height: 10, offset: 4, gray: 0.6 },
          top: y,
        })
        y -= 10
      }
    } else if (spec.title) {
      const line = prepareText(`${spec.title} (continued)`)
      page.push({
        item: {
          kind: 'frags',
          height: STYLE.body * 2.2,
          baseline: STYLE.body,
          frags: [frag(clamp(line, true, STYLE.body, width), left, true,
            STYLE.body, STYLE.muted)],
        },
        top: y,
      })
      y -= STYLE.body * 2.2
    }
    first = false
  }

  openPage()

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    // A table header stranded at the foot of a page reads as a lost row, so
    // demand room for the header plus a line of body under it.
    const needed = isHeaderOf(item, headers)
      ? item.height + STYLE.table * STYLE.lead * 2
      : item.height

    if (y - needed < bottom && page.length) {
      pages.push({ size, items: page })
      openPage()
      const repeat = item.table ? headers.get(item.table) : undefined
      if (repeat && !isHeaderOf(item, headers)) {
        for (const head of repeat) {
          page.push({ item: head, top: y })
          y -= head.height
        }
      }
    }

    if (item.kind !== 'gap' || y < top) {
      page.push({ item, top: y })
      y -= item.height
    }
  }

  pages.push({ size, items: page })
  return pages
}

/** True when this item is part of its table's repeatable header group. */
function isHeaderOf(item: Item, headers: Map<number, Item[]>): boolean {
  if (!item.table) return false
  const group = headers.get(item.table)
  return group ? group.includes(item) : false
}

function frag(
  text: string, x: number, bold: boolean, size: number, gray: number,
  align: 'left' | 'right' = 'left',
): Frag {
  return { text, x, bold, size, align, gray }
}

/** Wraps a paragraph into one item per line. */
function textItems(
  text: string, x: number, width: number, bold: boolean, size: number,
  gray: number,
): Item[] {
  const prepared = prepareText(text)
  return wrap(prepared, bold, size, width).map((line) => ({
    kind: 'frags' as const,
    height: size * STYLE.lead,
    baseline: size,
    frags: [frag(line, x, bold, size, gray)],
  }))
}

/** Lays a table out: header, a rule, one item per row, a closing rule. */
function tableItems(
  block: { columns: PdfColumn[]; rows: PdfCell[][] },
  left: number, width: number, id: number, headers: Map<number, Item[]>,
): Item[] {
  // A table with no columns has nothing to draw and no cell to hang the
  // "None" row on. Drop it rather than invent a shape for it.
  if (!block.columns.length) return []

  const total = block.columns.reduce((sum, c) => sum + Math.max(c.width, 0), 0)
  const unit = total > 0 ? width / total : width / (block.columns.length || 1)

  const spans = block.columns.map((column) => Math.max(column.width, 0) * unit)
  const starts: number[] = []
  let cursor = left
  for (const span of spans) {
    starts.push(cursor)
    cursor += span
  }

  const rowHeight = STYLE.table * STYLE.lead + 3
  const size = STYLE.table

  const cellFrag = (index: number, text: string, bold: boolean, gray: number) => {
    const column = block.columns[index]
    const span = spans[index]
    const right = column.align === 'right'
    const inner = Math.max(span - STYLE.cellPad * 2, 1)
    const fitted = clamp(prepareText(text), bold, size, inner)
    const x = right
      ? starts[index] + span - STYLE.cellPad
      : starts[index] + STYLE.cellPad
    return frag(fitted, x, bold, size, gray, right ? 'right' : 'left')
  }

  const headerItems: Item[] = [
    {
      kind: 'frags',
      height: rowHeight,
      baseline: size,
      table: id,
      frags: block.columns.map((column, index) =>
        cellFrag(index, column.header, true, STYLE.ink),
      ),
    },
    { kind: 'rule', height: 4, offset: 2, gray: 0.45, table: id },
  ]
  headers.set(id, headerItems)

  const body: Item[] = []
  if (!block.rows.length) {
    body.push({
      kind: 'frags',
      height: rowHeight,
      baseline: size,
      table: id,
      frags: [cellFrag(0, 'None', false, STYLE.muted)],
    })
  }

  for (const row of block.rows) {
    body.push({
      kind: 'frags',
      height: rowHeight,
      baseline: size,
      table: id,
      frags: block.columns.map((_, index) => {
        const cell = row[index] ?? ''
        const text = typeof cell === 'string' ? cell : cell.text
        const bold = typeof cell === 'string' ? false : cell.bold === true
        return cellFrag(index, text, bold, STYLE.ink)
      }),
    })
  }

  body.push({ kind: 'rule', height: 5, offset: 3, gray: 0.7, table: id })
  return [...headerItems, ...body]
}

/* -------------------------------------------------------------- content */

/** Trims a number to two decimals without an exponent or trailing zeros. */
function num(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** Draws one laid-out page into a content stream. */
function textPageStream(
  page: LaidPage, footer: string | undefined, index: number, count: number,
): string {
  const parts: string[] = []
  let gray = -1

  const setGray = (value: number) => {
    if (value === gray) return
    parts.push(`${num(value)} g`)
    gray = value
  }

  for (const placed of page.items) {
    const { item, top } = placed
    if (item.kind === 'gap') continue
    if (item.kind === 'rule') {
      const y = top - item.offset
      setGray(item.gray)
      parts.push(
        `${num(item.gray)} G ${num(STYLE.rule)} w`,
        `${num(STYLE.margin)} ${num(y)} m`,
        `${num(page.size.width - STYLE.margin)} ${num(y)} l S`,
      )
      continue
    }
    for (const piece of item.frags) {
      if (!piece.text) continue
      const x = piece.align === 'right'
        ? piece.x - measure(piece.text, piece.bold, piece.size)
        : piece.x
      setGray(piece.gray)
      parts.push(
        'BT',
        `/${piece.bold ? 'F2' : 'F1'} ${num(piece.size)} Tf`,
        `1 0 0 1 ${num(x)} ${num(top - item.baseline)} Tm`,
        `${pdfString(piece.text)} Tj`,
        'ET',
      )
    }
  }

  const footY = STYLE.margin
  setGray(STYLE.muted)
  if (footer) {
    parts.push(
      'BT',
      `/F1 ${num(STYLE.footer)} Tf`,
      `1 0 0 1 ${num(STYLE.margin)} ${num(footY)} Tm`,
      `${pdfString(prepareText(footer))} Tj`,
      'ET',
    )
  }
  const stamp = prepareText(`Page ${index} of ${count}`)
  const stampX = page.size.width - STYLE.margin
    - measure(stamp, false, STYLE.footer)
  parts.push(
    'BT',
    `/F1 ${num(STYLE.footer)} Tf`,
    `1 0 0 1 ${num(stampX)} ${num(footY)} Tm`,
    `${pdfString(stamp)} Tj`,
    'ET',
  )

  return parts.join('\n')
}

/** Draws a full-page image, fitted and centred inside the margin. */
function imagePageStream(
  size: PdfPageSize, margin: number, image: JpegImage,
): string {
  const boxWidth = Math.max(size.width - margin * 2, 1)
  const boxHeight = Math.max(size.height - margin * 2, 1)
  const scale = Math.min(boxWidth / image.width, boxHeight / image.height)
  const drawWidth = image.width * scale
  const drawHeight = image.height * scale
  const x = (size.width - drawWidth) / 2
  const y = (size.height - drawHeight) / 2

  return [
    'q',
    `${num(drawWidth)} 0 0 ${num(drawHeight)} ${num(x)} ${num(y)} cm`,
    '/Im0 Do',
    'Q',
  ].join('\n')
}

/* ----------------------------------------------------------------- jpeg */

/** Markers that carry no payload, so they have no length field to skip. */
const STANDALONE = new Set([0xd8, 0xd9, 0x01])

/**
 * Reads a JPEG's frame header for its pixel size and colour components.
 *
 * Only the header is parsed; the bytes go into the file exactly as given.
 */
function readJpeg(bytes: Uint8Array): JpegImage {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Those bytes are not a JPEG image.')
  }

  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (STANDALONE.has(marker) || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    // SOFn carries the frame header, except for the two huffman/arithmetic
    // tables that share the C-range.
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 &&
      marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6]
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8]
      const components = bytes[offset + 9]
      if (!width || !height) {
        throw new Error('That JPEG declares a zero-sized frame.')
      }
      if (components !== 1 && components !== 3) {
        throw new Error(
          'Only greyscale and RGB JPEGs can be embedded; this one has ' +
          `${components} colour components.`,
        )
      }
      return { bytes, width, height, components }
    }
    if (marker === 0xda) break
    offset += 2 + length
  }

  throw new Error('That JPEG has no frame header this writer can read.')
}

/* ------------------------------------------------------------ serialiser */

type PdfObject = { body: string; stream?: Uint8Array }

/** Latin-1 bytes. Every string we emit is already WinAnsi, so this is exact. */
function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/**
 * Writes the whole file.
 *
 * Offsets are measured off the byte chunks as they are appended, never
 * predicted from string lengths — one wrong offset gives a file that some
 * viewers open and others reject outright, which is the worst kind of bug to
 * find later.
 */
function serialise(doc: PdfDoc): Uint8Array<ArrayBuffer> {
  const objects: PdfObject[] = []
  const reserve = () => {
    objects.push({ body: '' })
    return objects.length
  }
  const define = (id: number, body: string, stream?: Uint8Array) => {
    objects[id - 1] = { body, stream }
  }

  const catalog = reserve()
  const pageTree = reserve()
  const regular = reserve()
  const bold = reserve()

  define(regular,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ' +
    '/Encoding /WinAnsiEncoding >>')
  define(bold,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold ' +
    '/Encoding /WinAnsiEncoding >>')

  // Lay every page out first: footers carry "page n of m", so the count has
  // to be known before a single content stream is written.
  type Ready =
    | { kind: 'text'; page: LaidPage; footer?: string }
    | { kind: 'image'; size: PdfPageSize; margin: number; image: JpegImage }
  const ready: Ready[] = []

  for (const spec of doc.pages) {
    if (spec.kind === 'image') {
      ready.push({
        kind: 'image', size: spec.size, margin: spec.margin, image: spec.image,
      })
      continue
    }
    for (const page of layoutText(spec.spec)) {
      ready.push({ kind: 'text', page, footer: spec.spec.footer })
    }
  }

  const pageIds: number[] = []
  ready.forEach((entry, index) => {
    const pageId = reserve()
    const contentId = reserve()
    pageIds.push(pageId)

    let resources = `/Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >>`
    let content: string
    let size: PdfPageSize

    if (entry.kind === 'image') {
      const imageId = reserve()
      const space = entry.image.components === 1 ? 'DeviceGray' : 'DeviceRGB'
      define(imageId,
        '<< /Type /XObject /Subtype /Image ' +
        `/Width ${entry.image.width} /Height ${entry.image.height} ` +
        `/ColorSpace /${space} /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${entry.image.bytes.length} >>`,
        entry.image.bytes)
      resources += ` /XObject << /Im0 ${imageId} 0 R >>`
      content = imagePageStream(entry.size, entry.margin, entry.image)
      size = entry.size
    } else {
      content = textPageStream(
        entry.page, entry.footer, index + 1, ready.length,
      )
      size = entry.page.size
    }

    const bytes = latin1(content)
    define(contentId, `<< /Length ${bytes.length} >>`, bytes)
    define(pageId,
      `<< /Type /Page /Parent ${pageTree} 0 R ` +
      `/MediaBox [0 0 ${num(size.width)} ${num(size.height)}] ` +
      `/Resources << ${resources} >> /Contents ${contentId} 0 R >>`)
  })

  // A PDF with no pages is not a valid PDF; give it a blank one.
  if (!pageIds.length) {
    const pageId = reserve()
    const contentId = reserve()
    define(contentId, '<< /Length 0 >>', new Uint8Array(0))
    define(pageId,
      `<< /Type /Page /Parent ${pageTree} 0 R ` +
      `/MediaBox [0 0 ${num(A4_PORTRAIT.width)} ${num(A4_PORTRAIT.height)}] ` +
      `/Resources << /Font << /F1 ${regular} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  }

  const kids = pageIds.map((id) => `${id} 0 R`).join(' ')
  define(pageTree,
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`)

  const info = doc.title ? reserve() : 0
  if (info) {
    define(info, `<< /Title ${pdfString(prepareText(doc.title ?? ''))} ` +
      '/Producer (Space Designer) >>')
  }
  define(catalog, `<< /Type /Catalog /Pages ${pageTree} 0 R >>`)

  const chunks: Uint8Array[] = []
  let length = 0
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? latin1(part) : part
    chunks.push(bytes)
    length += bytes.length
  }

  push('%PDF-1.4\n')
  // A comment of high bytes: it tells transfer tools the file is binary.
  push('%\xE2\xE3\xCF\xD3\n')

  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets[index] = length
    push(`${index + 1} 0 obj\n${object.body}\n`)
    if (object.stream) {
      push('stream\n')
      push(object.stream)
      push('\nendstream\n')
    }
    push('endobj\n')
  })

  const xref = length
  const size = objects.length + 1
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    table += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  push(table)
  push(
    `trailer\n<< /Size ${size} /Root ${catalog} 0 R` +
    `${info ? ` /Info ${info} 0 R` : ''} >>\n` +
    `startxref\n${xref}\n%%EOF\n`,
  )

  const out = new Uint8Array(length)
  let cursor = 0
  for (const chunk of chunks) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  return out
}
