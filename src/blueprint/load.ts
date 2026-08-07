import { BLUEPRINT_DEFAULTS, useDesignStore } from '../store/useDesignStore'
import { uncalibrated } from './calibration'
import { rasterFromFile, type Raster } from './raster'

export type BlueprintLoad =
  | { ok: true; raster: Raster }
  | { ok: false; error: string }

/**
 * Decodes an image file and installs it as the traced blueprint.
 *
 * Shared rather than living in the panel because an image can arrive from two
 * places — the Blueprint panel, and the Import menu, which is where people look
 * for it first. Both need the placement identical, or a plan traced from one
 * route would sit at a different scale from the other.
 */
export async function loadBlueprintFromFile(file: File): Promise<BlueprintLoad> {
  const result = await rasterFromFile(file)
  if (!result.ok) return result

  const { raster } = result

  // A reopened project remembers the placement and scale of the image it was
  // traced from, but not its pixels. Re-picking that same file should hand the
  // measurement back rather than make the user take it again — and it is only
  // the same file if the name AND the pixel dimensions both match, since a
  // resaved or cropped export under the same name would silently inherit a
  // scale that no longer describes it.
  const remembered = useDesignStore.getState().blueprint
  const reattaching =
    remembered !== null &&
    remembered.src === null &&
    remembered.fileName === file.name &&
    remembered.width === raster.sourceWidth &&
    remembered.height === raster.sourceHeight

  if (reattaching) {
    useDesignStore.getState().setBlueprint({ ...remembered, src: URL.createObjectURL(file) })
    return { ok: true, raster }
  }

  const metresPerPixel = BLUEPRINT_DEFAULTS.metresPerPixel

  useDesignStore.getState().setBlueprint({
    // `rasterFromFile` releases its own object URL, so the store gets a fresh
    // one that it owns and revokes when the image is replaced.
    src: URL.createObjectURL(file),
    fileName: file.name,
    width: raster.sourceWidth,
    height: raster.sourceHeight,
    metresPerPixel,
    // Centred on the world origin, so it lands in view at any size.
    origin: {
      x: -(raster.sourceWidth * metresPerPixel) / 2,
      z: -(raster.sourceHeight * metresPerPixel) / 2,
    },
    opacity: BLUEPRINT_DEFAULTS.opacity,
    visible: true,
    // `source: 'none'` — the weakest rank, so any real measurement can replace
    // it. A freshly loaded image has not been measured by anyone, and saying
    // so is what lets the panel warn rather than imply a scale it does not have.
    calibration: uncalibrated(metresPerPixel, new Date().toISOString()),
  })

  return { ok: true, raster }
}

/** Whether a picked file looks like an image rather than a project file. */
export function isImageFile(file: File): boolean {
  // Some browsers hand over an empty type for a drag-dropped file, so the
  // extension is the fallback rather than the primary test.
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)
}
