/**
 * Does upsampling recover a wall network, or manufacture pixels? DEV ONLY.
 *
 *   npm run corpus:resample -- <label>=<file>[@<pre>] ...
 *
 * `<pre>` converts that file's pixels back to the pixels of whatever you are
 * calling the ORIGINAL, and it is the only fiddly part. For a file upsampled
 * ×2 from the original, `@0.5`. For a file that was first shrunk 830→474 and
 * then pushed back up ×2, `@0.875` (= 830/474/2). Default 1.
 *
 * ── Why the normalisation matters more than anything else here ──
 * Every thickness is divided by `pre × headlessRaster`'s own factor, so all
 * variants are reported in the SAME units. Reporting raster pixels would make
 * a ×4 upsample look four times better by construction, which is exactly the
 * mistake this experiment exists to avoid.
 *
 * ── The experiments this reproduces (Gate 1a architecture review) ──
 * Generate variants with ffmpeg, e.g.
 *   ffmpeg -i in.png -vf "scale=iw*2:ih*2:flags=bicubic"  x2-bicubic.png
 *   ffmpeg -i in.png -vf "scale=474:-1:flags=bicubic"      shrunk474.png
 *
 * A. img3/img4 native vs ×2/×4 in both kernels.
 * B. THE CONTROL, and the one that decides it: a known-good 830 px line
 *    drawing (Media(9)'s plan panel) reads as 10 segments, 1 family, dominant
 *    1.00, bbox 698×689. Shrink it to 474 → 3 families, bbox 714×697. Push it
 *    back up ×2 BICUBIC → 10 segments, 1 family, 1.00, 698×689: the native
 *    reading recovered exactly. ×2 NEAREST recovers nothing.
 * C. The kernel isolated — same 474 px input, same 1400 px output, only the
 *    kernel differs: bicubic 2 families and bbox 698×689 (exact); nearest
 *    3 families and 715×697, 2.4% too large. `raster.ts:135` uses nearest.
 * D. The control still recovers from 360, 300 and 240 px. It breaks at 180.
 * E. Resolution is NOT the variable: a 180 px image reads as 1 family and an
 *    1892 px one as 5. Across 10× in pixel count the family count tracks WHICH
 *    DRAWING it is. This is finding 38 and it is why Gate 1a's axis is wrong.
 *
 * ── The obligation ──
 * Every one of those was measured on 474 px thumbnails or a crop of a JPEG.
 * They must ALL be re-run when full-resolution drawings arrive, and none of
 * them may be cited as validated until then (§10 rule 6).
 */
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { detectWallSegments } from '../src/blueprint/detectWalls'
import { thicknessFamilies } from '../src/blueprint/plausibility'
import { headlessRaster } from './headlessRaster'

const cases = process.argv.slice(2).map((arg) => {
  const [label, rest] = arg.split('=')
  const [file, pre] = (rest ?? '').split('@')
  return { label, file, pre: pre ? Number(pre) : 1 }
})

if (cases.length === 0 || cases.some((c) => !c.file)) {
  console.error('usage: corpus:resample -- <label>=<file>[@<pre>] ...')
  process.exit(1)
}

const quantile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN
const median = (sorted: number[]) =>
  !sorted.length
    ? NaN
    : sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2

console.log(
  'variant'.padEnd(22) + 'raster'.padStart(11) + 'segs'.padStart(6) + 'fams'.padStart(6) +
    'dom'.padStart(7) + 'medOrig'.padStart(9) + 'p10'.padStart(7) + 'p90'.padStart(7) +
    '   bbox in ORIGINAL px',
)

for (const c of cases) {
  const png = PNG.sync.read(readFileSync(c.file))
  const { image, scale } = headlessRaster({
    data: new Uint8ClampedArray(png.data), width: png.width, height: png.height,
  })
  const segments = detectWallSegments(image, { rasterScale: scale })
  const toOriginal = (v: number) => (v / scale) * c.pre
  const thicknesses = segments.map((s) => toOriginal(s.thickness)).sort((a, b) => a - b)
  const families = thicknessFamilies(thicknesses)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2); maxX = Math.max(maxX, s.x1, s.x2)
    minY = Math.min(minY, s.y1, s.y2); maxY = Math.max(maxY, s.y1, s.y2)
  }

  console.log(
    c.label.padEnd(22) +
      `${image.width}x${image.height}`.padStart(11) +
      String(segments.length).padStart(6) +
      String(families.length).padStart(6) +
      (segments.length ? (families[0].length / segments.length).toFixed(2) : '-').padStart(7) +
      median(thicknesses).toFixed(2).padStart(9) +
      quantile(thicknesses, 0.1).toFixed(2).padStart(7) +
      quantile(thicknesses, 0.9).toFixed(2).padStart(7) +
      (segments.length
        ? `   ${toOriginal(maxX - minX).toFixed(0)} x ${toOriginal(maxY - minY).toFixed(0)}`
        : ''),
  )
}
