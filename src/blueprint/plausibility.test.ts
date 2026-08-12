import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  gateAfterDetection,
  gateBeforeDetection,
  gateRasterSize,
  gateResolution,
  gateScaleProvenance,
  gateThicknessDistribution,
  gateThicknessMinimum,
  maskIsCredible,
  rankCandidates,
  thicknessFamilies,
  MAX_INK_FRACTION,
  MIN_JUNCTION_RATIO,
  type GateName,
  type GateResult,
  type GateStatus,
} from './plausibility'

/**
 * B5b — the detector plausibility gates.
 *
 * ── The rule every test here follows ──
 * Assert WHICH gate fired and which did not. Never "detection failed". A test
 * that only checks `blocking !== null` passes when the wrong gate fires, and
 * this project has now found nine tests that were green while proving nothing.
 *
 * ── And the rule about fixtures ──
 * A fixture SYMMETRIC in the property under test cannot test it (SD25 — the
 * perpendicular-foot lesson, where a rectilinear plan could not tell an axis
 * extension from a perpendicular one). Each test below names what its fixture
 * is asymmetric in.
 */

/** Every gate's verdict by name, so a test can assert the whole picture. */
const statuses = (results: GateResult[]): Record<string, GateStatus> =>
  Object.fromEntries(results.map((r) => [r.gate, r.status]))

const fired = (results: GateResult[]): GateName[] =>
  results.filter((r) => r.status === 'fail').map((r) => r.gate)

/* ─── the real plan ──────────────────────────────────────────────────── */

const REAL = JSON.parse(
  readFileSync('samples/real-plan-cv-untitled.json', 'utf8'),
) as {
  walls: { thickness: number }[]
  blueprint: {
    width: number
    height: number
    metresPerPixel: number
    calibration: { source: string; lockedByUser: boolean }
  }
}

describe('★ B5b — the real plan, gate by gate', () => {
  /**
   * ★ THE TEST THAT MATTERS MOST.
   *
   * `raster.ts` upscales anything under 1400 px, so this 400 px image is read
   * at ×3.5. Measured against the RASTER it is 126.9 px/m — better than the
   * 100 px/m the detector's defaults were tuned at, and it would sail through.
   * Measured against the SOURCE it is 36.3 px/m and is refused.
   *
   * Asymmetric in: source-vs-raster resolution. A fixture that was never
   * upscaled could not tell the two measures apart, and this gate would look
   * correct while being defeated by the upscale on every small image.
   */
  it('★ is judged at 36.3 SOURCE px/m, not 126.9 raster px/m', () => {
    const source = 1 / REAL.blueprint.metresPerPixel
    const raster = 1 / (REAL.blueprint.metresPerPixel / 3.5)

    expect(source).toBeCloseTo(36.3, 1)
    expect(raster).toBeCloseTo(126.9, 1)

    const verdict = gateResolution(REAL.blueprint.metresPerPixel)
    expect(verdict.status).toBe('fail')
    expect(verdict.measured.sourcePxPerMetre).toBeCloseTo(36.3, 1)

    // …and the raster measure would have PASSED. This is the assertion that
    // stops someone "simplifying" the gate to take the raster it already has.
    expect(gateResolution(REAL.blueprint.metresPerPixel / 3.5).status).toBe('pass')
  })

  it('★ names every gate that fires and every gate that does not', () => {
    const before = gateBeforeDetection({
      sourceWidth: REAL.blueprint.width,
      sourceHeight: REAL.blueprint.height,
      sourceMetresPerPixel: REAL.blueprint.metresPerPixel,
      calibrationSource: 'ai',
      lockedByUser: REAL.blueprint.calibration.lockedByUser,
    })

    // 400 px, and an estimated scale. Resolution is NOT evaluated — its
    // divisor is the scale, so on an estimate the verdict would be an estimate.
    expect(statuses(before.results)).toEqual({
      'raster-size': 'fail',
      'scale-provenance': 'fail',
    })
    expect(before.blocking?.gate).toBe('raster-size')

    const thicknesses = REAL.walls.map((w) => w.thickness)
    const after = gateAfterDetection(thicknesses, REAL.blueprint.metresPerPixel)

    expect(statuses(after.results)).toEqual({
      'thickness-minimum': 'fail',
      'thickness-distribution': 'fail',
    })
    expect(fired(after.results)).toEqual([
      'thickness-minimum',
      'thickness-distribution',
    ])
  })

  it('reports the measurements it judged on, not just a verdict', () => {
    const thicknesses = REAL.walls.map((w) => w.thickness)
    const min = gateThicknessMinimum(thicknesses)
    const dist = gateThicknessDistribution(thicknesses, REAL.blueprint.metresPerPixel)

    // SIXTEEN under the 75 mm gate, not the nineteen under 90 mm the diagnosis
    // quoted — two different thresholds, and copying the wrong one across is
    // how a test ends up asserting a number nothing computes.
    expect(min.measured).toMatchObject({ walls: 30, belowMinimum: 16, thinnestMm: 24 })
    // SIX families, from ten distinct float values: the clustering splits on a
    // RELATIVE gap, so 157.6/165.5 and 189.1/197.0 are each one wall type read
    // twice. Ten is the raw count of distinct floats and six is the number of
    // wall TYPES — the gate judges the second, and both statements are true.
    expect(dist.measured).toMatchObject({ walls: 30, families: 6 })
    // The median wall was measured across TWO pixels of the original image.
    // (I quoted 3.14 in the diagnosis — that is the value at index 16 of the
    // sorted 30, not the median at index 15. Ten walls sit at 0.857 px and
    // five at 1.143, so the middle of this distribution is far below three.)
    expect(dist.measured.medianSourcePx).toBeCloseTo(2, 6)
  })
})

