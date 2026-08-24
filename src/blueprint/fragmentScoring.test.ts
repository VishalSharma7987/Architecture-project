import { describe, expect, it } from 'vitest'
import { COVERAGE_THRESHOLD, scoreWallCoverage } from './coverageScore'
import { scoreWallGraphLegacy } from './wallGraphScore'
import { detectWallSegments, type PixelSegment } from './detectWalls'
import { buildPlanFixture, type FixtureScale, type TruthWall, type WallRendering } from '../test/planFixture'

/**
 * B44 — scoring a wall that is correctly reported in pieces.
 *
 * ⚠ **This validates the scoring rule against controlled fixtures. It does
 * not establish detector performance on arbitrary real-world floor-plan
 * images.**
 *
 * ── The instrument rule ──
 * This suite changes the instrument that measured the previous four
 * sessions, so the negative cases matter more than the positive one. The
 * rejection criteria were fixed BEFORE implementing and every one of them is
 * a test below: the rule must still be able to say "missed", must not merge
 * parallel or separated walls, must not let a duplicate or an annotation
 * band contribute coverage, and — the one that matters most — must still
 * rank the pre-B43 detector BELOW the post-B43 one. A scorer that erases a
 * real improvement is measuring nothing.
 */

const wall = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness = 24,
): TruthWall => ({
  id,
  x1,
  y1,
  x2,
  y2,
  thickness,
  kind: 'shell',
  renderedAs: 'solid',
  stroke: thickness,
})

const seg = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  thickness = 24,
): PixelSegment => ({ x1, y1, x2, y2, thickness })

/** One 1000 px horizontal wall, so percentages read directly off the numbers. */
const WALL = wall('w', 0, 100, 1000, 100)
const SCALES: FixtureScale[] = ['generous', 'middle', 'critical']

/* ─── ★ the positive case, and the failure it replaces ──────────────────── */

describe('★ B44 — a wall reported in pieces is a wall that was found', () => {
  /**
   * ★ Both splits an opening actually produces. Capable of going red in the
   * permissive direction too: it asserts the coverage figure, not just the
   * verdict, so a rule that accepted these for the wrong reason (say, by
   * counting the same fragment twice) would report the wrong percentage.
   */
  it('★ scores an even 45%+45% and an uneven 34%+53% split as one wall', () => {
    const even = scoreWallCoverage(
      [seg(0, 100, 450, 100), seg(550, 100, 1000, 100)],
      [WALL],
      [],
    )
    expect(even.matched).toBe(1)
    expect(even.spurious).toBe(0)
    expect(even.coverage[0].covered).toBeCloseTo(0.9, 6)

    const uneven = scoreWallCoverage(
      [seg(0, 100, 340, 100), seg(470, 100, 1000, 100)],
      [WALL],
      [],
    )
    expect(uneven.matched).toBe(1)
    expect(uneven.spurious).toBe(0)
    expect(uneven.coverage[0].covered).toBeCloseTo(0.87, 6)
  })

  /**
   * ★ THE ORIGINAL FAILURE, still reproducible on demand.
   *
   * The same fragments under the OLD rule. This is what B40–B43's matrices
   * were computed with, and it is why `scoreWallGraphLegacy` was kept rather
   * than deleted: a benchmark whose old numbers cannot be reproduced is not
   * auditable.
   *
   * The 45%+45% case is the sharpest statement of the defect — ninety per
   * cent of a wall, correctly placed, nothing invented, scored as **zero
   * matched and two spurious**.
   */
  it('★ the OLD rule scored the same 90% of a wall as 0 matched, 2 spurious', () => {
    const fragments = [seg(0, 100, 450, 100), seg(550, 100, 1000, 100)]

    const old = scoreWallGraphLegacy(fragments, [WALL], [])
    expect(old.matched).toBe(0)
    expect(old.spurious).toBe(2)

    // …and the new rule on the identical input.
    expect(scoreWallCoverage(fragments, [WALL], []).matched).toBe(1)
  })
})

/* ─── ★ the negative cases: the rule must still refuse ──────────────────── */

