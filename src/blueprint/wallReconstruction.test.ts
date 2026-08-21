import { describe, expect, it } from 'vitest'
import { detectWallSegments, inkMask, type PixelSegment } from './detectWalls'
import {
  stripAnnotationFromImage,
  strokeProfile,
  strokeWidthMap,
} from './annotationInk'
import { structuralWalls } from './wallStructure'
import { scoreWallGraph } from './wallGraphScore'
import { buildPlanFixture, FIXTURE_SCALES } from '../test/planFixture'

/**
 * B39 — image → wall network. Prototype measurements.
 *
 * ⚠ **EVERY NUMBER HERE IS SYNTHETIC.** The fixture is generated, so these
 * establish how an approach behaves on generated input and NOTHING about
 * real drawings (§10 rule 6; ADR 0002 conceded this circularity once
 * already). The corpus holds zero usable drawings, so there is no real
 * number to compare against. That is the state of the evidence.
 *
 * ── The correction that produced these numbers ──
 * The first draft of the fixture drew a 12 px wall as 13 px, because its
 * fill was inclusive at both ends while the ground truth recorded the
 * nominal value. Against that fixture the detector appeared to fail
 * catastrophically at high resolution and succeed at low — an "inversion"
 * that was about to be written up as a finding. It was an off-by-one in the
 * FIXTURE. Recorded here because the near-miss is the lesson: a fixture
 * whose pixels disagree with its ground truth manufactures findings.
 */

const detect = (image: Parameters<typeof detectWallSegments>[0]): PixelSegment[] =>
  detectWallSegments(image, { rasterScale: 1 })

const SCALES = ['generous', 'middle', 'critical'] as const

/* ─── the baseline, pinned ──────────────────────────────────────────────── */

describe('B39 — the existing detector on a clean synthetic plan', () => {
  /**
   * The measured baseline every future approach must beat. Pinned so a
   * change to `detectWalls.ts` that costs recall on a clean plan cannot land
   * silently — the golden suite pins its OUTPUT on three fixtures, and this
   * pins its ACCURACY against ground truth, which is a different claim.
   *
   * ⚠ It says nothing about real drawings. On the corpus the same detector
   * reads nothing usable from 13 files, and this fixture does not model why:
   * outlined walls, hatching, text touching walls, multi-panel sheets and
   * skew are all absent from it. See STATE.md finding 59.
   */
  it('finds all 7 walls, with no spurious detections, at every resolution', () => {
    for (const scale of SCALES) {
      const fixture = buildPlanFixture(scale)
      const score = scoreWallGraph(
        detect(fixture.image),
        fixture.truth,
        fixture.annotation,
      )
      expect(score.matched, `${scale}: matched`).toBe(7)
      expect(score.spurious, `${scale}: spurious`).toBe(0)
      // Neither face of a wall reported as its own wall.
      expect(score.doubled, `${scale}: doubled`).toBe(0)
      expect(score.thicknessOk, `${scale}: thickness`).toBe(7)
    }
  })

  it('still finds all 7 when the drawing is resampled and has no true black', () => {
    // Findings 39 and 40's measured degradation. The detector survives it on
    // this fixture, which is why the fixture is NOT a model of the corpus
    // failures — something else is doing the damage there.
    for (const scale of SCALES) {
      const fixture = buildPlanFixture(scale, { degraded: true })
      const score = scoreWallGraph(
        detect(fixture.image),
        fixture.truth,
        fixture.annotation,
      )
      expect(score.matched, `${scale}: matched`).toBe(7)
      expect(score.spurious, `${scale}: spurious`).toBe(0)
    }
  })
})

/* ─── ★ 1 — the annotation/structure split is derived, not picked ───────── */

describe('★ B39 — stroke-width families are read off the image', () => {
  /**
   * ★ The fixture draws annotation at 1–2 px, partitions at 3–12 px and
   * shell at 6–24 px depending on scale. The profile must recover those
   * three families and put its floor exactly on the partition width — at
   * EVERY scale, from the distribution alone, with no number supplied.
   *
   * Demonstrated red by replacing the widest-ratio-gap rule with a fixed
   * `floor = 3`: at `generous` the assertion reported `expected 3 to be 12`.
   * A fixed pixel threshold cannot separate the same drawing rendered at two
   * sizes, which is precisely why the rule is a RATIO between families.
   *
   * Cannot pass vacuously: the expected floor is computed from the fixture's
   * own metres-to-pixels, not read back from the profile.
   */
  it('★ puts the floor on the partition width at every resolution', () => {
    for (const scale of SCALES) {
      const fixture = buildPlanFixture(scale)
      const profile = strokeProfile(
        strokeWidthMap(inkMask(fixture.image), fixture.image.width, fixture.image.height),
      )
      const partitionPx = Math.round(0.115 * FIXTURE_SCALES[scale])

      expect(profile.families.length, `${scale}: families`).toBeGreaterThanOrEqual(3)
      expect(profile.floor, `${scale}: floor`).toBe(partitionPx)
    }
  })

  it('removes the annotation ink and keeps the wall ink', () => {
    const fixture = buildPlanFixture('generous')
    const clean = stripAnnotationFromImage(fixture.image, inkMask)
    expect(clean.removed).toBeGreaterThan(0)

    // The walls survive the strip: still all 7, still nothing spurious.
    const score = scoreWallGraph(detect(clean.image), fixture.truth, fixture.annotation)
    expect(score.matched).toBe(7)
    expect(score.spurious).toBe(0)
  })

  it('passes a drawing through untouched when no family gap exists', () => {
    // One uniform stroke width: no gap, nothing removed — the fail-safe, so
    // a drawing this cannot help is never damaged by it.
    const flat = new Uint8Array(40 * 40)
    for (let y = 10; y < 30; y++) for (let x = 5; x < 35; x++) flat[y * 40 + x] = 1
    expect(strokeProfile(strokeWidthMap(flat, 40, 40)).floor).toBe(0)
  })
})

