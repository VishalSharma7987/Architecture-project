/**
 * Separating ANNOTATION ink from STRUCTURE ink, before the detector runs.
 *
 * ── The measured defect this addresses (B39, STATE.md finding 59) ──
 * `mergeWallFaces` fuses two parallel bands into one wall when their combined
 * extent fits inside `maxThicknessPx`. It has no test on the GAP between
 * them. So a dimension chain running parallel to a shell wall, at a similar
 * length, within `maxThicknessPx` of it, is fused INTO that wall — and the
 * fused band, now far thicker than any wall, is then dropped by `keep()`.
 *
 * **The wall is destroyed by its own dimension line.** Measured on the
 * synthetic fixture: at 104 px/m the detector returns 0 of 7 walls and finds
 * only a furniture outline; at 26 px/m it returns 7 of 7 — because there the
 * dimension line is 1 px, falls below `minThicknessPx`, and never becomes a
 * band to fuse with. The detector succeeds on the degraded drawing for the
 * wrong reason, and fails on the good one.
 *
 * This is SD4(b) again — `mergeWallFaces` fusing a partition with a door's
 * swing arc and reporting 0.64 m — with a different partner and the opposite
 * resolution dependence.
 *
 * ── Why a mask filter and not a fix inside the fusion ──
 * §3 protects `detectWalls.ts`'s binarisation structure and §10 rule 9 pins
 * the `mergeWallFaces` → `typicalThickness` ordering. This runs BEFORE any of
 * it, on the mask, and can be deleted without changing a line upstream. The
 * fusion still needs its own guard eventually; that is its own session and
 * its argued reason is now recorded.
 *
 * ── The threshold is DERIVED, never picked ──
 * §10 rule 6: the only fixture available is synthetic, so no number here may
 * be tuned to it. The split comes from the image's own stroke-width
 * distribution — annotation and structure differ by a large MULTIPLICATIVE
 * factor (1–2 px against 12–24 px), so the cut goes at the widest ratio gap
 * between width families that each carry real ink. A drawing whose
 * annotation is as thick as its walls has no such gap and nothing is
 * removed, which is the honest outcome.
 */

/** Ink pixels below this share of total ink are noise, not a family. */
const FAMILY_INK_SHARE = 0.03

/**
 * A ratio gap smaller than this is not a family boundary — it is the spread
 * within one family (a 12 px wall measuring 11–13 px along its length).
 * Two strokes that differ by less than half again are the same kind of line.
 */
const MIN_FAMILY_RATIO = 1.5

export type StrokeProfile = {
  /** Ink pixel count per local stroke width, index = width in pixels. */
  histogram: Uint32Array
  /** Widths carrying at least `FAMILY_INK_SHARE` of the ink, ascending. */
  families: number[]
  /** Widths strictly below this are annotation. 0 when nothing is removed. */
  floor: number
  totalInk: number
}

/**
 * Local stroke width at every ink pixel: the SMALLER of its horizontal and
 * vertical run lengths.
 *
 * The smaller of the two is what makes this a width rather than a length — a
 * 936 × 24 px wall band has a horizontal run of 936 and a vertical run of 24
 * at every interior pixel, and 24 is its thickness. A simplified stroke-width
 * transform, restricted to the two axes because every wall this detector can
 * find is axis-aligned anyway.
 */
export function strokeWidthMap(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint16Array {
  const horizontal = new Uint16Array(mask.length)
  const vertical = new Uint16Array(mask.length)

  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      const row = y * width
      if (!mask[row + x]) {
        x++
        continue
      }
      let end = x
      while (end + 1 < width && mask[row + end + 1]) end++
      const run = end - x + 1
      for (let i = x; i <= end; i++) horizontal[row + i] = run
      x = end + 1
    }
  }

  for (let x = 0; x < width; x++) {
    let y = 0
    while (y < height) {
      if (!mask[y * width + x]) {
        y++
        continue
      }
      let end = y
      while (end + 1 < height && mask[(end + 1) * width + x]) end++
      const run = end - y + 1
      for (let i = y; i <= end; i++) vertical[i * width + x] = run
      y = end + 1
    }
  }

  const widths = new Uint16Array(mask.length)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    widths[i] = Math.min(horizontal[i], vertical[i])
  }
  return widths
}

