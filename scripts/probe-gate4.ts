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
import { detectWallSegments, inkMask } from '../src/blueprint/detectWalls'
import { thicknessFamilies } from '../src/blueprint/plausibility'
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

for (const file of files) {
  const png = PNG.sync.read(readFileSync(file))
  const name = file.split(/[\\/]/).pop()!.replace('.png', '')
  const { image, scale } = headlessRaster({
    data: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height,
  })

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
