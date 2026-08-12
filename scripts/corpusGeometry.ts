/**
 * Is a drawing SQUARE — does its own stated dimension chain give the same
 * px/m on both axes? DEV ONLY.
 *
 *   npm run corpus:geometry <file> <x0> <x1> <y0> <y1> [--across <m>] [--down <m>]
 *
 * ── What it exists for ──
 * Finding 35: Gate 2 checks scale PROVENANCE, not scale CONSISTENCY. A drawing
 * stretched to fill a page passes every gate and produces walls that are wrong
 * in one axis. This is the measurement behind that finding and behind the
 * Gate 2b design report — and it must be re-runnable when full-resolution
 * files arrive, because every number derived from batch 3 was measured on a
 * 474 px thumbnail.
 *
 * ── Method, and why it is this one ──
 * The obvious approach — longest contiguous dark run per column — FAILS: outer
 * walls are broken by door and window openings, so no unbroken run survives.
 * What works is total dark pixels per column and per row inside a region,
 * taking the spans at or above a fraction of the maximum. An outer wall is the
 * tallest peak near an edge of the region.
 *
 * The region is given by hand because there is no crop step (finding 36), and
 * a title block, caption or elevation on the same sheet would otherwise
 * dominate the profile. The regions used for batch 3 are recorded in
 * `docs/testing/corpus-batch-3-gates.md` so the numbers can be reproduced
 * exactly.
 *
 * `--across` / `--down` are the drawing's own stated overall dimensions in
 * METRES. Given both, it reports px/m per axis and their agreement, which is
 * the whole point. Given neither, it reports the pixel spans and stops —
 * inventing a scale is the one thing this must not do.
 *
 * ── Measured with it (batch 3) ──
 *   img1  36.11 across / 36.00 down  → 99.7%   img3  23.92 / 24.56 → 97.4%
 *   img4  35.09 / 35.18              → 99.7%   Media(9)           → 85.9%
 * Real CAD drawings are square. The one that is not is a marketing composite.
 */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const args = process.argv.slice(2)
const flag = (name: string): number | null => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : null
}
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))

const [file] = positional
const [x0, x1, y0, y1] = positional.slice(1).map(Number)
const acrossMetres = flag('across')
const downMetres = flag('down')
/** Luminance below which a pixel counts as ink. Raise it for a grey scan. */
const THRESHOLD = flag('threshold') ?? 128
/** A peak is a span at or above this fraction of the profile's maximum. */
const PEAK_FRACTION = flag('peak') ?? 0.55

if (!file || Number.isNaN(y1)) {
  console.error('usage: corpus:geometry <file> <x0> <x1> <y0> <y1> [--across m] [--down m]')
  process.exit(1)
}

const png = PNG.sync.read(readFileSync(file))
const { width, data } = png
const isDark = (x: number, y: number) => {
  const i = (y * width + x) * 4
  return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114 < THRESHOLD
}

const colCount: number[] = []
for (let x = x0; x <= x1; x++) {
  let n = 0
  for (let y = y0; y <= y1; y++) if (isDark(x, y)) n++
  colCount.push(n)
}
const rowCount: number[] = []
for (let y = y0; y <= y1; y++) {
  let n = 0
  for (let x = x0; x <= x1; x++) if (isDark(x, y)) n++
  rowCount.push(n)
}

function peaks(counts: number[], offset: number) {
  const max = Math.max(...counts)
  const hot = counts
    .map((c, i) => (c >= PEAK_FRACTION * max ? i + offset : -1))
    .filter((i) => i >= 0)
  const spans: [number, number][] = []
  for (const n of hot) {
    const last = spans[spans.length - 1]
    if (last && n - last[1] <= 2) last[1] = n
    else spans.push([n, n])
  }
  return { max, spans }
}

const cols = peaks(colCount, x0)
const rows = peaks(rowCount, y0)

console.log(`${file.split(/[\\/]/).pop()}  ${png.width}x${png.height}`)
console.log(`  region x${x0}-${x1} y${y0}-${y1}  threshold ${THRESHOLD}  peak >= ${PEAK_FRACTION}`)
console.log(`  vertical bands   (${cols.max} dark px at the peak): ${cols.spans.map(([a, b]) => `${a}-${b}`).join('  ')}`)
console.log(`  horizontal bands (${rows.max} dark px at the peak): ${rows.spans.map(([a, b]) => `${a}-${b}`).join('  ')}`)
console.log('')
console.log('  The OUTERMOST band is very often a dimension line, not a wall. On img1 the')
console.log('  outermost rows are the 104 and 533 dimension lines and the walls are the')
console.log('  SECOND and SECOND-LAST — taking the outermost gives 429 px and 39.0 px/m')
console.log('  instead of 396 px and 36.0, and a spurious 7% axis disagreement with it.')
console.log('  So px/m is only computed when you name the bands:')
console.log('    --acrossBands <i>,<j>  --downBands <i>,<j>   (0-based, into the lists above)')

