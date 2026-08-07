import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import type { Wall } from '../store/useDesignStore'
import {
  detectWallSegments,
  segmentsToWalls,
  type RasterLike,
} from './detectWalls'

/**
 * Golden-file harness for the deterministic wall detector.
 *
 * ── What `blueprint-expected.json` can and cannot be compared against ─────
 * `samples/README.md` says "Import any of the above, export the result, diff
 * against this." A whole-document diff would fail on every fixture, for two
 * reasons that are both correct behaviour:
 *
 *   1. The golden file lists ELEVEN OPENINGS. `detectWallSegments` deliberately
 *      does not detect openings — a door reads as a gap that `mergeCollinear`
 *      heals back into one wall, and openings come from the vision model
 *      instead. Diffing them would test the LLM, not the detector.
 *   2. The golden file is `version: 1`, which now migrates to v2 and gains a
 *      `blueprint` field the fixture cannot know about.
 *
 * So the comparison is on WALL GEOMETRY only, and by centreline within a
 * tolerance rather than by equality: the detector reports the median centre of
 * an ink band, which lands within a pixel or so of where a vector renderer put
 * the stroke, and demanding exactness would be asserting a rounding mode.
 *
 * ── What this harness proves, and what it does not ───────────────────────
 * It proves the detector still finds the plan it found yesterday, and it
 * catches a regression in the four-way binarisation or the band pipeline.
 *
 * It does NOT prove the detector works on real drawings. Every fixture here is
 * produced by `samples/gen-blueprint.mjs`, whose `colour`, `noisy` and `thin`
 * cases were written in the same change set as the `paperContrastMasks`,
 * `scoreSegments` and `MIN_RASTER_DIMENSION` code they exercise. Testing a
 * detector against drawings authored to suit it is circular. See
 * `docs/testing/corpus.md` for the real-drawing corpus that has to replace it.
 */

const SAMPLES = join(process.cwd(), 'samples')

/**
 * The plan every fixture depicts, from `samples/README.md`:
 * outer shell 12.00 m x 9.00 m at 100 px = 1 m, plan origin at pixel (200,150).
 */
const PX_PER_METRE = 100
const PLAN_ORIGIN_PX = { x: 200, y: 150 }
const TRANSFORM = {
  metresPerPixel: 1 / PX_PER_METRE,
  origin: { x: -PLAN_ORIGIN_PX.x / PX_PER_METRE, z: -PLAN_ORIGIN_PX.y / PX_PER_METRE },
}

/**
 * Centreline tolerance, in metres. Two pixels at 100 px/m.
 *
 * The detector takes the median centre of an ink band; a renderer strokes a
 * 16 px wall centred on the same line but antialiases its edges, and the Otsu
 * threshold decides where the ink stops. A pixel or two of disagreement is the
 * method working, not failing.
 */
const TOLERANCE_M = 0.02

/** Thickness tolerance, in metres. Wider: thickness is a median over slices. */
const THICKNESS_TOLERANCE_M = 0.04

/**
 * Decodes a PNG straight into the shape the detector accepts.
 *
 * `detectWallSegments` takes `RasterLike`, not `ImageData`, precisely so it can
 * run outside a browser — the comment at its declaration says so. This is the
 * seam being used for the first time.
 */
function readPng(name: string): RasterLike {
  const png = PNG.sync.read(readFileSync(join(SAMPLES, name)))
  return {
    data: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height,
  }
}

type Expected = { walls: Wall[] }
const expected: Expected = JSON.parse(
  readFileSync(join(SAMPLES, 'blueprint-expected.json'), 'utf8'),
)

type Segment = { start: { x: number; z: number }; end: { x: number; z: number }; thickness: number }

/** A wall as a comparable axis-aligned span, orientation-independent. */
function normalise(wall: { start: { x: number; z: number }; end: { x: number; z: number } }) {
  const horizontal = Math.abs(wall.end.z - wall.start.z) < Math.abs(wall.end.x - wall.start.x)
  return horizontal
    ? {
        axis: 'h' as const,
        at: (wall.start.z + wall.end.z) / 2,
        from: Math.min(wall.start.x, wall.end.x),
        to: Math.max(wall.start.x, wall.end.x),
      }
    : {
        axis: 'v' as const,
        at: (wall.start.x + wall.end.x) / 2,
        from: Math.min(wall.start.z, wall.end.z),
        to: Math.max(wall.start.z, wall.end.z),
      }
}