/* ─── the control ────────────────────────────────────────────────────── */

describe('★ B5b — a sound plan passes all four', () => {
  /**
   * Asymmetric in: nothing. It is the control, and its job is to fail if the
   * gates reject something they should not — which is the failure mode a suite
   * made only of bad fixtures cannot see.
   */
  it('★ 2400 px, measured scale, 230/115 mm walls', () => {
    const mpp = 1 / 200 // 200 source px/m
    const before = gateBeforeDetection({
      sourceWidth: 2400,
      sourceHeight: 1800,
      sourceMetresPerPixel: mpp,
      calibrationSource: 'manual',
      lockedByUser: true,
    })
    expect(statuses(before.results)).toEqual({
      'raster-size': 'pass',
      'scale-provenance': 'pass',
      resolution: 'pass',
    })
    expect(before.blocking).toBeNull()
    expect(before.warnings).toEqual([])

    const walls = [
      0.23, 0.23, 0.23, 0.23, 0.232, 0.228,
      0.115, 0.115, 0.115, 0.117, 0.113, 0.115,
    ]
    const after = gateAfterDetection(walls, mpp)
    expect(statuses(after.results)).toEqual({
      'thickness-minimum': 'pass',
      'thickness-distribution': 'pass',
    })
    expect(after.blocking).toBeNull()
  })
})

/* ─── thresholds, probed either side ─────────────────────────────────── */

describe('★ B5b — every threshold, both sides', () => {
  /** Asymmetric in: resolution only. Same walls, same scale source. */
  it('resolution: 39 refuses, 41 warns, 79 warns, 81 passes', () => {
    expect(gateResolution(1 / 39).status).toBe('fail')
    expect(gateResolution(1 / 41).status).toBe('warn')
    expect(gateResolution(1 / 79).status).toBe('warn')
    expect(gateResolution(1 / 81).status).toBe('pass')
  })

  /** Asymmetric in: raw size only. No scale involved at all. */
  it('raster size: 599 refuses, 601 passes', () => {
    expect(gateRasterSize(599, 400).status).toBe('fail')
    expect(gateRasterSize(601, 400).status).toBe('pass')
    // Longest edge, not width — a portrait sheet is judged the same way.
    expect(gateRasterSize(400, 601).status).toBe('pass')
  })

  /**
   * Asymmetric in: PROVENANCE only. Identical geometry either side.
   *
   * A fixture with a good scale AND good resolution cannot test this gate —
   * everything passes and the assertion is vacuous.
   */
  it('scale provenance: measured sources pass, estimates refuse', () => {
    for (const source of ['manual', 'dxf-units', 'vector', 'ocr'] as const) {
      expect(gateScaleProvenance(source, false).status).toBe('pass')
    }
    for (const source of ['ai', 'heuristic', 'none'] as const) {
      expect(gateScaleProvenance(source, false).status).toBe('fail')
    }
    // `lockedByUser` does not launder an estimate into a measurement.
    expect(gateScaleProvenance('ai', true).status).toBe('fail')
  })

  /** Asymmetric in: thickness only. */
  it('thickness minimum: 74 mm refuses, 76 mm warns, 101 mm passes', () => {
    expect(gateThicknessMinimum([0.074]).status).toBe('fail')
    expect(gateThicknessMinimum([0.076]).status).toBe('warn')
    expect(gateThicknessMinimum([0.101]).status).toBe('pass')
  })
})

/* ─── 3A and 3B are not the same check ───────────────────────────────── */

