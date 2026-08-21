import { describe, expect, it } from 'vitest'
import {
  buildPlanFixture,
  checkFixture,
  FIXTURE_SCALES,
  type FixtureScale,
  type WallRendering,
} from './planFixture'
import { detectWallSegments, inkMask } from '../blueprint/detectWalls'
import { strokeProfile, strokeWidthMap } from '../blueprint/annotationInk'
import { scoreWallGraph } from '../blueprint/wallGraphScore'

/**
 * B40 — the fixture extended to the conventions B39 named as missing.
 *
 * ⚠ **EVERY NUMBER HERE IS SYNTHETIC** and says nothing about real drawings
 * (§10 rule 6). What it does say is which CONVENTIONS the detector can read,
 * and that is a different and answerable question.
 *
 * ── The instrument checks itself first ──
 * B39's fixture drew a 12 px wall as 13 px and manufactured a confident
 * "resolution inversion" finding that was nearly written up. Outlined walls
 * make that hazard worse — footprint, stroke and face separation are three
 * numbers that must agree — so `checkFixture` re-measures all three off the
 * rendered pixels and the suite asserts it before believing any score.
 */

const SCALES: FixtureScale[] = ['generous', 'middle', 'critical']
const RENDERINGS: WallRendering[] = ['solid', 'outlined', 'hatched']

const detect = (image: Parameters<typeof detectWallSegments>[0]) =>
  detectWallSegments(image, { rasterScale: 1 })

/* ─── ★ the instrument is sound ─────────────────────────────────────────── */

describe('★ B40 — the fixture draws what its ground truth claims', () => {
  /**
   * ★ Every variant, cut through and re-measured: footprint against the
   * declared thickness, and for the two-faced conventions the stroke at each
   * face and the gap between them.
   *
   * Demonstrated red by restoring B39's original off-by-one (`+ half`
   * instead of `+ half - 1` in the solid fill): every solid variant reported
   * `shell-n: footprint 25 px, ground truth says 24` and the suite failed at
   * 9 variants. That is the exact defect that manufactured B39's false
   * finding, so this is the test that would have caught it.
   */
  it('★ rendered pixels match declared ground truth, for every legible variant', () => {
    for (const rendering of RENDERINGS) {
      for (const scale of SCALES) {
        for (const degraded of [false, true]) {
          if (isIllegible(rendering, scale, degraded)) continue
          const fixture = buildPlanFixture(scale, { rendering, degraded })
          expect(
            checkFixture(fixture),
            `${rendering}/${scale}/${degraded ? 'degraded' : 'crisp'}`,
          ).toEqual([])
        }
      }
    }
  })

  /**
   * The excluded combinations, asserted rather than silently skipped: a 1 px
   * face does not survive a resample, so at 26 px/m a degraded outlined or
   * hatched drawing has no legible wall left. That is finding 40's "a
   * drawing rendered below its own line weight" reproduced exactly — it is a
   * property of the drawing, not a fault in the fixture, and the fixture is
   * asserted to be honestly illegible rather than quietly wrong.
   */
  it('names the combinations a 1 px stroke cannot survive', () => {
    for (const rendering of ['outlined', 'hatched'] as const) {
      const fixture = buildPlanFixture('critical', { rendering, degraded: true })
      expect(fixture.truth[0].stroke).toBe(1)
      expect(checkFixture(fixture).length).toBeGreaterThan(0)
    }
    // …and the same drawing crisp IS legible, so the degradation is the cause.
    expect(checkFixture(buildPlanFixture('critical', { rendering: 'outlined' }))).toEqual([])
  })

  it('records what it actually drew when an outline will not fit', () => {
    // An outline needs ink/gap/ink. Where the footprint cannot hold one the
    // fixture renders solid and SAYS so, rather than drawing a lie.
    for (const scale of SCALES) {
      const fixture = buildPlanFixture(scale, { rendering: 'outlined' })
      for (const wall of fixture.truth) {
        const fits = wall.thickness >= 2 * wall.stroke + 1
        expect(wall.renderedAs).toBe(fits ? 'outlined' : 'solid')
      }
    }
  })
})

/** Combinations where the drawing itself is destroyed — see the test above. */
const isIllegible = (
  rendering: WallRendering,
  scale: FixtureScale,
  degraded: boolean,
): boolean => rendering !== 'solid' && scale === 'critical' && degraded

/* ─── ★ outlined walls: the pin, and the finding ────────────────────────── */

