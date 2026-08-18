import { useDesignStore } from '../store/useDesignStore'
import { provenance } from '../store/provenance'
import { weldIngestWalls } from '../plan/repairJoints'
import { detectWallSegments, segmentsToWalls } from './detectWalls'
import {
  gateAfterDetection,
  gateBeforeDetection,
  type GateResult,
} from './plausibility'
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
  | {
      ok: true
      count: number
      /** Near-miss joints the ingest weld closed — reported, never silent. */
      welded: number
      warnings: GateResult[]
    }
  | {
      ok: false
      reason:
        | 'no-blueprint'
        /** A placement restored from a saved project, with no image attached yet. */
        | 'no-image'
        | 'has-walls'
        | 'decode'
        | 'none-found'
        /** A plausibility gate refused. `gate` names which, and why. */
        | 'implausible'
      /** Present when `reason` is `'implausible'`. The user-facing sentence. */
      gate?: GateResult
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

  // ── the gates that can be answered before a single pixel is read ──
  // Fails CLOSED. This path is triggered by switching to 3D, so it is the one
  // place the app could auto-create a bad 2D model just so that something
  // appears in the 3D view. It must not.
  const before = gateBeforeDetection({
    sourceWidth: blueprint.width,
    sourceHeight: blueprint.height,
    sourceMetresPerPixel: blueprint.metresPerPixel,
    calibrationSource: blueprint.calibration.source,
    lockedByUser: blueprint.calibration.lockedByUser,
  })
  if (before.blocking) {
    return { ok: false, reason: 'implausible', gate: before.blocking }
  }

  const result = await rasterFromSrc(blueprint.src)
  if (!result.ok) return { ok: false, reason: 'decode' }

  const { raster } = result
  // `rasterScale` is load-bearing: without it the thresholds size themselves
  // against pixels the upscale manufactured. See `sizedDefaults`.
  const segments = detectWallSegments(raster.image, { rasterScale: raster.scale })
  const walls = segmentsToWalls(segments, {
    // Detection runs on the possibly-downscaled raster, whose pixels are larger
    // than the source pixels the calibration is expressed in.
    metresPerPixel: blueprint.metresPerPixel / raster.scale,
    origin: blueprint.origin,
  })
  if (walls.length === 0) return { ok: false, reason: 'none-found' }

  // ── and the gates that read what came out ──
  // Thicknesses in metres, judged against the SOURCE scale — the upscale
  // cannot be allowed to make a stroke look like a measurement.
  const after = gateAfterDetection(
    walls.map((w) => w.thickness),
    blueprint.metresPerPixel,
  )
  if (after.blocking) {
    return { ok: false, reason: 'implausible', gate: after.blocking }
  }

  // Re-read: the await above yielded, and the floor could have changed under us.
  const store = useDesignStore.getState()
  if (store.walls.length > 0) return { ok: false, reason: 'has-walls' }

  // The ingest weld (B36), AFTER the gates: the gates judge the DETECTOR's
  // raw reading, and a weld that ran first would let cleanup blur what is
  // being judged. Welded here, before commit, so the store never holds the
  // near-misses the detector's noise produces. Ids are synthesized by index —
  // deterministic, so the weld's tie-breaks are too (L6) — and discarded by
  // `addWall`, which mints real ones.
  const welded = weldIngestWalls(
    walls.map((wall, i) => ({ ...wall, id: `cv-${i}` })),
  )

  let count = 0
  for (const wall of welded.walls) {
    if (
      store.addWall(wall.start, wall.end, {
        thickness: wall.thickness,
        provenance: provenance.cv(blueprint.fileName),
      })
    ) {
      count += 1
    }
  }
  // Warnings ride along on SUCCESS: a plan at 60 source px/m is worth
  // building and worth saying something about, and swallowing that would be
  // the silent-truncation failure the corpus spec forbids.
  return count > 0
    ? {
        ok: true,
        count,
        welded: welded.closed,
        warnings: [...before.warnings, ...after.warnings],
      }
    : { ok: false, reason: 'none-found' }
}
