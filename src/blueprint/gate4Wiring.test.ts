import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectWallSegments, type RasterLike } from './detectWalls'

/**
 * B5c — Gate 4 is reachable from the detector.
 *
 * `maskIsCredible` and `rankCandidates` shipped in B5b with tests against ADR
 * 0002's measured case, and for one session **no production code imported
 * them**. The ink-fraction ceiling and the junction ratio protected nothing.
 *
 * ── Why this file does BOTH a grep and a behaviour check ──
 * SD14: a grep proves a call site exists in the text, not that the call
 * resolves. Last time exactly that happened — `planSheet.ts` had the
 * `doorSwing(` call and not the import, the fitness test went green, and
 * `tsc` was what caught it. So the grep below is the cheap half, and the
 * behaviour below it is the half that cannot be satisfied by a comment
 * mentioning the module.
 *
 * ── Division of labour with `plausibility.test.ts` ──
 * That file asserts the RULE head-to-head: `rankCandidates([degenerate, real])`
 * returns only the real one, though the degenerate is 12x longer. This file
 * asserts the WIRING: that `detectWallSegments` consults it at all.
 */

const SRC = join(process.cwd(), 'src')

/* ─── synthetic rasters ──────────────────────────────────────────────── */

/** A white RGBA sheet, ready to have dark bands painted into it. */
function sheet(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const paint = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * width + x) * 4
        data[o] = 0
        data[o + 1] = 0
        data[o + 2] = 0
      }
    }
  }
  return { image: { data, width, height } as RasterLike, paint }
}

const W = 2000
const H = 900
const THICK = 10

/**
 * Eight long parallel bands and nothing crossing them — ADR 0002's failure
 * shape, which was a grid slicing a white field into strips.
 *
 * Every band individually passes every existing filter: 1800 px long against a
 * 40 px minimum, 10 px thick inside the 3–120 band, aspect 180 against a
 * minimum of 6, fill 1.0. Ink is 8% of the sheet, comfortably under the 35%
 * ceiling — so the ONLY thing that can reject this reading is that the bands
 * never meet each other.
 */
function parallelStrips(): RasterLike {
  const { image, paint } = sheet(W, H)
  for (let i = 0; i < 8; i++) {
    const y = 60 + i * 100
    paint(100, y, 1900, y + THICK)
  }
  return image
}

/** The control: a closed rectangle, whose four walls all meet each other. */
function rectangle(): RasterLike {
  const { image, paint } = sheet(W, H)
  paint(100, 100, 1900, 100 + THICK) // top
  paint(100, 800, 1900, 800 + THICK) // bottom
  paint(100, 100, 100 + THICK, 810) // left
  paint(1890, 100, 1900, 810) // right
  return image
}

/** Total detected wall length, the ranking `scoreSegments` applies. */
const totalLength = (segments: { x1: number; y1: number; x2: number; y2: number }[]) =>
  segments.reduce((sum, s) => sum + Math.hypot(s.x2 - s.x1, s.y2 - s.y1), 0)

describe('★ B5c — Gate 4 is wired, not merely written', () => {
  /**
   * The cheap half. Fails if `detectWalls.ts` stops consulting the module at
   * all — a whole-file rewrite, or someone "simplifying" the candidate loop
   * back to a bare `score > bestScore`.
   *
   * Modelled on `calibration.test.ts`'s single-writer check, and NOT trusted
   * on its own: see the header.
   */
  it('detectWalls.ts imports the plausibility module', () => {
    const source = readFileSync(join(SRC, 'blueprint/detectWalls.ts'), 'utf8')
    expect(source).toMatch(/from '\.\/plausibility'/)
    expect(source).toContain('rankCandidates(')
  })

  /**
   * ★ The half a grep cannot fake.
   *
   * Eight parallel bands, no junctions. Before the wiring this returned all
   * eight: `requireJunction` filters non-junctioning bands, but its own escape
   * — "a plan of one lone wall is still a plan" — fires when NOTHING junctions
   * and hands every band back. That escape is exactly the door ADR 0002's
   * degenerate mask walked through.
   *
   * Demonstrated red by reverting the candidate loop to a bare total-length
   * sort:
   *
   *   expected [ { x1: 100, y1: 115, …(3) }, …(3) ] to have a length of +0
   *   but got 4
   *
   * Measured either side, and the numbers are the point:
   *
   *   unwired   strips 4 segments, 7,200 px, thickness 110 each
   *             rect   4 segments, 4,980 px, thickness 10 each
   *   wired     strips 0 segments
   *             rect   4 segments, 4,980 px  (unchanged)
   *
   * **The wrong reading is 1.45x longer**, so total length alone prefers it —
   * exactly what ADR 0002 measured, at a smaller ratio and on a fixture that
   * can be regenerated.
   *
   * FOUR segments, not eight: `mergeWallFaces` fused each 100 px-apart pair
   * into one 110 px band, because the pair sits inside `maxThicknessPx`. That
   * is the SD4(b) failure mode — fusing two things that are not two faces of
   * one wall — and it is why the reading looked plausible enough to win.
   */
  it('★ refuses a reading of parallel strips that never meet', () => {
    const segments = detectWallSegments(parallelStrips())
    expect(segments).toHaveLength(0)
  })

  /**
   * ★ The control, and it is what stops the test above passing for the wrong
   * reason. A gate that rejected everything would satisfy the assertion above
   * and destroy the product.
   *
   * Asymmetric in: junction structure ALONE. Same sheet size, same band
   * thickness, same ink colour, comparable ink fraction — the only difference
   * is that these four bands meet at corners and those eight did not.
   */
  it('★ still accepts a rectangle, whose walls do meet', () => {
    const segments = detectWallSegments(rectangle())

    expect(segments).toHaveLength(4)
    // And it is the SHORTER reading: 4,980 px against the rejected 7,200.
    // Asserting the number keeps the point visible — the gate preferred the
    // shorter, connected reading over the longer, disconnected one, which is
    // the whole behaviour change.
    expect(totalLength(segments)).toBeCloseTo(4980, 0)
    // Thin bands, not the 110 px the fused strips produced. A rectangle whose
    // walls came back 110 px thick would mean `mergeWallFaces` had fused
    // opposite walls, and the length assertion alone would not notice.
    expect(segments.every((s) => s.thickness === 10)).toBe(true)
  })

  it('rejecting every candidate yields nothing, not the least-bad one', () => {
    // A blank sheet has no credible reading and no incredible one either.
    // Included so the empty result above is not read as "errors return []".
    const { image } = sheet(400, 400)
    expect(detectWallSegments(image)).toEqual([])
  })
})