/**
 * The detected wall matching an expected one: same axis, same offset, and
 * overlapping along its length.
 *
 * Length is compared by overlap rather than by endpoints because
 * `snapJunctions` pulls an end onto a crossing wall's centreline, so a detected
 * wall legitimately stops half a thickness short of where the drawing painted
 * it.
 */
function findMatch(detected: Segment[], want: Wall): Segment | undefined {
  const target = normalise(want)
  return detected.find((candidate) => {
    const got = normalise(candidate)
    if (got.axis !== target.axis) return false
    if (Math.abs(got.at - target.at) > TOLERANCE_M) return false
    const overlap = Math.min(got.to, target.to) - Math.max(got.from, target.from)
    return overlap > (target.to - target.from) * 0.6
  })
}

/**
 * Every fixture depicts the SAME plan, so `blueprint-expected.json` is ground
 * truth for all of them — a difference in what imports is a difference in how
 * the drawing was presented, not in what it shows.
 *
 * PNG only: the SVG fixtures need a rasteriser this harness deliberately does
 * not have, since adding a headless browser to the unit suite would make it
 * slow and flaky for no extra coverage of the detector itself.
 */
const FIXTURES = [
  { file: 'blueprint-simple.png', style: 'black on white, no noise' },
  { file: 'blueprint-detailed.png', style: 'grid, dimensions, title block, scale bar' },
  { file: 'blueprint-dark.png', style: 'white on blue — inverted polarity' },
] as const

describe('golden: the detector finds the plan every fixture depicts', () => {
  for (const { file, style } of FIXTURES) {
    describe(`${file} — ${style}`, () => {
      const detected = segmentsToWalls(detectWallSegments(readPng(file)), TRANSFORM)

      it('finds every wall in the ground truth', () => {
        const missing = expected.walls
          .filter((wall) => !findMatch(detected, wall))
          .map((wall) => wall.id)

        expect(
          missing,
          `Detected ${detected.length} walls; these ground-truth walls have no match.`,
        ).toEqual([])
      })

      it('gets each wall thickness right to within a pixel or two', () => {
        const wrong = expected.walls
          .map((wall) => ({ wall, match: findMatch(detected, wall) }))
          .filter(({ wall, match }) =>
            match ? Math.abs(match.thickness - wall.thickness) > THICKNESS_TOLERANCE_M : false,
          )
          .map(({ wall, match }) => `${wall.id}: want ${wall.thickness}, got ${match?.thickness}`)

        expect(wrong).toEqual([])
      })

      it('does not invent walls out of the annotation', () => {
        // The detailed fixture carries a grid, dimension lines, a title block,
        // a scale bar and a north arrow. `requireJunction` and the aspect and
        // thickness filters exist to reject all of it. A handful of extra
        // segments is tolerable — every wall is one band and a healed door can
        // split one — but twice the ground truth means the filters have failed.
        expect(detected.length).toBeLessThanOrEqual(expected.walls.length * 2)
      })
    })
  }

  it('reads the same geometry from every presentation of the plan', () => {
    // The point of having three renderings: polarity, annotation and colour are
    // presentation, and none of them should change what imports.
    const perFixture = FIXTURES.map(({ file }) => {
      const detected = segmentsToWalls(detectWallSegments(readPng(file)), TRANSFORM)
      return expected.walls.filter((wall) => findMatch(detected, wall)).length
    })

    expect(new Set(perFixture).size, `Per-fixture wall counts: ${perFixture.join(', ')}`).toBe(1)
  })
})

describe('golden: openings are deliberately NOT detected', () => {
  it('heals door gaps rather than reporting them', () => {
    // `int-corridor` is a single 12 m wall carrying two doors. A detector that
    // reported openings would return it as three fragments; `mergeCollinear`
    // bridges gaps up to 12x the wall thickness so it comes back as one.
    const detected = segmentsToWalls(
      detectWallSegments(readPng('blueprint-simple.png')),
      TRANSFORM,
    )
    const corridor = expected.walls.find((w) => w.id === 'int-corridor')!
    const match = findMatch(detected, corridor)

    expect(match).toBeDefined()
    const got = normalise(match!)
    const want = normalise(corridor)
    // Within a door's width of the full span, not a third of it.
    expect(got.to - got.from).toBeGreaterThan((want.to - want.from) * 0.9)
  })
})