/* ─── ★ 2 — structure is the connected thing inside the envelope ────────── */

describe('★ B39 — the structural filter keeps the building, drops the rest', () => {
  const wall = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thickness: number,
  ): PixelSegment => ({ x1, y1, x2, y2, thickness })

  const shell = () => [
    wall(100, 100, 900, 100, 24),
    wall(900, 100, 900, 700, 24),
    wall(100, 700, 900, 700, 24),
    wall(100, 100, 100, 700, 24),
  ]

  /**
   * ★ Hand-built input, so the filter is tested on exactly the three cases
   * it exists for: a closed shell, a dimension chain OUTSIDE the envelope,
   * and a furniture outline INSIDE a room touching nothing.
   *
   * Demonstrated red with the filter reduced to a pass-through (`walls:
   * segments`): `expected 6 to be 4`, with the chain and the furniture both
   * surviving into the wall list.
   *
   * Cannot pass vacuously: the first assertion proves the input really did
   * carry all six, so a filter that dropped everything fails too.
   */
  it('★ drops an outside-the-envelope chain and a free-standing box', () => {
    const walls = shell()
    const dimensionChain = wall(100, 30, 900, 30, 2)
    const furniture = wall(300, 400, 500, 400, 2)
    const input = [...walls, dimensionChain, furniture]
    expect(input).toHaveLength(6)

    const report = structuralWalls(input)

    expect(report.walls).toHaveLength(4)
    expect(report.outsideEnvelope).toContain(dimensionChain)
    expect(report.disconnected).toContain(furniture)
    for (const w of walls) expect(report.walls).toContain(w)
  })

  it('keeps a partition meeting a shell wall mid-span (a T-junction)', () => {
    // Shares no endpoint with anything — the commonest architectural join,
    // and the case an endpoint-only connectivity test would drop.
    const partition = wall(500, 100, 500, 700, 12)
    const report = structuralWalls([...shell(), partition])
    expect(report.walls).toHaveLength(5)
    expect(report.walls).toContain(partition)
  })

  it('returns nothing for nothing rather than throwing', () => {
    expect(structuralWalls([]).walls).toEqual([])
  })
})

/* ─── ★ 3 — the negative result, pinned ────────────────────────────────── */

describe('★ B39 — the annotation strip REGRESSES on degraded low-resolution', () => {
  /**
   * ★ THE SESSION'S MOST IMPORTANT RESULT, and it is a negative one.
   *
   * On a resampled drawing with no true black at 26 px/m — the measured real
   * condition — the annotation strip turns a perfect reading into a broken
   * one: 7 of 7 walls become 4 of 7, and the three lost walls are exactly
   * the partitions.
   *
   * The mechanism, isolated in the second assertion: blur widens the 1 px
   * annotation until it merges with the 3 px partition family, so the
   * profile sees `[3, 6]` where the crisp image gives `[1, 3, 6]`. The
   * widest ratio gap is then 6/3, the floor lands on the SHELL thickness,
   * and every partition is stripped as annotation.
   *
   * **This is why the strip is not wired into the app.** A width-based split
   * needs the annotation family to be resolvable, and at 3 px partitions
   * with a resample kernel it is not.
   *
   * It goes red when someone fixes that — which is the intended outcome, and
   * the fix is to derive the floor from the SCALE (B38 knows 115 mm is 3 px)
   * rather than from the width distribution alone. Read this comment before
   * "repairing" the test.
   */
  it('★ turns 7/7 into 4/7 at 26 px/m once the drawing is degraded', () => {
    const fixture = buildPlanFixture('critical', { degraded: true })

    const before = scoreWallGraph(detect(fixture.image), fixture.truth, fixture.annotation)
    expect(before.matched).toBe(7)

    const clean = stripAnnotationFromImage(fixture.image, inkMask)
    const after = scoreWallGraph(detect(clean.image), fixture.truth, fixture.annotation)

    expect(after.matched).toBe(4)
    // And it is the partitions that are lost, not an arbitrary four.
    const missed = after.perWall.filter((w) => w.hits === 0).map((w) => w.id)
    expect(missed.sort()).toEqual(['part-a', 'part-b', 'part-c'])
  })

  it('the mechanism: blur merges the annotation family into the partitions', () => {
    const profileOf = (degraded: boolean) => {
      const fixture = buildPlanFixture('critical', { degraded })
      return strokeProfile(
        strokeWidthMap(inkMask(fixture.image), fixture.image.width, fixture.image.height),
      )
    }

    // Crisp: three families, floor on the 3 px partition.
    expect(profileOf(false).families).toEqual([1, 3, 6])
    expect(profileOf(false).floor).toBe(3)

    // Degraded: the 1 px family is gone, and the floor moves up onto the
    // shell — taking the partitions with it.
    expect(profileOf(true).families).toEqual([3, 6])
    expect(profileOf(true).floor).toBe(6)
  })
})
