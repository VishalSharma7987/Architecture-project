import { BLUEPRINT_DEFAULTS, useDesignStore } from '../store/useDesignStore'
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
