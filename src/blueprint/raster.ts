/**
 * Longest edge, in pixels, that wall detection is allowed to run on.
 *
 * Detection is O(pixels) with a couple of full passes, so a 12-megapixel phone
 * photo of a drawing would stall the tab for seconds. Downscaling first costs
 * a little precision on hairlines and buys an interactive import.
 */
export const MAX_RASTER_DIMENSION = 2000

/** A decoded image plus the object URL keeping it alive. */
export type DecodedImage = {
  element: HTMLImageElement
  /** Intrinsic pixel size, before any downscaling. */
  width: number
  height: number
  /** Frees the object URL. Safe to call twice. */
  release: () => void
}

export type DecodeResult =
  | { ok: true; image: DecodedImage }
  | { ok: false; error: string }

export type Raster = {
  image: ImageData
  /**
   * Raster pixels per source pixel — 1 unless the image was downscaled.
   * Divide a source-space metres-per-pixel by this to get the raster's.
   */
  scale: number
  sourceWidth: number
  sourceHeight: number
}

export type RasterResult =
  | { ok: true; raster: Raster }
  | { ok: false; error: string }

/**
 * Decodes a user-chosen file into an image element.
 *
 * The caller must `release()` when done; the object URL is otherwise pinned
 * for the life of the document.
 */
export function decodeImageFile(file: File): Promise<DecodeResult> {
  if (!file.type.startsWith('image/')) {
    return Promise.resolve({
      ok: false,
      error: 'That file is not an image. Use a PNG, JPG or WebP.',
    })
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    let released = false
    const release = () => {
      if (released) return
      released = true
      URL.revokeObjectURL(url)
    }

    const element = new Image()

    element.onload = () => {
      if (element.naturalWidth < 1 || element.naturalHeight < 1) {
        release()
        resolve({ ok: false, error: 'That image has no pixels.' })
        return
      }
      resolve({
        ok: true,
        image: {
          element,
          width: element.naturalWidth,
          height: element.naturalHeight,
          release,
        },
      })
    }

    element.onerror = () => {
      release()
      resolve({ ok: false, error: 'That image could not be decoded.' })
    }

    element.src = url
  })
}

/**
 * Draws a decoded image to an offscreen canvas and reads its pixels back,
 * shrinking it to fit `maxDimension` first.
 */
export function rasterise(
  image: DecodedImage,
  maxDimension = MAX_RASTER_DIMENSION,
): RasterResult {
  const longest = Math.max(image.width, image.height)
  const scale = longest > maxDimension ? maxDimension / longest : 1
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return { ok: false, error: 'This browser cannot read image pixels.' }
  }

  // Anything not covered by the image reads as blank paper, not black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image.element, 0, 0, width, height)

  let data: ImageData
  try {
    data = ctx.getImageData(0, 0, width, height)
  } catch {
    return { ok: false, error: 'This image is not readable by the page.' }
  }

  return {
    ok: true,
    raster: {
      image: data,
      scale: width / image.width,
      sourceWidth: image.width,
      sourceHeight: image.height,
    },
  }
}

/** Decode-and-rasterise in one call, releasing the object URL either way. */
export async function rasterFromFile(
  file: File,
  maxDimension = MAX_RASTER_DIMENSION,
): Promise<RasterResult> {
  const decoded = await decodeImageFile(file)
  if (!decoded.ok) return decoded

  try {
    return rasterise(decoded.image, maxDimension)
  } finally {
    decoded.image.release()
  }
}
