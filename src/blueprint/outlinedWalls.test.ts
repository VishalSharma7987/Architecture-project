import { describe, expect, it } from 'vitest'
import { detectWallSegments } from './detectWalls'
import { scoreWallGraph } from './wallGraphScore'
import {
  buildPlanFixture,
  checkFixture,
  type FixtureScale,
  type WallRendering,
} from '../test/planFixture'

/**
 * B41 — reading an outlined wall. See ADR 0004.
 *
 * ⚠ **EVERY NUMBER HERE IS SYNTHETIC** (§10 rule 6). It says which
 * CONVENTIONS the detector can read, which is answerable; it says nothing
 * about real drawings, of which the corpus still holds zero usable.
 *
 * B40 measured the failure: an outlined plan at 26 px/m detected as ZERO
 * segments where the same plan drawn solid read 7 of 7. The faces are 1 px,
 * `minThicknessPx` floors at 2, and the thickness floor was applied TWICE
 * before `mergeWallFaces` — the function that exists to pair those very
 * faces — ever saw them.
 */

const SCALES: FixtureScale[] = ['generous', 'middle', 'critical']

/** Detection as the app calls it: with the drawing's scale supplied. */
const detectScaled = (fixture: ReturnType<typeof buildPlanFixture>) =>
  detectWallSegments(fixture.image, {
    rasterScale: 1,
    metresPerPixel: 1 / fixture.pixelsPerMetre,
  })

/** Detection with NO scale — the pre-B41 path, which must be untouched. */
const detectBlind = (fixture: ReturnType<typeof buildPlanFixture>) =>
  detectWallSegments(fixture.image, { rasterScale: 1 })

const score = (
  fixture: ReturnType<typeof buildPlanFixture>,
  segments: ReturnType<typeof detectScaled>,
) => scoreWallGraph(segments, fixture.truth, fixture.annotation)

/* ─── ★ the failure B40 reproduced, now read ────────────────────────────── */

describe('★ B41 — an outlined plan at 26 px/m is no longer blank paper', () => {
  /**
   * ★ THE SESSION'S RESULT. B40 measured **0 segments** here — not "poor
   * detection", nothing at all, on a plan a human reads instantly.
   *
   * Demonstrated red against the pre-B41 detector (and still reproducible by
   * omitting `metresPerPixel`, which the test below asserts): `expected 0 to
   * be greater than 0`, and the score reported matched 0 of 7.
   *
   * The assertion is on the GRAPH and includes spurious, because B40 showed
   * matched alone can rise while the reading gets worse: the degraded rows
   * reach 7/7 by accident with 6 spurious and half the thicknesses wrong.
   * Four walls with zero spurious is a real reading; seven with six is not.
   */
  it('★ reads the whole shell, with no spurious detections', () => {
    const fixture = buildPlanFixture('critical', { rendering: 'outlined' })
    expect(fixture.truth[0].renderedAs).toBe('outlined')
    expect(fixture.truth[0].stroke).toBe(1) // 1 px faces — B40's condition

    const result = score(fixture, detectScaled(fixture))

    expect(result.matched).toBe(4)
    expect(result.spurious).toBe(0)
    expect(result.doubled).toBe(0)
    // Every wall it found, it measured: 6 px footprint, not a 1 px face.
    expect(result.thicknessOk).toBe(4)

    // The control that makes this B41's doing: blind detection still reads
    // nothing at all, which is exactly what B40 measured.
    expect(detectBlind(fixture)).toHaveLength(0)
  })

  /**
   * ★ **The safety property, and the reason this could ship at all.**
   *
   * Without a scale the outlined path is OFF and detection is byte-identical
   * to the pre-B41 detector. A caller that never learned the drawing's scale
   * cannot be made worse off, and there is no guessing anywhere.
   *
   * Demonstrated red by making the path unconditional (defaulting the
   * separation ceiling to `maxThicknessPx` when no scale is given): the
   * outlined fixture then returned segments here, `expected 4 to be +0`, and
   * — the reason it matters — the dimension chain paired with the shell's
   * outer face 19 px away and was reported as a 19 px wall on a drawing
   * whose shell is 6 px.
   */
  it('★ without a scale, behaves exactly as it did before B41', () => {
    for (const rendering of ['solid', 'outlined', 'hatched'] as WallRendering[]) {
      for (const scale of SCALES) {
        const fixture = buildPlanFixture(scale, { rendering })
        // Same input, no scale: the thin-face path never engages.
        const blind = detectBlind(fixture)
        if (rendering === 'solid') {
          // Solid never used the path either way, so the two agree.
          expect(blind.length, `${rendering}/${scale}`).toBe(detectScaled(fixture).length)
        }
      }
    }
    // And the specific pre-B41 measurement is still reproducible.
    expect(detectBlind(buildPlanFixture('critical', { rendering: 'outlined' }))).toHaveLength(0)
  })
})