/**
 * Is the sheet level? Traces the first dark row per column across the region
 * and fits a line: a level wall is flat, a photographed print slopes, and the
 * slope IS the measurement.
 *
 * Measured: img1 0.03°, img4 0.00° (CAD controls); img2 0.59° (a photographed
 * print). Over a 341 px width that displaces a corner by 3.5 px, about 1% —
 * so SKEW IS NOT what makes a photograph hard. Uneven lighting is: img2's
 * measured px/m moves ±5% with the binarisation threshold, which is larger
 * than the drawing's own 1.1% axis disagreement.
 */
const skewRows = (() => {
  const i = args.indexOf('--skew')
  if (i < 0) return null
  const [from, to] = (args[i + 1] ?? '').split(',').map(Number)
  return Number.isFinite(from) && Number.isFinite(to) ? [from, to] : null
})()

if (skewRows) {
  // The row band must be TIGHT — a few pixels either side of the wall being
  // traced. Run over the whole plan region instead and the trace jumps between
  // the wall, the dimension line above it and the room text, fitting a line
  // through noise: img1 measures a confident -1.20° that way, with an rms
  // residual of 36.8 px announcing that the fit means nothing.
  const hits: [number, number][] = []
  for (let x = x0; x <= x1; x++) {
    for (let y = skewRows[0]; y <= skewRows[1]; y++) {
      if (isDark(x, y)) { hits.push([x, y]); break }
    }
  }
  if (hits.length >= 4) {
    const n = hits.length
    const sx = hits.reduce((a, [x]) => a + x, 0)
    const sy = hits.reduce((a, [, y]) => a + y, 0)
    const slope = (n * hits.reduce((a, [x, y]) => a + x * y, 0) - sx * sy) /
      (n * hits.reduce((a, [x]) => a + x * x, 0) - sx * sx)
    const intercept = (sy - slope * sx) / n
    const rms = Math.sqrt(
      hits.reduce((a, [x, y]) => a + (y - (slope * x + intercept)) ** 2, 0) / n,
    )
    console.log('')
    console.log(
      `  SKEW ${((Math.atan(slope) * 180) / Math.PI).toFixed(2)}°  ` +
        `(${n} hits, rms ${rms.toFixed(1)} px)   CAD controls measured 0.00-0.03°`,
    )
  }
}

const pair = (name: string): [number, number] | null => {
  const i = args.indexOf(`--${name}`)
  if (i < 0 || args[i + 1] === undefined) return null
  const [a, b] = args[i + 1].split(',').map(Number)
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null
}

const acrossBands = pair('acrossBands')
const downBands = pair('downBands')

if (acrossBands && downBands && acrossMetres && downMetres) {
  // Outer face to outer face: the far edge of the first band to the far edge
  // of the last. Centreline is reported beside it because which basis the
  // drawing's dimension used is usually not stated, and the difference is one
  // wall thickness — about 2.6% on a 9 m house.
  const cf = cols.spans[acrossBands[0]], cl = cols.spans[acrossBands[1]]
  const rf = rows.spans[downBands[0]], rl = rows.spans[downBands[1]]
  if (!cf || !cl || !rf || !rl) {
    console.error('\n  band index out of range')
    process.exit(1)
  }
  const mid = ([a, b]: [number, number]) => (a + b) / 2

  console.log('')
  console.log(`  using bands ACROSS ${cf[0]}-${cf[1]} .. ${cl[0]}-${cl[1]}   DOWN ${rf[0]}-${rf[1]} .. ${rl[0]}-${rl[1]}`)

  for (const [basis, acrossPx, downPx] of [
    ['outer-face', cl[1] - cf[0], rl[1] - rf[0]],
    ['centreline', mid(cl) - mid(cf), mid(rl) - mid(rf)],
  ] as const) {
    const a = acrossPx / acrossMetres
    const d = downPx / downMetres
    const agreement = (100 * Math.min(a, d)) / Math.max(a, d)
    console.log(
      `  ${basis}: ${acrossPx} x ${downPx} px  ->  ` +
        `ACROSS ${a.toFixed(2)} px/m   DOWN ${d.toFixed(2)} px/m   ` +
        `AGREEMENT ${agreement.toFixed(1)}%`,
    )
  }
  console.log('')
  console.log('  Under ~3% is the outer-face/centreline ambiguity, not a stretched drawing.')
  console.log('  Over ~10% no accidental cause explains it. See the Gate 2b design report.')
}