describe('★ B40 — outlined walls', () => {
  /**
   * ★ A PIN, NOT A DISCOVERY, and it is worth saying which.
   *
   * `mergeWallFaces` has existed since before this project's first session
   * specifically to pair the two faces of an outlined wall, and no fixture
   * had ever contained one. At 104 px/m it turns out to work: the five walls
   * it finds come back at their true footprint (24 px and 12 px), and
   * `doubled` is 0 — not one wall is reported twice.
   *
   * So this test cannot go red against today's code, and pretending it was a
   * discovery would be the thirteenth green-but-empty test. It is capable of
   * going red in the future: any change that breaks pairing reports two
   * walls per wall and `doubled` becomes non-zero, which is exactly the
   * regression `mergeWallFaces` is protected against.
   */
  it('★ pair into ONE wall at their true thickness, never two (a pin)', () => {
    const fixture = buildPlanFixture('generous', { rendering: 'outlined' })
    expect(fixture.truth[0].renderedAs).toBe('outlined')
    expect(fixture.truth[0].stroke).toBe(2) // two 2 px faces, 24 px apart

    const score = scoreWallGraph(
      detect(fixture.image),
      fixture.truth,
      fixture.annotation,
    )

    // Not one wall reported twice — the faces were paired.
    expect(score.doubled).toBe(0)
    // And the paired thickness is the wall's real footprint, not a face.
    expect(score.thicknessOk).toBe(score.matched)
    expect(score.matched).toBeGreaterThanOrEqual(5)
  })

  /**
   * ★ **THE FINDING. An outlined drawing at 26 px/m detects as EMPTY.**
   *
   * Not "poorly" — the detector returns zero segments. Its faces are 1 px,
   * `minThicknessPx` floors at 2 regardless of how small the drawing is
   * (`Math.max(2, sourceFloor, 3 * k)`), so no band is ever formed and the
   * whole plan reads as blank paper.
   *
   * The same plan drawn SOLID at the same resolution reads 7 of 7. So this
   * is a convention failure, not a resolution failure — which is precisely
   * what B39 could not distinguish, because B39's fixture had no outlined
   * variant to compare against.
   *
   * It goes red when someone fixes it, which is the intended outcome. The
   * fix is B41's subject, not a repair to this test.
   */
  it('★ detect as EMPTY at 26 px/m, where the same plan drawn solid reads 7/7', () => {
    const outlined = buildPlanFixture('critical', { rendering: 'outlined' })
    expect(outlined.truth[0].stroke).toBe(1)
    expect(detect(outlined.image)).toHaveLength(0)

    // The control that makes it a CONVENTION finding rather than a
    // resolution one: same scale, same plan, solid walls.
    const solid = buildPlanFixture('critical', { rendering: 'solid' })
    const solidScore = scoreWallGraph(detect(solid.image), solid.truth, solid.annotation)
    expect(solidScore.matched).toBe(7)
  })

  /**
   * The mechanism, isolated: with the floor lowered to 1 px the faces DO
   * appear — so the ink is there and the threshold is what discards it. What
   * comes back is unpaired 1 px faces mixed with bands far thicker than any
   * wall, so lowering the floor is not the fix either.
   */
  it('the 1 px faces exist — minThicknessPx is what discards them', () => {
    const fixture = buildPlanFixture('critical', { rendering: 'outlined' })
    const relaxed = detectWallSegments(fixture.image, {
      rasterScale: 1,
      minThicknessPx: 1,
    })
    expect(relaxed.length).toBeGreaterThan(0)
    expect(Math.min(...relaxed.map((s) => s.thickness))).toBe(1)
    // …and it is not a fix: the shell is 6 px, and bands far thicker appear.
    expect(Math.max(...relaxed.map((s) => s.thickness))).toBeGreaterThan(12)
  })

  /**
   * ★ The interaction B39's annotation filter cannot survive.
   *
   * On a SOLID drawing the stroke-width families separate cleanly —
   * annotation at 2 px, walls at 12 and 24 — which is what made B39's
   * derived split work. On an OUTLINED drawing the wall FACES are 2 px:
   * the same width as the annotation, in the same family.
   *
   * So a stroke-width split cannot separate annotation from structure on an
   * outlined drawing even in principle, and B39's `annotationInk` is
   * structurally inapplicable to half of all real drawings. Recorded here
   * because it retires that line of work rather than merely bruising it.
   */
  it('★ collapse the stroke-width families annotation filtering depends on', () => {
    const profileFor = (rendering: WallRendering) => {
      const fixture = buildPlanFixture('generous', { rendering })
      return strokeProfile(
        strokeWidthMap(inkMask(fixture.image), fixture.image.width, fixture.image.height),
      )
    }

    // Solid: annotation 2, partition 12, shell 24 — three separable families.
    expect(profileFor('solid').families).toEqual([2, 12, 24])

    // Outlined: the 12 and 24 families are GONE, because no ink is that wide
    // any more. The wall faces sit in the 2 px family with the annotation.
    const outlined = profileFor('outlined')
    expect(outlined.families).not.toContain(12)
    expect(outlined.families).not.toContain(24)
    expect(outlined.families).toContain(2)
  })
})

/* ─── the matrix, pinned ────────────────────────────────────────────────── */

describe('B40 — convention × resolution, measured', () => {
  /**
   * The headline of the matrix, pinned so a change cannot move it silently.
   * ⚠ SYNTHETIC. See `docs/STATE.md` finding 60 for the full table.
   *
   * **B41 UPDATE:** `detect` here supplies NO `metresPerPixel`, so these are
   * the scale-blind numbers and they are deliberately unchanged — that is
   * B41's safety property, asserted in `outlinedWalls.test.ts`. With the
   * scale supplied, outlined at 26 px/m reads 4 of 7 instead of 0.
   */
  it('solid reads at every resolution; outlined degrades to nothing WITHOUT a scale', () => {
    const matched = (rendering: WallRendering, scale: FixtureScale) => {
      const fixture = buildPlanFixture(scale, { rendering })
      return scoreWallGraph(detect(fixture.image), fixture.truth, fixture.annotation)
        .matched
    }

    for (const scale of SCALES) expect(matched('solid', scale), scale).toBe(7)

    expect(matched('outlined', 'generous')).toBe(5)
    expect(matched('outlined', 'middle')).toBe(6)
    expect(matched('outlined', 'critical')).toBe(0)
    expect(FIXTURE_SCALES.critical).toBe(26)
  })
})