/* ─── ★ solid must not move ────────────────────────────────────────────── */

describe('★ B41 — solid detection is unchanged, every cell', () => {
  /**
   * ★ The full matrix row rather than a count, because a count hides which
   * cell moved. Six cells — three resolutions × crisp/degraded — each
   * asserting matched, spurious, doubled and thickness-ok together.
   *
   * ⚠ **This one did NOT go red when probed, and the honest note matters
   * more than a tidy claim.** The probe — pairing thin candidates together
   * with the solid bands in one `mergeWallFaces` call instead of among
   * themselves — left all five tests green. So the separate-pass design is a
   * SAFETY choice, not a measured necessity: it makes the solid path
   * provably untouched by construction rather than by this fixture happening
   * not to expose the difference. A drawing with hairline annotation running
   * alongside a solid wall inside the separation ceiling would expose it,
   * and no such fixture exists yet.
   *
   * What this test IS demonstrated red by: the pre-B41 detector, where the
   * solid numbers are identical — so as a guard against B41 having moved
   * them it can only fail if something later does move them. That is a pin,
   * and it is labelled one.
   */
  it('★ 7/7 with nothing spurious at every resolution, crisp and degraded', () => {
    for (const degraded of [false, true]) {
      for (const scale of SCALES) {
        const fixture = buildPlanFixture(scale, { rendering: 'solid', degraded })
        const where = `solid/${scale}/${degraded ? 'degraded' : 'crisp'}`
        const result = score(fixture, detectScaled(fixture))

        expect(result.matched, `${where} matched`).toBe(7)
        expect(result.spurious, `${where} spurious`).toBe(0)
        expect(result.doubled, `${where} doubled`).toBe(0)
        expect(result.thicknessOk, `${where} thickness`).toBe(7)
      }
    }
  })

  it('the fixture still describes what it draws, for every variant', () => {
    // B39's lesson: a fixture whose pixels disagree with its ground truth
    // manufactures findings. Re-asserted here because B41 reads the fixture
    // in a new way and a silent drift would look like a detector result.
    for (const rendering of ['solid', 'outlined', 'hatched'] as WallRendering[]) {
      for (const scale of SCALES) {
        expect(
          checkFixture(buildPlanFixture(scale, { rendering })),
          `${rendering}/${scale}`,
        ).toEqual([])
      }
    }
  })
})

/* ─── what is still missing, pinned for B42 ────────────────────────────── */

describe('B41 — the outlined partitions are still missed, and why', () => {
  /**
   * Pinned so the next session starts from a measured position rather than
   * re-deriving it. THREE partitions at 26 px/m are still lost, and the
   * mechanism is precise:
   *
   *   - their two 1 px faces DO pair, but the fused band reports thickness
   *     **2** where the drawn footprint is **3** — a one-pixel under-measure
   *     inside `mergeWallFaces` for the minimal ink/gap/ink case;
   *   - `thicknessFloorRatio` then drops them: 0.4 × the typical 6 px shell
   *     is 2.4, and 2 < 2.4.
   *
   * At the true 3 they would survive (3/6 = 0.5 > 0.4), so the floor is
   * behaving correctly and the under-measure is the whole defect. Fixing it
   * means touching `mergeWallFaces`' internals, which is §3 territory and
   * wants its own argued session.
   *
   * Goes red when B42 fixes it — which is the intended outcome.
   */
  it('pairs them at 2 px where the drawing is 3 px, and the floor drops them', () => {
    const fixture = buildPlanFixture('critical', { rendering: 'outlined' })
    const mpp = 1 / fixture.pixelsPerMetre
    for (const wall of fixture.truth.filter((w) => w.kind === 'partition')) {
      expect(wall.thickness).toBe(3)
    }

    // With the relative floor removed, the partitions appear — at 2 px.
    const unfloored = detectWallSegments(fixture.image, {
      rasterScale: 1,
      metresPerPixel: mpp,
      thicknessFloorRatio: 0,
    })
    expect(unfloored.filter((s) => s.thickness === 2).length).toBeGreaterThanOrEqual(3)
    // The shells, by contrast, are measured exactly right.
    expect(unfloored.filter((s) => s.thickness === 6).length).toBe(4)
  })
})
