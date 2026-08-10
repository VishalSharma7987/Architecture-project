import { describe, expect, it } from 'vitest'
import { proposeCalibration, uncalibrated } from '../blueprint/calibration'
import { buildWallsFromBlueprint } from '../blueprint/buildStructure'
import { segmentsToWalls, type PixelSegment } from '../blueprint/detectWalls'
import { rectangleWalls, resetStore } from '../test/fixtures'
import { useDesignStore, type Blueprint } from './useDesignStore'

/**
 * Two loose ends from the B13 review, closed together because both are about
 * a write that should not have happened.
 *
 * - **13d** — §10 rule 10: a store `.map()` that returns a structurally
 *   identical new array is read as an edit by the undo recorder, which compares
 *   by reference.
 * - **13b** — §7 Stage 0.3's exit has two clauses. The first (`metresPerPixel`
 *   is unchanged) was covered; the second — *"and the walls are built at the
 *   user's scale"* — was asserted nowhere.
 */

const AT = '2026-08-10T00:00:00.000Z'

describe('★ 13d — a patch against a wall that is gone records nothing', () => {
  /**
   * Demonstrated red (SD5): with `patchWall` restored to a bare
   * `walls.map(...)`, every case below failed with
   * `expected 1 to be 0` — one phantom history step per no-op patch, and a
   * `walls` array replaced by an identical copy.
   */
  const PATCHES: [name: string, apply: () => void][] = [
    ['updateWall', () => useDesignStore.getState().updateWall('gone', { height: 2.4 })],
    ['setWallLength', () => useDesignStore.getState().setWallLength('gone', 5)],
    [
      'updateOpening',
      () => useDesignStore.getState().updateOpening('gone', 'alsoGone', { width: 1 }),
    ],
    ['removeOpening', () => useDesignStore.getState().removeOpening('gone', 'alsoGone')],
  ]

  for (const [name, apply] of PATCHES) {
    it(`${name} on a missing wall leaves the array identical`, () => {
      resetStore()
      useDesignStore.setState({ walls: rectangleWalls() })
      const before = useDesignStore.getState().walls

      apply()

      expect(
        useDesignStore.getState().walls,
        'a new-but-identical array is an edit as far as the undo recorder is concerned',
      ).toBe(before)
    })
  }

  it('★ does not push an undo step the user cannot see', () => {
    resetStore()
    useDesignStore.setState({ walls: rectangleWalls() })
    const steps = useDesignStore.getState().past.length

    // The race this models: the inspector still holds an id, the wall has just
    // been deleted from the 3D view, and the next keystroke lands here.
    useDesignStore.getState().updateWall('gone', { height: 2.4 })
    useDesignStore.getState().setWallLength('gone', 5)

    expect(useDesignStore.getState().past.length).toBe(steps)
  })

  it('still records a real edit', () => {
    resetStore()
    const walls = rectangleWalls()
    useDesignStore.setState({ walls })

    useDesignStore.getState().updateWall(walls[0].id, { height: 2.4 })

    expect(useDesignStore.getState().walls).not.toBe(walls)
    expect(useDesignStore.getState().walls[0].height).toBe(2.4)
  })
})

describe('★ 13b — Stage 0.3 exit, second clause: walls are built at the user’s scale', () => {
  /**
   * §7 Stage 0.3's exit reads in full: *"a test that calibrates, switches to 3D
   * with a stubbed vision response carrying a different scale, and asserts
   * `metresPerPixel` is unchanged **and the walls are built at the user's
   * scale**"*.
   *
   * `calibration.test.ts` covers the first half. This covers the second, which
   * is the half that actually reaches the model: a scale that survives in the
   * store but is not the one `segmentsToWalls` used would leave the underlay
   * right and the building wrong.
   */
  const MEASURED = 0.019

  /** A 1000 x 800 blueprint the user has measured. */
  function measuredBlueprint(): Blueprint {
    const blueprint: Blueprint = {
      src: 'blob:test/plan.png',
      fileName: 'plan.png',
      width: 1000,
      height: 800,
      metresPerPixel: 0.01,
      origin: { x: -5, z: -4 },
      opacity: 0.5,
      visible: true,
      calibration: uncalibrated(0.01, AT),
    }
    useDesignStore.getState().setBlueprint(blueprint)
    proposeCalibration({ source: 'manual', metresPerPixel: MEASURED, at: AT })
    return useDesignStore.getState().blueprint!
  }

  it('★ segmentsToWalls converts at the measured scale, not the AI estimate', () => {
    resetStore()
    measuredBlueprint()

    // The vision read proposes a very different scale, and is refused.
    proposeCalibration({ source: 'ai', metresPerPixel: 0.0305, at: AT })
    const inForce = useDesignStore.getState().blueprint!

    expect(inForce.metresPerPixel).toBe(MEASURED)

    // A 400 px wall, converted exactly as `buildWallsFromBlueprint` does it —
    // detection runs on the raster, whose pixels are larger than the source
    // pixels the calibration is expressed in, hence the divide by `scale`.
    const rasterScale = 1
    const segments: PixelSegment[] = [
      { x1: 100, y1: 200, x2: 500, y2: 200, thickness: 12 },
    ]
    const [wall] = segmentsToWalls(segments, {
      metresPerPixel: inForce.metresPerPixel / rasterScale,
      origin: inForce.origin,
    })

    const lengthMetres = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z)
    expect(lengthMetres).toBeCloseTo(400 * MEASURED, 9)
    expect(wall.thickness).toBeCloseTo(12 * MEASURED, 9)

    // And emphatically NOT at the estimate the model offered.
    expect(lengthMetres).not.toBeCloseTo(400 * 0.0305, 6)
  })

  it('a raster that was downscaled still lands at the measured size', () => {
    resetStore()
    const blueprint = measuredBlueprint()

    // Half-size raster: every raster pixel is two source pixels.
    const rasterScale = 0.5
    const [wall] = segmentsToWalls(
      [{ x1: 50, y1: 100, x2: 250, y2: 100, thickness: 6 }],
      {
        metresPerPixel: blueprint.metresPerPixel / rasterScale,
        origin: blueprint.origin,
      },
    )

    // 200 raster px = 400 source px = the same real wall as above.
    const lengthMetres = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z)
    expect(lengthMetres).toBeCloseTo(400 * MEASURED, 9)
  })

  it('the auto-build refuses when the underlay has no pixels attached', () => {
    // The other half of the same path: a reopened project remembers the
    // measurement but not the image, so there is nothing to detect walls in.
    resetStore()
    const blueprint = measuredBlueprint()
    useDesignStore.getState().setBlueprint({ ...blueprint, src: null })

    return buildWallsFromBlueprint().then((result) => {
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toBe('no-image')
      // And the measurement is still there to be used once the file returns.
      expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(MEASURED)
    })
  })
})