describe('★ B44 — what the rule must NOT accept', () => {
  /**
   * ★ R1 — the rule can still say "missed". Without this the scorer is
   * unfalsifiable: every wall with any ink near it would pass.
   *
   * Demonstrated red by setting `coverageThreshold` to 0.3: `expected 1 to
   * be +0`, the 40% wall scoring as found. That is the exact permissiveness
   * this threshold exists to prevent.
   */
  it('★ R1 — 20% + 20% is 40% collective and the wall is MISSED', () => {
    const score = scoreWallCoverage(
      [seg(0, 100, 200, 100), seg(800, 100, 1000, 100)],
      [WALL],
      [],
    )
    expect(score.matched).toBe(0)
    expect(score.coverage[0].covered).toBeCloseTo(0.4, 6)
  })

  /**
   * ★ R3 — two neighbouring parallel walls each keep their own coverage and
   * neither exceeds 100%. If a fragment could contribute to both, the
   * coverage figures would exceed 1 or the pair would collapse to one.
   */
  it('★ R3 — parallel neighbours are scored separately, never merged', () => {
    const a = wall('a', 0, 100, 1000, 100)
    const b = wall('b', 0, 140, 1000, 140)
    const score = scoreWallCoverage(
      [seg(0, 100, 1000, 100), seg(0, 140, 1000, 140)],
      [a, b],
      [],
    )
    expect(score.matched).toBe(2)
    for (const c of score.coverage) expect(c.covered).toBeLessThanOrEqual(1)
  })

  /**
   * ★ R4 — one over-long detection spanning two collinear walls separated by
   * a real gap covers ONE of them, not both. This is the case a
   * group-the-detections-first rule would have had to defend with a gap
   * tolerance; assigning each detection to a single wall makes it structural.
   */
  it('★ R4 — collinear walls with a gap are not both covered by one detection', () => {
    const c = wall('c', 0, 100, 400, 100)
    const d = wall('d', 600, 100, 1000, 100)
    const score = scoreWallCoverage([seg(0, 100, 1000, 100)], [c, d], [])
    expect(score.matched).toBe(1)
    // Exactly one of them got the detection; the other has no coverage.
    expect(score.coverage.filter((x) => x.covered === 0)).toHaveLength(1)
  })

  /**
   * ★ R5 — a duplicate adds nothing. Coverage is the UNION of intervals, so
   * two identical 45% detections stay at 45% and the wall stays missed.
   *
   * Demonstrated red by summing the intervals instead of unioning them:
   * `expected 0.9 to be close to 0.45`, and the wall scored as found on one
   * detection reported twice.
   */
  it('★ R5 — a duplicated detection does not double its coverage', () => {
    const duplicated = [seg(0, 100, 450, 100), seg(0, 100, 450, 100)]
    const score = scoreWallCoverage(duplicated, [WALL], [])
    expect(score.coverage[0].covered).toBeCloseTo(0.45, 6)
    expect(score.matched).toBe(0)
    // …and it is still reported as a duplicate rather than as fragmentation.
    expect(score.doubled).toBe(1)
  })

  /**
   * ★ R7 — an annotation band lying exactly along a wall's centreline, for
   * its whole length, contributes NOTHING. Thickness compatibility is what
   * refuses it: a 2 px hairline is not a fragment of a 24 px wall.
   *
   * Demonstrated red by removing the thickness test from the assignment
   * loop: `expected 1 to be +0` — the hairline was assigned to the wall,
   * covered it 100%, and scored it as FOUND. A benchmark reporting a wall
   * where the drawing has only a dimension line.
   */
  it('★ R7 — a hairline along the centreline cannot cover a wall', () => {
    const score = scoreWallCoverage([seg(0, 100, 1000, 100, 2)], [WALL], [])
    expect(score.matched).toBe(0)
    expect(score.spurious).toBe(1)
    expect(score.coverage[0].covered).toBe(0)
  })

  /**
   * ★ R2 — B43's chain-parallel artefact. The pre-B43 detector reported a
   * 70 px band at x=101 on a drawing whose west wall is 24 px at x=146:
   * a wall-shaped thing in open paper. It must contribute no coverage and
   * remain spurious.
   */
  it('★ R2 — the chain-parallel false wall stays spurious', () => {
    const west = wall('west', 146, 146, 146, 874)
    const score = scoreWallCoverage([seg(101, 146, 101, 874, 70)], [west], [])
    expect(score.matched).toBe(0)
    expect(score.spurious).toBe(1)
    expect(score.coverage[0].covered).toBe(0)
  })
})

/* ─── ★ R8: the scorer must still rank a worse detector lower ───────────── */

