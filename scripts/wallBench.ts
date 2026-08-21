/**
 * B39 — image → wall network benchmark. DEV ONLY.
 *
 *   npx jiti scripts/wallBench.ts [out-dir]
 *
 * ⚠ SYNTHETIC. Every number this prints is measured against a generated
 * fixture and establishes only that an approach works on generated input.
 * The corpus holds zero usable drawings, so no corpus number exists to
 * compare against, and nothing here may be tuned to these figures
 * (§10 rule 6).
 *
 * Runs each approach over the same three resolutions and prints the wall
 * GRAPH scores, then writes an overlay PNG per approach per resolution.
 */
import { writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import {
  buildPlanFixture,
  FIXTURE_SCALES,
  type FixtureScale,
  type PlanFixture,
} from '../src/test/planFixture'
import {
  detectWallSegments,
  inkMask,
  type PixelSegment,
} from '../src/blueprint/detectWalls'
import { stripAnnotationFromImage } from '../src/blueprint/annotationInk'
import { structuralWalls } from '../src/blueprint/wallStructure'
import { scoreLine, scoreWallGraph } from '../src/blueprint/wallGraphScore'

const OUT = process.argv[2] ?? '.'
const SCALES: FixtureScale[] = ['generous', 'middle', 'critical']

/** The detector as it stands — the baseline every approach must beat. */
const baseline = (fixture: PlanFixture): PixelSegment[] =>
  detectWallSegments(fixture.image, { rasterScale: 1 })

/** B39's addition: the same detection, then the structural filter. */
const structural = (fixture: PlanFixture): PixelSegment[] =>
  structuralWalls(detectWallSegments(fixture.image, { rasterScale: 1 })).walls

/** B39's second addition: annotation ink stripped before detection. */
const stripped = (fixture: PlanFixture): PixelSegment[] => {
  const clean = stripAnnotationFromImage(fixture.image, inkMask)
  return detectWallSegments(clean.image, { rasterScale: 1 })
}

/** Both: strip the annotation ink, detect, then keep the structure. */
const both = (fixture: PlanFixture): PixelSegment[] => {
  const clean = stripAnnotationFromImage(fixture.image, inkMask)
  return structuralWalls(detectWallSegments(clean.image, { rasterScale: 1 })).walls
}

const APPROACHES = [
  { name: 'A0 · existing detector (baseline)', run: baseline },
  { name: 'A1 · + structural component filter', run: structural },
  { name: 'A2 · + annotation-ink strip', run: stripped },
  { name: 'A3 · strip + structural filter', run: both },
]

/** Detected walls drawn over the source image, so the graph can be LOOKED at. */
function overlay(fixture: PlanFixture, segments: PixelSegment[], file: string) {
  const { width, height, data } = fixture.image
  const png = new PNG({ width, height })
  for (let i = 0; i < width * height; i++) {
    // The drawing, faded, so the overlay reads on top of it.
    const grey = 255 - (255 - data[i * 4]) * 0.35
    png.data[i * 4] = grey
    png.data[i * 4 + 1] = grey
    png.data[i * 4 + 2] = grey
    png.data[i * 4 + 3] = 255
  }
  const paint = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const at = (Math.round(y) * width + Math.round(x)) * 4
    png.data[at] = r
    png.data[at + 1] = g
    png.data[at + 2] = b
  }
  // Ground truth in green, underneath; detections in red over it. A red line
  // with no green under it is a false wall; green with no red is a miss.
  for (const wall of fixture.truth) {
    const steps = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      paint(wall.x1 + (wall.x2 - wall.x1) * t, wall.y1 + (wall.y2 - wall.y1) * t, 16, 170, 90)
    }
  }
  for (const s of segments) {
    const steps = Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = s.x1 + (s.x2 - s.x1) * t
      const y = s.y1 + (s.y2 - s.y1) * t
      paint(x, y, 220, 30, 30)
      paint(x + 1, y, 220, 30, 30)
    }
  }
  writeFileSync(file, PNG.sync.write(png))
}

console.log('B39 wall-graph benchmark — SYNTHETIC FIXTURE, not a corpus result\n')

const DEGRADED = process.argv.includes('--degraded')
console.log(
  DEGRADED
    ? 'DEGRADED fixture: box resample + no true black (findings 39, 40)\n'
    : 'CRISP fixture: black on white, no resampling\n',
)

for (const approach of APPROACHES) {
  console.log(approach.name)
  for (const scale of SCALES) {
    const fixture = buildPlanFixture(scale, { degraded: DEGRADED })
    const partitionPx = 0.115 * fixture.pixelsPerMetre
    const started = Date.now()
    const segments = approach.run(fixture)
    const ms = Date.now() - started
    const score = scoreWallGraph(segments, fixture.truth, fixture.annotation)
    console.log(
      `  ${scale.padEnd(9)} ${String(FIXTURE_SCALES[scale]).padStart(3)} px/m  ` +
        `(partition ${partitionPx.toFixed(1)} px, ${fixture.image.width}x${fixture.image.height})  ` +
        `${scoreLine(score)}  ${ms} ms`,
    )
    const missed = score.perWall.filter((w) => w.hits === 0).map((w) => w.id)
    if (missed.length > 0) console.log(`${''.padEnd(13)}missed: ${missed.join(', ')}`)
    overlay(fixture, segments, `${OUT}/b39-${approach.name.slice(0, 2)}-${scale}.png`)
  }
  console.log('')
}