/**
 * The stroke-width families in a mask, and where annotation ends.
 *
 * The floor is the LOWEST width of the family above the widest ratio gap —
 * so everything below the gap is removed and everything above it is kept.
 * When no gap clears `MIN_FAMILY_RATIO` the drawing draws its annotation at
 * wall weight, and the floor is 0: nothing is removed and the caller is no
 * worse off than before.
 */
export function strokeProfile(widths: Uint16Array): StrokeProfile {
  let max = 0
  for (let i = 0; i < widths.length; i++) if (widths[i] > max) max = widths[i]

  const histogram = new Uint32Array(max + 1)
  let totalInk = 0
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] === 0) continue
    histogram[widths[i]]++
    totalInk++
  }
  if (totalInk === 0) {
    return { histogram, families: [], floor: 0, totalInk: 0 }
  }

  const families: number[] = []
  for (let w = 1; w <= max; w++) {
    if (histogram[w] / totalInk >= FAMILY_INK_SHARE) families.push(w)
  }
  if (families.length < 2) {
    return { histogram, families, floor: 0, totalInk }
  }

  let bestRatio = MIN_FAMILY_RATIO
  let floor = 0
  for (let i = 0; i < families.length - 1; i++) {
    const ratio = families[i + 1] / families[i]
    if (ratio > bestRatio) {
      bestRatio = ratio
      floor = families[i + 1]
    }
  }

  return { histogram, families, floor, totalInk }
}

export type StrippedInk = {
  mask: Uint8Array
  profile: StrokeProfile
  /** Ink pixels removed as annotation. */
  removed: number
}

/**
 * The mask with annotation ink removed.
 *
 * Returns the ORIGINAL mask when the profile finds no gap, so a drawing this
 * cannot help is passed through untouched rather than damaged — the same
 * fail-safe `weldJoints` and `patchWall` use for the same reason.
 */
export function stripAnnotationInk(
  mask: Uint8Array,
  width: number,
  height: number,
): StrippedInk {
  const widths = strokeWidthMap(mask, width, height)
  const profile = strokeProfile(widths)
  if (profile.floor <= 1) return { mask, profile, removed: 0 }

  const stripped = new Uint8Array(mask.length)
  let removed = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    if (widths[i] >= profile.floor) stripped[i] = 1
    else removed++
  }
  return { mask: stripped, profile, removed }
}

/**
 * The drawing with its annotation painted out, ready for the detector.
 *
 * Whitening the IMAGE rather than handing the detector a mask is what keeps
 * `detectWalls.ts` untouched (§3): its four-way binarisation still reads a
 * picture and still chooses its own candidates, and every threshold it sizes
 * from the image is sized from an image of the same dimensions. Removing
 * this call restores the previous behaviour exactly.
 */
export function stripAnnotationFromImage(
  image: RasterLike,
  ink: (image: RasterLike) => Uint8Array,
): { image: RasterLike; profile: StrokeProfile; removed: number } {
  const mask = ink(image)
  const result = stripAnnotationInk(mask, image.width, image.height)
  if (result.removed === 0) {
    return { image, profile: result.profile, removed: 0 }
  }

  const data = new Uint8ClampedArray(image.data)
  for (let i = 0; i < mask.length; i++) {
    // Only ink the strip rejected: paper is already paper, and a pixel the
    // binarisation never called ink is none of this function's business.
    if (!mask[i] || result.mask[i]) continue
    data[i * 4] = 255
    data[i * 4 + 1] = 255
    data[i * 4 + 2] = 255
  }
  return {
    image: { data, width: image.width, height: image.height },
    profile: result.profile,
    removed: result.removed,
  }
}

/** Structural shape of an ImageData, matching `detectWalls.ts`'s `RasterLike`. */
type RasterLike = { data: Uint8ClampedArray; width: number; height: number }