describe('★ B44 — the falsification test', () => {
  /**
   * ★ R8, THE CRITERION THAT MATTERS MOST, and the one a permissive scorer
   * would fail.
   *
   * If the new rule made the pre-B43 detector look as good as the post-B43
   * one, it would have erased a real improvement and be measuring nothing.
   * Measured across the outlined variant, under the NEW rule:
   *
   *   pre-B43   4 / 6 / 7   at 104 / 52 / 26 px/m
   *   post-B43  7 / 7 / 7
   *
   * The post-B43 detector is strictly better at every resolution and equal
   * at none where the old one was worse. Asserted here as the post-B43 row,
   * since the pre-B43 detector is not importable — the historical figures
   * are recorded in STATE.md finding 64 and were produced by checking out
   * `detectWalls.ts` at each session's commit.
   */
  it('★ the current detector scores 7/7 outlined at every resolution', () => {
    for (const scale of SCALES) {
      const fixture = buildPlanFixture(scale, { rendering: 'outlined' })
      const score = scoreWallCoverage(
        detectWallSegments(fixture.image, {
          rasterScale: 1,
          metresPerPixel: 1 / fixture.pixelsPerMetre,
        }),
        fixture.truth,
        fixture.annotation,
      )
      expect(score.matched, `outlined/${scale}`).toBe(7)
      expect(score.spurious, `outlined/${scale}`).toBe(0)
    }
  })

  /**
   * ★ The solid row, unchanged under the new rule in every cell — the safety
   * check the brief names. A scorer change that turned an unrelated false
   * positive into a match would show up here first.
   */
  it('★ solid is 7/7 with nothing spurious at every resolution', () => {
    for (const degraded of [false, true]) {
      for (const scale of SCALES) {
        const fixture = buildPlanFixture(scale, { rendering: 'solid', degraded })
        const where = `solid/${scale}/${degraded ? 'degraded' : 'crisp'}`
        const score = scoreWallCoverage(
          detectWallSegments(fixture.image, {
            rasterScale: 1,
            metresPerPixel: 1 / fixture.pixelsPerMetre,
          }),
          fixture.truth,
          fixture.annotation,
        )
        expect(score.matched, where).toBe(7)
        expect(score.spurious, where).toBe(0)
        expect(score.thicknessOk, where).toBe(7)
      }
    }
  })
})

/* ─── the threshold, and the limitation the harder negative exposed ─────── */

describe('B44 — the constant, and what the rule still cannot refuse', () => {
  /**
   * The threshold is derived from the fixture and pinned so drift is a test
   * failure: an opening costs a wall ~13% of itself, the real fragmented
   * walls measure 86–87%, and the hard negative is 40%.
   */
  it('pins COVERAGE_THRESHOLD, and the band it has to separate', () => {
    expect(COVERAGE_THRESHOLD).toBe(0.8)

    // Legitimate fragmentation clears it…
    expect(
      scoreWallCoverage([seg(0, 100, 340, 100), seg(470, 100, 1000, 100)], [WALL], [])
        .coverage[0].covered,
    ).toBeGreaterThan(COVERAGE_THRESHOLD)
    // …and the hard negative does not, with room to spare.
    expect(
      scoreWallCoverage([seg(0, 100, 200, 100), seg(800, 100, 1000, 100)], [WALL], [])
        .coverage[0].covered,
    ).toBeLessThan(COVERAGE_THRESHOLD)
  })

  /**
   * ⚠ **A MEASURED LIMITATION, recorded rather than hidden.**
   *
   * The rule counts coverage, not coherence. A wall "found" as twenty
   * disconnected slivers totalling 85% scores exactly as well as one found
   * in two clean pieces either side of a door. That is too permissive, and
   * it was found by deliberately constructing a harder negative after the
   * rule passed every case first time (§10 rule 6's spirit).
   *
   * It is NOT guarded, and the reason is itself a rule of this project: no
   * detector output has ever produced more than 2 fragments for one wall, so
   * a guard would be a constant invented against an imagined fixture — the
   * same failure the guard would be defending. Instead the observed fragment
   * count is pinned below: if a detector change ever starts shattering
   * walls, that pin moves and this limitation becomes live.
   */
  it('accepts a shattered 20-sliver reading — the known permissiveness', () => {
    const slivers: PixelSegment[] = []
    const each = (1000 * 0.85) / 20
    const gap = (1000 - 1000 * 0.85) / 19
    let x = 0
    for (let i = 0; i < 20; i++) {
      slivers.push(seg(x, 100, x + each, 100))
      x += each + gap
    }
    const score = scoreWallCoverage(slivers, [WALL], [])
    // Documented, not endorsed.
    expect(score.matched).toBe(1)
    expect(score.coverage[0].fragments).toBe(20)
  })

  /**
   * The pin that keeps the limitation theoretical: no wall in any fixture
   * variant is reported in more than two pieces. If this goes red, the
   * sliver case above has become reachable and the rule needs the guard it
   * currently does without.
   */
  it('no detected wall is reported in more than 2 fragments, any variant', () => {
    for (const rendering of ['solid', 'outlined', 'hatched'] as WallRendering[]) {
      for (const scale of SCALES) {
        const fixture = buildPlanFixture(scale, { rendering })
        const score = scoreWallCoverage(
          detectWallSegments(fixture.image, {
            rasterScale: 1,
            metresPerPixel: 1 / fixture.pixelsPerMetre,
          }),
          fixture.truth,
          fixture.annotation,
        )
        for (const c of score.coverage) {
          expect(c.fragments, `${rendering}/${scale}/${c.id}`).toBeLessThanOrEqual(2)
        }
      }
    }
  })
})
