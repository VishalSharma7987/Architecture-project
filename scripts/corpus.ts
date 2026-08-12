/**
 * Corpus intake harness — DEV ONLY, not production code, not in the app bundle.
 *
 *   npm run corpus <dir-or-file> [--out <path.json>]
 *
 * Reads a directory of drawings and records, for each one, what the B5b
 * plausibility gates said about it and how far it got. One row per drawing,
 * written as JSON and CSV.
 *
 * ── What this is for, and what it is NOT ──
 * It measures the GATES, not the detector's accuracy. Accuracy needs hand-traced
 * ground truth, which needs real drawings, which is what this exists to help
 * collect. Nothing here may be read as an accuracy claim (§10 rule 6), and the
 * thresholds it reports against are DERIVED, not validated.
 *
 * ── Honesty rules it follows ──
 * Every field that could not be measured says WHY, and the reasons are
 * distinct: `not-reached` (an earlier gate refused, so this one never ran) is a
 * different fact from `no-decoder` (the format cannot be read headless) and
 * from `not-wired` (the gate exists but no production code calls it). Collapsing
 * those into one blank is how a harness reports coverage it does not have.
 *
 * Deliberately no summary line and no pass rate. A single number over a corpus
 * of two is theatre.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { detectWallSegments, segmentsToWalls } from '../src/blueprint/detectWalls'
import {
  gateAfterDetection,
  gateBeforeDetection,
  thicknessFamilies,
  type GateResult,
} from '../src/blueprint/plausibility'
import { rasterise } from '../src/blueprint/raster'
import type { CalibrationSource } from '../src/store/useDesignStore'

/* ─── image headers, without decoding ─────────────────────────────────── */

type Dims = { width: number; height: number; format: string }

/**
 * Dimensions from the file header alone.
 *
 * Deliberately header-only: Gate 1a is scale-free and answers before anything
 * is decoded, which is the whole reason it exists. A 400 px drawing should be
 * refused without spending a decode on it.
 */
function readDims(file: string): Dims | null {
  const b = readFileSync(file)

  if (b.length > 24 && b.toString('ascii', 1, 4) === 'PNG') {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), format: 'png' }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      const isFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), format: 'jpeg' }
      }
      i += 2 + b.readUInt16BE(i + 2)
    }
    return null
  }
  if (b.length > 30 && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16)
    if (chunk === 'VP8X') {
      return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), format: 'webp' }
    }
    if (chunk === 'VP8 ') {
      const s = b.indexOf(Buffer.from([0x9d, 0x01, 0x2a]))
      if (s < 0) return null
      return {
        width: b.readUInt16LE(s + 3) & 0x3fff,
        height: b.readUInt16LE(s + 5) & 0x3fff,
        format: 'webp',
      }
    }
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        format: 'webp',
      }
    }
  }
  return null
}

/** Only PNG can be decoded headless here — `pngjs` is the one decoder we have. */
const DECODABLE = new Set(['png'])

/* ─── optional per-drawing metadata ───────────────────────────────────── */

type Meta = {
  metresPerPixel?: number
  calibrationSource?: CalibrationSource
  note?: string
}

/**
 * `<image>.meta.json` beside the drawing, if the practice supplied a dimension.
 *
 * Absent is the normal case and is not an error: a drawing with no scale still
 * exercises every gate except the resolution one, which is exactly what the
 * intake request says.
 */
function readMeta(file: string): Meta {
  const path = `${file}.meta.json`
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Meta
  } catch {
    return {}
  }
}

/* ─── one drawing ─────────────────────────────────────────────────────── */

type Unmeasured = 'not-reached' | 'no-decoder' | 'not-wired' | 'no-scale'

type Row = {
  file: string
  format: string | null
  width: number | null
  height: number | null
  /** From the sidecar, or null when none was supplied. */
  metresPerPixel: number | null
  calibrationSource: CalibrationSource
  /** Gate verdicts by name: 'pass' | 'warn' | 'fail' | why it did not run. */
  gates: Record<string, string>
  /** The first gate to refuse, which is what the user would be told about. */
  firstRefusal: string | null
  /** The exact sentence the user sees. */
  message: string | null
  wallsCommitted: boolean
  wallCount: number | null
  thicknessFamilies: number | null
  dominantShare: number | null
  medianSourcePx: number | null
  junctionRatio: number | Unmeasured
  inkFraction: number | Unmeasured
}

const verdicts = (results: GateResult[]) =>
  Object.fromEntries(results.map((r) => [r.gate, r.status]))