describe('★ B5b — 3A and 3B are independent, in both directions', () => {
  const mpp = 1 / 200

  /**
   * ★ Asymmetric in: ONE element. Twenty-nine sound walls and one artefact.
   *
   * If 3A and 3B were the same check this would fire both. It must fire only
   * 3A — the distribution is two clean families and one outlier.
   */
  it('★ one 20 mm wall among 29 good ones: 3A fires, 3B passes', () => {
    const walls = [...Array(29).fill(0.23), 0.02]

    expect(gateThicknessMinimum(walls).status).toBe('fail')
    expect(gateThicknessDistribution(walls, mpp).status).toBe('pass')
  })

  /**
   * ★ Asymmetric in: DISTRIBUTION only. Every wall is individually plausible
   * and none is under 75 mm — so 3A has nothing to say, and only a
   * population-level check can see that this is noise rather than families.
   */
  it('★ six distinct wall types, every one over 75 mm: 3B fires, 3A passes', () => {
    // 110, 150, 200, 260, 340, 450 mm — each individually buildable and none
    // even marginal, so 3A has
    // nothing to say. Six wall types in one plan is not a building; it is a
    // detector reading several pen weights.
    //
    // The first draft of this test used 180/185/190/195/200/205 mm and it
    // PASSED, correctly: at a 20% relative gap those are ONE family — six
    // readings of one 190 mm wall type with ±7% error, which is what a real
    // measurement looks like. My premise was wrong, not the gate.
    const walls = [0.11, 0.15, 0.2, 0.26, 0.34, 0.45]

    expect(gateThicknessMinimum(walls).status).toBe('pass')
    const dist = gateThicknessDistribution(walls, mpp)
    expect(dist.status).toBe('fail')
    expect(dist.measured.families).toBe(6)
  })

  it('families split on a RELATIVE gap, so 230 and 240 are one wall type', () => {
    expect(thicknessFamilies([0.23, 0.24, 0.115]).map((f) => f.length)).toEqual([2, 1])
    // …and 115 vs 230 are two, at any absolute scale.
    expect(thicknessFamilies([0.115, 0.23]).length).toBe(2)
  })

  it('a sub-pixel median fails whatever the distribution looks like', () => {
    // Two tidy families, dominant share 50% — 3B's shape signals are content.
    // The measurement itself is the problem: 0.86 source px per wall.
    const mppTiny = 0.0276
    const walls = [0.0236, 0.0236, 0.0315, 0.0315]
    const dist = gateThicknessDistribution(walls, mppTiny)
    expect(dist.status).toBe('fail')
    expect(dist.measured.medianSourcePx).toBeLessThan(3)
  })
})

/* ─── Gate 4 ─────────────────────────────────────────────────────────── */

describe('★ B5b — the scorer sanity gate, against ADR 0002s measured case', () => {
  const real = {
    inkFraction: 0.06,
    junctionRatio: 0.86,
    thicknessesPx: Array(7).fill(16),
    totalLengthPx: 6300,
  }
  /** ADR 0002: the paper selected as ink, sliced by the grid into strips. */
  const degenerate = {
    inkFraction: 0.91,
    junctionRatio: 0.04,
    thicknessesPx: Array(75).fill(4),
    totalLengthPx: 77592,
  }

  /**
   * ★ Asymmetric in: credibility, NOT in length. The fake reading is 12×
   * longer, which is exactly why the existing score preferred it — a fixture
   * where the real reading were also the longest would pass on the old scorer
   * and prove nothing.
   */
  it('★ rejects the 77,592 px reading and keeps the 6,300 px one', () => {
    expect(maskIsCredible(degenerate)).toBe(false)
    expect(maskIsCredible(real)).toBe(true)

    const ranked = rankCandidates([degenerate, real])
    expect(ranked).toEqual([real])
  })

  it('ink fraction alone rejects it — 91% against a 35% ceiling', () => {
    expect(maskIsCredible({ ...degenerate, junctionRatio: 0.9 })).toBe(false)
    expect(MAX_INK_FRACTION).toBeLessThan(0.91)
  })

  it('junction ratio alone rejects it — strips do not meet each other', () => {
    // Ink fraction made innocent, so only the network signal is left.
    expect(maskIsCredible({ ...degenerate, inkFraction: 0.05 })).toBe(false)
    expect(MIN_JUNCTION_RATIO).toBeGreaterThan(0.04)
  })

  it('mean segment length would NOT have separated them', () => {
    // 77592/75 = 1035 px against 6300/7 = 900. The fakes were LONGER. This is
    // recorded as a test because it is the reason the gate is a junction
    // ratio and not the more obvious count-or-length signal.
    expect(degenerate.totalLengthPx / degenerate.thicknessesPx.length).toBeGreaterThan(
      real.totalLengthPx / real.thicknessesPx.length,
    )
  })

  it('a plan of three walls is not judged on its network', () => {
    // "A plan of one lone wall is still a plan" — the junction rule needs
    // enough segments for a network to be a meaningful claim.
    expect(
      maskIsCredible({
        inkFraction: 0.05,
        junctionRatio: 0,
        thicknessesPx: [12, 12, 12],
        totalLengthPx: 900,
      }),
    ).toBe(true)
  })

  it('the length score still ranks among credible candidates', () => {
    const shorter = { ...real, totalLengthPx: 3000 }
    const longer = { ...real, totalLengthPx: 9000 }
    // §3: the gate decides who enters the comparison, the existing score still
    // decides who wins it.
    expect(rankCandidates([shorter, longer])).toEqual([longer, shorter])
  })
})
