import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildWallsFromBlueprint } from './buildStructure'
import { uncalibrated } from './calibration'
import { resetStore } from '../test/fixtures'
import { useDesignStore, type Blueprint, type CalibrationSource } from '../store/useDesignStore'

/**
 * B5b wiring — the auto-build path fails CLOSED and says which gate refused.
 *
 * This is the path triggered by switching to 3D. Before B5b it wrote detected
 * walls straight into the document with no review, which made it the one place
 * the app could auto-create a bad 2D model just so that something appeared in
 * the 3D view.
 *
 * Every assertion names the GATE. `ok === false` alone would pass when the
 * wrong check fired, or when detection merely found nothing.
 */

const AT = '2026-08-12T00:00:00.000Z'

function blueprint(patch: {
  width: number
  height: number
  metresPerPixel: number
  source: CalibrationSource
}): Blueprint {
  return {
    // A non-null `src` so the guard above the gates does not short-circuit.
    // Nothing decodes it — every gate under test answers before the raster.
    src: 'blob:test/plan',
    fileName: 'plan.webp',
    width: patch.width,
    height: patch.height,
    metresPerPixel: patch.metresPerPixel,
    origin: { x: 0, z: 0 },
    opacity: 1,
    visible: true,
    calibration: {
      ...uncalibrated(patch.metresPerPixel, AT),
      source: patch.source,
      metresPerPixel: patch.metresPerPixel,
    },
  }
}

const build = async (b: Blueprint) => {
  useDesignStore.setState({ blueprint: b, walls: [] })
  return buildWallsFromBlueprint()
}

beforeEach(resetStore)
afterEach(resetStore)

describe('★ B5b — the auto-build path fails closed, by name', () => {
  /**
   * ★ The real plan's own numbers: 400 × 300 px, scale from the AI.
   *
   * Asymmetric in: raster size AND scale provenance, which is why the
   * assertion names WHICH of the two answered first. A fixture failing only
   * one of them could not show the ordering.
   */
  it('★ refuses a 400 px image, naming raster-size', async () => {
    const result = await build(
      blueprint({
        width: 400,
        height: 300,
        metresPerPixel: 0.027575432163436355,
        source: 'ai',
      }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('implausible')
    // The gate, by name — not merely that something refused.
    expect(result.gate?.gate).toBe('raster-size')
    expect(result.gate?.measured).toMatchObject({ longestSourcePx: 400 })
    // Nothing was written. The whole point of failing closed.
    expect(useDesignStore.getState().walls).toEqual([])
  })

  /**
   * ★ Asymmetric in: PROVENANCE only. Big enough raster, fine resolution —
   * so if this refused for any other reason the assertion would catch it.
   */
  it('★ refuses an AI scale on an otherwise good image, naming scale-provenance', async () => {
    const result = await build(
      blueprint({ width: 2400, height: 1800, metresPerPixel: 1 / 200, source: 'ai' }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.gate?.gate).toBe('scale-provenance')
    expect(result.gate?.message).toContain('estimate')
    expect(useDesignStore.getState().walls).toEqual([])
  })

  /**
   * ★ Asymmetric in: RESOLUTION only. Measured scale, big raster, but the
   * drawing covers so much ground that a wall is a few pixels across.
   *
   * This is also the ordering test: resolution is only reachable once
   * provenance has passed, because its divisor IS the scale.
   */
  it('★ refuses 30 px/m even with a measured scale, naming resolution', async () => {
    const result = await build(
      blueprint({ width: 2400, height: 1800, metresPerPixel: 1 / 30, source: 'manual' }),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.gate?.gate).toBe('resolution')
    expect(result.gate?.measured.sourcePxPerMetre).toBeCloseTo(30, 1)
    expect(useDesignStore.getState().walls).toEqual([])
  })

  it('does not reach the gates when there is nothing to detect from', async () => {
    // The pre-existing guards still answer first, and still by their own name.
    useDesignStore.setState({ blueprint: null, walls: [] })
    expect(await buildWallsFromBlueprint()).toEqual({
      ok: false,
      reason: 'no-blueprint',
    })
  })

  it('still refuses to overwrite walls the user already has', async () => {
    const b = blueprint({
      width: 2400,
      height: 1800,
      metresPerPixel: 1 / 200,
      source: 'manual',
    })
    useDesignStore.setState({
      blueprint: b,
      walls: [
        {
          id: 'w',
          start: { x: 0, z: 0 },
          end: { x: 4, z: 0 },
          height: 3,
          thickness: 0.2,
          openings: [],
          material: 'white-paint',
        },
      ],
    })
    // `has-walls`, not `implausible`: the gates must not displace a guard that
    // protects the user's own drawing.
    expect(await buildWallsFromBlueprint()).toEqual({ ok: false, reason: 'has-walls' })
  })
})
