import { MAX_RASTER_DIMENSION, MIN_RASTER_DIMENSION } from '../src/blueprint/raster'
import type { RasterLike } from '../src/blueprint/detectWalls'

/**
 * `rasterise` without a browser.
 *
 * ── Why this exists ──
 * `blueprint/raster.ts` builds a `<canvas>` and calls `document.createElement`,
 * so it cannot run headless. The corpus harness imported it anyway and would
 * have thrown `ReferenceError: document is not defined` the first time any
 * drawing reached the decode step — which had never happened, because every
 * image in the corpus so far refuses at Gate 1a or Gate 2 first. **The harness
 * was broken on exactly the path it exists to measure, and only a batch that
 * got past Gate 1a revealed it.**
 *
 * ── What it duplicates, and what it must not ──
 * The SCALE RULE is imported from `raster.ts`, not restated: shrink above
 * `MAX_RASTER_DIMENSION`, enlarge below `MIN_RASTER_DIMENSION`, otherwise 1.
 * If those constants move, this moves with them.
 *
 * The RESAMPLE is nearest-neighbour, matching `raster.ts`'s
 * `imageSmoothingEnabled = false` for the enlarging case. It is NOT
 * pixel-identical to a browser's downscale, which filters — so a report from
 * this path is a report about the detector's behaviour on a nearest-neighbour
 * raster, and that is stated wherever the numbers are used rather than
 * quietly assumed away.
 */
export function headlessRaster(
  source: { data: Uint8ClampedArray; width: number; height: number },
  maxDimension = MAX_RASTER_DIMENSION,
): { image: RasterLike; scale: number } {
  const longest = Math.max(source.width, source.height)
  const scale =
    longest > maxDimension
      ? maxDimension / longest
      : longest < MIN_RASTER_DIMENSION
        ? MIN_RASTER_DIMENSION / longest
        : 1

  if (scale === 1) {
    return { image: { data: source.data, width: source.width, height: source.height }, scale: 1 }
  }

  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const data = new Uint8ClampedArray(width * height * 4)

  for (let y = 0; y < height; y++) {
    const sy = Math.min(source.height - 1, Math.floor(y / scale))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(source.width - 1, Math.floor(x / scale))
      const to = (y * width + x) * 4
      const from = (sy * source.width + sx) * 4
      data[to] = source.data[from]
      data[to + 1] = source.data[from + 1]
      data[to + 2] = source.data[from + 2]
      data[to + 3] = source.data[from + 3]
    }
  }

  return { image: { data, width, height }, scale: width / source.width }
}