function measure(file: string): Row {
  const dims = readDims(file)
  const meta = readMeta(file)
  const calibrationSource: CalibrationSource = meta.calibrationSource ?? 'none'

  const row: Row = {
    file: basename(file),
    format: dims?.format ?? null,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    metresPerPixel: meta.metresPerPixel ?? null,
    calibrationSource,
    gates: {},
    firstRefusal: null,
    message: null,
    wallsCommitted: false,
    wallCount: null,
    thicknessFamilies: null,
    dominantShare: null,
    medianSourcePx: null,
    // Gate 4 exists as a tested module and is called by NO production code.
    // Reported as `not-wired` rather than blank, because "we did not measure
    // it" and "nothing measures it" are different facts.
    junctionRatio: 'not-wired',
    inkFraction: 'not-wired',
  }

  if (!dims) {
    row.gates = { 'raster-size': 'unreadable' }
    row.firstRefusal = 'unreadable'
    row.message = 'The file header could not be read as an image.'
    return row
  }

  // Gate 1a is scale-free; 2 needs the sidecar; 1b needs 2 to have passed.
  // `metresPerPixel` only matters once Gate 2 lets the run get that far, so a
  // placeholder here can never influence a verdict that is reported.
  const before = gateBeforeDetection({
    sourceWidth: dims.width,
    sourceHeight: dims.height,
    sourceMetresPerPixel: meta.metresPerPixel ?? 1,
    calibrationSource,
    lockedByUser: false,
  })

  row.gates = verdicts(before.results)
  for (const gate of ['resolution', 'thickness-minimum', 'thickness-distribution']) {
    if (!(gate in row.gates)) row.gates[gate] = 'not-reached'
  }

  if (before.blocking) {
    row.firstRefusal = before.blocking.gate
    row.message = before.blocking.message
    return row
  }
  if (!DECODABLE.has(dims.format)) {
    row.gates['thickness-minimum'] = 'no-decoder'
    row.gates['thickness-distribution'] = 'no-decoder'
    row.message = `Passed the pre-detection gates; ${dims.format} cannot be decoded headless.`
    return row
  }
  if (meta.metresPerPixel === undefined) {
    // Unreachable while Gate 2 refuses a scale-less drawing, and kept anyway:
    // if Gate 2 ever softens, the thickness gates must not silently divide by
    // a placeholder and report a confident number.
    row.gates['thickness-minimum'] = 'no-scale'
    row.gates['thickness-distribution'] = 'no-scale'
    return row
  }

  const png = PNG.sync.read(readFileSync(file))
  const raster = rasterise({
    element: { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height },
    width: png.width,
    height: png.height,
    release: () => {},
  } as never)
  if (!raster.ok) {
    row.message = raster.error
    return row
  }

  const segments = detectWallSegments(raster.raster.image, {
    rasterScale: raster.raster.scale,
  })
  const walls = segmentsToWalls(segments, {
    metresPerPixel: meta.metresPerPixel / raster.raster.scale,
    origin: { x: 0, z: 0 },
  })
  const thicknesses = walls.map((w) => w.thickness)

  const after = gateAfterDetection(thicknesses, meta.metresPerPixel)
  row.gates = { ...row.gates, ...verdicts(after.results) }
  row.wallCount = walls.length

  const dist = after.results.find((r) => r.gate === 'thickness-distribution')
  row.thicknessFamilies = thicknessFamilies(thicknesses).length
  row.dominantShare = (dist?.measured.dominantShare as number) ?? null
  row.medianSourcePx = (dist?.measured.medianSourcePx as number) ?? null

  if (after.blocking) {
    row.firstRefusal = after.blocking.gate
    row.message = after.blocking.message
    return row
  }

  row.wallsCommitted = walls.length > 0
  row.message =
    [...before.warnings, ...after.warnings].map((w) => w.message).join(' ') || null
  return row
}

/* ─── run ─────────────────────────────────────────────────────────────── */

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

function collect(target: string): string[] {
  const stat = statSync(target)
  if (stat.isFile()) return [target]
  return readdirSync(target)
    .filter((name) => IMAGE_EXT.has(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(target, name))
}

const CSV_COLUMNS = [
  'file', 'format', 'width', 'height', 'calibrationSource', 'metresPerPixel',
  'raster-size', 'scale-provenance', 'resolution',
  'thickness-minimum', 'thickness-distribution', 'gate-4',
  'firstRefusal', 'wallsCommitted', 'wallCount',
  'thicknessFamilies', 'dominantShare', 'medianSourcePx',
  'junctionRatio', 'inkFraction', 'message',
] as const

const cell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(rows: Row[]): string {
  const line = (row: Row) =>
    CSV_COLUMNS.map((column) => {
      if (column === 'gate-4') return cell('not-wired')
      if (column in row.gates) return cell(row.gates[column])
      return cell((row as unknown as Record<string, unknown>)[column])
    }).join(',')
  return [CSV_COLUMNS.join(','), ...rows.map(line)].join('\n') + '\n'
}

const args = process.argv.slice(2)
const outFlag = args.indexOf('--out')
const out = outFlag >= 0 ? args[outFlag + 1] : null
const targets = args.filter((a, i) => !a.startsWith('--') && i !== outFlag + 1)

if (targets.length === 0) {
  console.error('usage: npm run corpus <dir-or-file> [--out results.json]')
  process.exit(1)
}

const files = targets.flatMap((t) => collect(resolve(t)))
if (files.length === 0) {
  console.error('No images found. Nothing measured — and that is the report.')
  process.exit(1)
}

const rows = files.map(measure)

for (const row of rows) {
  const verdict = row.firstRefusal
    ? `REFUSED at ${row.firstRefusal}`
    : row.wallsCommitted
      ? `built ${row.wallCount} walls`
      : 'no walls'
  console.log(`${row.file}  ${row.width}x${row.height} ${row.format}  ${verdict}`)
  if (row.message) console.log(`    ${row.message}`)
}

if (out) {
  writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`)
  writeFileSync(out.replace(/\.json$/, '.csv'), toCsv(rows))
  console.log(`\n${rows.length} row(s) -> ${out} and .csv`)
}
