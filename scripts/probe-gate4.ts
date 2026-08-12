/**
 * Scale-free probe: what do the detector and Gate 4 actually do with these
 * drawings, given they all refuse at Gate 2 before anything downstream runs?
 *
 *   npm run corpus:probe <dir-of-pngs>
 *
 * Every image in the first real corpus batch refuses at `scale-provenance`,
 * so the harness correctly reports `not-reached` for everything after it. That
 * leaves the question the batch was supposed to answer unanswered: does the
 * ink-fraction ceiling refuse a coloured marketing render? Does the junction
 * ratio?
 *
 * It can be answered WITHOUT inventing a calibration, because **Gate 4 is
 * scale-free** — it reads the mask and the segments in pixels. So are Gate
 * 3B's family count and dominant share. Only `medianSourcePx` needs a scale,
 * and this deliberately does not report it rather than assume one.
 *
 * Uses only exported functions. Nothing in `detectWalls.ts` was opened up for
 * it: telling "Gate 4 refused this" apart from "the existing filters found
 * nothing" is done by measuring the same images against a build with the
 * candidate loop reverted, which is a measurement rather than a change.
 *
 * DEV ONLY, and a PROBE, not a gate.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import {
  detectWallSegments,
  inkMask,
  paperContrastMasks,
  type RasterLike,
} from '../src/blueprint/detectWalls'
import { MAX_INK_FRACTION, thicknessFamilies } from '../src/blueprint/plausibility'
import { headlessRaster } from './headlessRaster'

const round = (n: number) => Number(n.toFixed(3))

type Seg = { x1: number; y1: number; x2: number; y2: number; thickness: number }

function junctionRatio(segments: Seg[], slack: number): number {
  if (segments.length === 0) return 0
  const boxes = segments.map((s) => ({
    minX: Math.min(s.x1, s.x2) - slack - s.thickness / 2,
    maxX: Math.max(s.x1, s.x2) + slack + s.thickness / 2,
    minY: Math.min(s.y1, s.y2) - slack - s.thickness / 2,
    maxY: Math.max(s.y1, s.y2) + slack + s.thickness / 2,
  }))
  let touching = 0
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]
    if (
      boxes.some(
        (b, j) =>
          i !== j && a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY,
      )
    ) {
      touching++
    }
  }
  return touching / segments.length
}

const inkFractionOf = (mask: Uint8Array): number => {
  if (mask.length === 0) return 0
  let ink = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]) ink++
  return ink / mask.length
}

const target = resolve(process.argv[2] ?? 'corpus')
const files = statSync(target).isFile()
  ? [target]
  : readdirSync(target)
      .filter((n) => extname(n).toLowerCase() === '.png')
      .sort()
      .map((n) => join(target, n))

console.log(
  'file'.padEnd(14) +
    'primaryInk'.padStart(11) +
    'segs'.padStart(6) +
    'junc'.padStart(7) +
    'fams'.padStart(6) +
    'domShare'.padStart(10) +
    '  thicknessesPx',
)

/**
 * Paints a mask into a pure black-on-white raster so it can be re-detected.
 *
 * A PROXY for the private `segmentsFromMask`, and reported as one: on a bimodal
 * 0/255 image Otsu lands between the modes so `inkMask` recovers the mask
 * exactly, but it is not the same call. Validated by checking that the best
 * candidate's segment count equals the real `detectWallSegments` output — it
 * did, on all four batch-3 drawings.
 *
 * Nothing in `detectWalls.ts` was opened up for this. `inkMask` and
 * `paperContrastMasks` are both already exported, and `candidateMasks` is
 * `[inkMask(image), ...paperContrastMasks(image)]`.
 */
function paintMask(mask: Uint8Array, width: number, height: number): RasterLike {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 0 : 255
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

/**
 * `--candidates` breaks the winner down by mask, which is what answered "what
 * do the four binarisations do with a photographed print?" for batch 3:
 *
 *   inkMask 0.097 -> 31 segments and WINS; the two paper-contrast readings
 *   0.076 -> 10 each; the fourth 0.000 -> 0.
 *
 * Two things fell out. Plain Otsu beat both paper-contrast masks on real paper,
 * which is the case they were written for. And the FOURTH candidate — the
 * lighter-than-paper mask, for `sheet-blueprint` — has produced zero segments
 * on all eleven images ever measured, because the corpus holds no blueprints.
 * Unexercised, not dead.
 */
const SHOW_CANDIDATES = process.argv.includes('--candidates')

for (const file of files) {
  const png = PNG.sync.read(readFileSync(file))
  const name = file.split(/[\\/]/).pop()!.replace('.png', '')
  const { image, scale } = headlessRaster({
    data: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height,
  })

  if (SHOW_CANDIDATES) {
    const masks = [inkMask(image), ...paperContrastMasks(image)]
    console.log(`\n${name} — ${masks.length} candidates`)
    masks.forEach((mask, i) => {
      const fraction = inkFractionOf(mask)
      const found = detectWallSegments(paintMask(mask, image.width, image.height), {
        rasterScale: scale,
      })
      console.log(
        `  ${i}  ${(i === 0 ? 'inkMask' : `paperContrast[${i - 1}]`).padEnd(18)}` +
          `ink ${round(fraction).toString().padStart(6)}  ` +
          `segs ${String(found.length).padStart(4)}  ` +
          (fraction > MAX_INK_FRACTION ? `REJECTED by the ${MAX_INK_FRACTION} ceiling` : 'ok'),
      )
    })
  }

  const ink = inkFractionOf(inkMask(image))
  const segments = detectWallSegments(image, { rasterScale: scale })
  const families = thicknessFamilies(segments.map((s) => s.thickness))
  const dominant = segments.length ? families[0].length / segments.length : 0

  console.log(
    name.padEnd(14) +
      String(round(ink)).padStart(11) +
      String(segments.length).padStart(6) +
      String(round(junctionRatio(segments, 2 * scale))).padStart(7) +
      String(families.length).padStart(6) +
      String(round(dominant)).padStart(10) +
      '  ' +
      [...new Set(segments.map((s) => Math.round(s.thickness)))].sort((a, b) => a - b).join(','),
  )
}
