import { useDesignStore } from '../store/useDesignStore'
import { provenance } from '../store/provenance'
import { detectWallSegments, segmentsToWalls } from './detectWalls'
import { rasterise, type RasterResult } from './raster'

/**
 * Decodes a blueprint's own object URL back into pixels for detection.
 *
 * The store keeps the URL, not the raster, so re-decoding here is what lets the
 * structure be built from anywhere — not only the panel that first loaded it.
 */
const rasterFromSrc = (src: string): Promise<RasterResult> =>
  new Promise((resolve) => {
    const element = new Image()
    element.onload = () =>
      resolve(
        rasterise({
          element,
          width: element.naturalWidth,
          height: element.naturalHeight,
          release: () => {},
        }),
      )
    element.onerror = () =>
      resolve({ ok: false, error: 'That blueprint image could not be read.' })
    element.src = src
  })

export type BuildResult =
  | { ok: true; count: number }
  | {
      ok: false
      reason:
        | 'no-blueprint'
        /** A placement restored from a saved project, with no image attached yet. */
        | 'no-image'
        | 'has-walls'
        | 'decode'
        | 'none-found'
    }

/**
 * Detects the walls in the current blueprint and adds them to the open floor,
 * so a traced plan becomes a real 3D structure without the manual detect step.
 *
 * Refuses when the floor already has walls: switching to 3D must never dump
 * auto-detected walls on top of something the user drew, and that guard is what
 * makes it safe to call on every view change rather than exactly once.
 *
 * The scale is whatever the blueprint is calibrated to — the default guess if
 * the user has not calibrated — so an uncalibrated plan comes in at a plausible
 * size the user can correct, rather than not at all.
 */
export async function buildWallsFromBlueprint(): Promise<BuildResult> {
  const state = useDesignStore.getState()
  const blueprint = state.blueprint
  if (!blueprint) return { ok: false, reason: 'no-blueprint' }
  // A reopened project remembers its underlay's placement and scale but not
  // its pixels — there is nothing to detect walls in until the user re-picks
  // the file.
  if (!blueprint.src) return { ok: false, reason: 'no-image' }
  if (state.walls.length > 0) return { ok: false, reason: 'has-walls' }

  const result = await rasterFromSrc(blueprint.src)
  if (!result.ok) return { ok: false, reason: 'decode' }

  const { raster } = result
  const segments = detectWallSegments(raster.image)
  const walls = segmentsToWalls(segments, {
    // Detection runs on the possibly-downscaled raster, whose pixels are larger
    // than the source pixels the calibration is expressed in.
    metresPerPixel: blueprint.metresPerPixel / raster.scale,
    origin: blueprint.origin,
  })
  if (walls.length === 0) return { ok: false, reason: 'none-found' }

  // Re-read: the await above yielded, and the floor could have changed under us.
  const store = useDesignStore.getState()
  if (store.walls.length > 0) return { ok: false, reason: 'has-walls' }

  let count = 0
  for (const wall of walls) {
    if (
      store.addWall(wall.start, wall.end, {
        thickness: wall.thickness,
        provenance: provenance.cv(blueprint.fileName),
      })
    ) {
      count += 1
    }
  }
  return count > 0 ? { ok: true, count } : { ok: false, reason: 'none-found' }
}
