import type { Point } from '../store/useDesignStore'

/**
 * An axis-aligned wall found in a blueprint image.
 *
 * Endpoints are in IMAGE PIXEL coordinates, using the convention that pixel
 * `i` covers `[i, i + 1)`. A stroke painted from x=200 to x=1400 lights up
 * pixels 200..1399 and comes back as `x1 = 200, x2 = 1400`, so the numbers
 * line up with the drawing rather than with the sample grid.
 */
export type PixelSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Wall thickness in pixels. */
  thickness: number
}

/**
 * Tuning for {@link detectWallSegments}. Every value is in pixels or a
 * dimensionless ratio; the detector never needs to know the drawing's scale.
 */
export type DetectOptions = {
  /** Shortest run of ink that can be part of a wall. */
  minLengthPx?: number
  /** Hard floor on wall thickness — kills grid and dimension hairlines. */
  minThicknessPx?: number
  /** Hard ceiling — kills filled title blocks and large solid blobs. */
  maxThicknessPx?: number
  /** Shortest length-to-thickness ratio a wall may have. */
  minAspect?: number
  /** Fraction of the band's footprint that must actually be ink. */
  minFillRatio?: number
  /** Drop walls thinner than this fraction of the drawing's typical wall. */
  thicknessFloorRatio?: number
  /** Bridge gaps (doors) up to this many wall thicknesses long. */
  gapThicknessFactor?: number
  /** Slack when testing whether an endpoint lands inside a crossing wall. */
  junctionTolerancePx?: number
  /** Drop walls that meet no other wall. Turn off for freestanding plans. */
  requireJunction?: boolean
}

/**
 * Defaults tuned against `samples/blueprint-*.png` (100 px per metre).
 *
 * They are deliberately expressed relative to the detected walls themselves
 * wherever possible, because the only scale reference an unknown drawing
 * offers is how thick its own walls are.
 */
export const DEFAULT_DETECT_OPTIONS = {
  minLengthPx: 40,
  minThicknessPx: 3,
  maxThicknessPx: 120,
  minAspect: 6,
  minFillRatio: 0.6,
  thicknessFloorRatio: 0.4,
  gapThicknessFactor: 12,
  junctionTolerancePx: 2,
  requireJunction: true,
}

/**
 * Longest edge the pixel defaults above were tuned against. Anything else is
 * scaled from here — see {@link sizedDefaults}.
 */
const REFERENCE_LONGEST_PX = 2000

/**
 * The pixel thresholds, restated for the image actually being read.
 *
 * A wall's thickness in pixels is a function of how large the drawing was
 * rendered, not of the building — the same house at 600 px and at 3000 px draws
 * walls five times apart. Fixed pixel minimums therefore silently reject every
 * smaller drawing, which is the single most common reason a plan "isn't read".
 * Scaling them by the image's longest edge makes one set of numbers describe
 * both, and leaves the ratios (aspect, fill, gap) alone since those are already
 * dimensionless.
 *
 * The floors are not scaled away entirely: below about two pixels there is no
 * band left to measure, however small the drawing.
 */
function sizedDefaults(image: RasterLike): typeof DEFAULT_DETECT_OPTIONS {
  const longest = Math.max(image.width, image.height)
  const k = longest / REFERENCE_LONGEST_PX

  return {
    ...DEFAULT_DETECT_OPTIONS,
    minLengthPx: Math.max(12, DEFAULT_DETECT_OPTIONS.minLengthPx * k),
    minThicknessPx: Math.max(2, DEFAULT_DETECT_OPTIONS.minThicknessPx * k),
    maxThicknessPx: Math.max(24, DEFAULT_DETECT_OPTIONS.maxThicknessPx * k),
    junctionTolerancePx: Math.max(
      2,
      DEFAULT_DETECT_OPTIONS.junctionTolerancePx * k,
    ),
  }
}

/**
 * Longest edge the pixel defaults above were tuned against. Anything else is
 * scaled from here — see {@link sizedDefaults}.
 */
const REFERENCE_LONGEST_PX = 2000

/**
 * The pixel thresholds, restated for the image actually being read.
 *
 * A wall's thickness in pixels is a function of how large the drawing was
 * rendered, not of the building — the same house at 600 px and at 3000 px draws
 * walls five times apart. Fixed pixel minimums therefore silently reject every
 * smaller drawing, which is the single most common reason a plan "isn't read".
 * Scaling them by the image's longest edge makes one set of numbers describe
 * both, and leaves the ratios (aspect, fill, gap) alone since those are already
 * dimensionless.
 *
 * The floors are not scaled away entirely: below about two pixels there is no
 * band left to measure, however small the drawing.
 */
function sizedDefaults(image: RasterLike): typeof DEFAULT_DETECT_OPTIONS {
  const longest = Math.max(image.width, image.height)
  const k = longest / REFERENCE_LONGEST_PX

  return {
    ...DEFAULT_DETECT_OPTIONS,
    minLengthPx: Math.max(12, DEFAULT_DETECT_OPTIONS.minLengthPx * k),
    minThicknessPx: Math.max(2, DEFAULT_DETECT_OPTIONS.minThicknessPx * k),
    maxThicknessPx: Math.max(24, DEFAULT_DETECT_OPTIONS.maxThicknessPx * k),
    junctionTolerancePx: Math.max(
      2,
      DEFAULT_DETECT_OPTIONS.junctionTolerancePx * k,
    ),
  }
}

/** An ImageData in all but name, so the detector runs outside a browser too. */
export type RasterLike = {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * Otsu's threshold: the grey level that best splits a histogram into two
 * classes. Chosen over a fixed threshold because scans, photos and inverted
 * blueprints all sit at wildly different exposures.
 */
export function otsuThreshold(histogram: Uint32Array): number {
  let total = 0
  let sum = 0
  for (let t = 0; t < 256; t++) {
    total += histogram[t]
    sum += t * histogram[t]
  }
  if (total === 0) return 127

  let weightBelow = 0
  let sumBelow = 0
  let best = -1
  let threshold = 127

  for (let t = 0; t < 256; t++) {
    weightBelow += histogram[t]
    if (weightBelow === 0) continue
    const weightAbove = total - weightBelow
    if (weightAbove === 0) break

    sumBelow += t * histogram[t]
    const meanBelow = sumBelow / weightBelow
    const meanAbove = (sum - sumBelow) / weightAbove
    const spread = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2

    if (spread > best) {
      best = spread
      threshold = t
    }
  }

  return threshold
}

/**
 * Reduces a raster to a 1-bit "is this pixel ink" mask.
 *
 * Polarity is decided by area: if the dark class covers more than half the
 * sheet the drawing must be light-on-dark, so the mask is inverted. That is
 * what lets a white-on-blue blueprint work with no user setting.
 */
export function inkMask(image: RasterLike): Uint8Array {
  const { data, width, height } = image
  const count = width * height
  const grey = new Uint8Array(count)
  const histogram = new Uint32Array(256)

  for (let i = 0; i < count; i++) {
    const o = i * 4
    const alpha = data[o + 3] / 255
    // Composite over white so a transparent PNG reads as blank paper.
    const luma = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    const value = Math.round(luma * alpha + 255 * (1 - alpha))
    grey[i] = value
    histogram[value]++
  }

  const threshold = otsuThreshold(histogram)

  let dark = 0
  for (let t = 0; t <= threshold; t++) dark += histogram[t]
  const invert = dark > count / 2

  const mask = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const isDark = grey[i] <= threshold
    mask[i] = (invert ? !isDark : isDark) ? 1 : 0
  }

  return mask
}

/**
 * Reduces a raster to "is this pixel unlike the paper" — a colour-aware
 * companion to {@link inkMask}.
 *
 * Lightness alone cannot separate a printed plan from a coloured one: flatten a
 * rust-orange wall and a pale grid line to grey and they can land on the same
 * value, and a plan whose rooms are flooded with tan sits so close to its own
 * walls that one global cut swallows both. Measuring distance from the sheet's
 * own dominant colour instead keeps hue in play, so "wall" means "unlike the
 * paper" whatever colour either happens to be — and a tinted or inverted sheet
 * needs no special case, since its own background is the reference.
 */
export function paperContrastMasks(image: RasterLike): Uint8Array[] {
  const { data, width, height } = image
  const count = width * height

  // Dominant colour = the paper. Quantised to 5 bits a channel so that the
  // near-identical pixels of a scan or a JPEG count as one colour rather than
  // scattering across thousands of buckets.
  const buckets = new Uint32Array(32 * 32 * 32)
  const rgb = new Uint8Array(count * 3)

  for (let i = 0; i < count; i++) {
    const o = i * 4
    const alpha = data[o + 3] / 255
    // Composite over white, so transparent padding reads as blank paper.
    const r = Math.round(data[o] * alpha + 255 * (1 - alpha))
    const g = Math.round(data[o + 1] * alpha + 255 * (1 - alpha))
    const b = Math.round(data[o + 2] * alpha + 255 * (1 - alpha))
    rgb[i * 3] = r
    rgb[i * 3 + 1] = g
    rgb[i * 3 + 2] = b
    buckets[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)]++
  }

  let modeIndex = 0
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i] > buckets[modeIndex]) modeIndex = i
  }
  // Centre of the winning bucket, so the reference is not biased to its corner.
  const paperR = (((modeIndex >> 10) & 31) << 3) + 4
  const paperG = (((modeIndex >> 5) & 31) << 3) + 4
  const paperB = ((modeIndex & 31) << 3) + 4

  const paperLuma = 0.299 * paperR + 0.587 * paperG + 0.114 * paperB

  // Three readings off the same reference, gathered in one pass.
  //
  // `distance` alone is not enough. On a plan whose rooms are flooded with
  // colour the floor becomes the dominant tone, so the paper reference lands on
  // the FILL — and then both the walls and the white margin around the drawing
  // count as "far from paper", fusing the sheet into one blob. Splitting by
  // direction rescues it: against a tan floor the walls are the darker side and
  // the margin the lighter one, and each is a clean reading on its own.
  const distance = new Uint8Array(count)
  const luma = new Uint8Array(count)
  const distHistogram = new Uint32Array(256)
  const darkHistogram = new Uint32Array(256)
  const lightHistogram = new Uint32Array(256)

  for (let i = 0; i < count; i++) {
    const r = rgb[i * 3]
    const g = rgb[i * 3 + 1]
    const b = rgb[i * 3 + 2]
    // Chebyshev distance: one channel differing enough is what makes a colour
    // read as different, and it needs no square root per pixel.
    const d = Math.max(
      Math.abs(r - paperR),
      Math.abs(g - paperG),
      Math.abs(b - paperB),
    )
    distance[i] = d
    distHistogram[d]++

    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    luma[i] = l
    if (l < paperLuma) darkHistogram[l]++
    else if (l > paperLuma) lightHistogram[l]++
  }

  const masks: Uint8Array[] = []

  const distThreshold = otsuThreshold(distHistogram)
  const byDistance = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    byDistance[i] = distance[i] > distThreshold ? 1 : 0
  }
  masks.push(byDistance)

  // Both directional masks also demand real separation from the paper, not
  // merely the right side of it.
  //
  // Without that they select the SHEET. The paper reference is quantised to
  // five bits a channel, so on a white drawing it lands at 252 rather than 255
  // — and every pure-white pixel is then "lighter than the paper", which is
  // 95% of the image. On a plain sheet that blob is rejected downstream for
  // being far too thick, so the fault stayed invisible; but on a drawing with a
  // grid, the grid lines SLICE the white field into long thin strips with
  // excellent aspect ratios, and `scoreSegments` — which maximises total
  // detected length — then prefers 75 imaginary walls totalling 77,592 px over
  // 7 real ones totalling 6,300. Both the gridded and the inverted fixture
  // detected zero real walls because of this.
  //
  // Reusing `distThreshold` is the right bound: it is already the Otsu split
  // between "this is the paper" and "this is something drawn on it", so a
  // directional mask that also clears it keeps exactly the rescue it was added
  // for — a colour-flooded plan where the walls are the dark side of a tinted
  // floor — while excluding the floor and the margin themselves.
  const farFromPaper = (i: number) => distance[i] > distThreshold

  // Ink darker than the paper — the ordinary case, and the one that recovers a
  // colour-flooded plan whose walls are the darkest thing on the sheet.
  if (histogramTotal(darkHistogram) > 0) {
    const t = otsuThreshold(darkHistogram)
    const darker = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      darker[i] = luma[i] <= t && luma[i] < paperLuma && farFromPaper(i) ? 1 : 0
    }
    masks.push(darker)
  }

  // Ink lighter than the paper — a reversed sheet, or pale walls drawn over a
  // dark floor tint.
  if (histogramTotal(lightHistogram) > 0) {
    const t = otsuThreshold(lightHistogram)
    const lighter = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      lighter[i] = luma[i] >= t && luma[i] > paperLuma && farFromPaper(i) ? 1 : 0
    }
    masks.push(lighter)
  }

  return masks
}

/** Total samples in a histogram — used to skip an empty side. */
function histogramTotal(histogram: Uint32Array): number {
  let total = 0
  for (let i = 0; i < histogram.length; i++) total += histogram[i]
  return total
}

/** Mask laid out so that `u` runs along the wall and `v` across it. */
type Oriented = {
  mask: Uint8Array
  along: number
  across: number
}

/** A candidate wall in oriented (u, v) space. */
type Band = {
  uMin: number
  uMax: number
  vMin: number
  vMax: number
  centre: number
  thickness: number
  fill: number
}

function transpose(mask: Uint8Array, width: number, height: number) {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) out[x * height + y] = mask[row + x]
  }
  return out
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Measures a band from the mask rather than from the runs that built it.
 *
 * Two things are deliberately medians, not extremes. Thickness is the median
 * ink height over the band's slices, so a window frame jutting a pixel past
 * the wall face cannot inflate it. And the ends are trimmed back to where the
 * band is still wall-thick, so a dimension line running into a wall does not
 * stretch it — that tail is one stroke wide, nothing like a wall.
 */
function measure(
  o: Oriented,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): Band | null {
  const counts: number[] = []
  const centres: number[] = []

  for (let u = uMin; u <= uMax; u++) {
    let first = -1
    let last = -1
    let ink = 0
    for (let v = vMin; v <= vMax; v++) {
      if (!o.mask[v * o.along + u]) continue
      if (first < 0) first = v
      last = v
      ink++
    }
    counts.push(ink)
    centres.push(ink === 0 ? NaN : (first + last + 1) / 2)
  }

  const solid = counts.filter((c) => c > 0)
  if (solid.length === 0) return null

  const half = median(solid) / 2
  let lo = 0
  let hi = counts.length - 1
  while (lo <= hi && counts[lo] < half) lo++
  while (hi >= lo && counts[hi] < half) hi--
  if (hi < lo) return null

  const span = counts.slice(lo, hi + 1)
  const thickness = median(span.filter((c) => c > 0))
  const total = span.reduce((a, c) => a + c, 0)
  const mids = centres.slice(lo, hi + 1).filter((c) => Number.isFinite(c))

  return {
    uMin: uMin + lo,
    uMax: uMin + hi,
    vMin,
    vMax,
    centre: median(mids),
    thickness,
    fill: total / (span.length * thickness),
  }
}

/** Disjoint-set roots, flattened as we go. */
function findRoot(parent: Int32Array, i: number): number {
  let root = i
  while (parent[root] !== root) root = parent[root]
  let walk = i
  while (parent[walk] !== root) {
    const next = parent[walk]
    parent[walk] = root
    walk = next
  }
  return root
}

/**
 * Groups long ink runs into bands.
 *
 * The length filter runs BEFORE grouping, and that is the whole trick: at a
 * corner, the crossing wall contributes a run only as long as it is thick, so
 * discarding short runs stops a band from leaking down the wall it meets.
 */
function findBands(o: Oriented, minLengthPx: number): Band[] {
  const u0: number[] = []
  const u1: number[] = []
  const rowStart: number[] = []
  const rowOf: number[] = []

  for (let v = 0; v < o.across; v++) {
    rowStart.push(u0.length)
    const row = v * o.along
    let u = 0
    while (u < o.along) {
      if (!o.mask[row + u]) {
        u++
        continue
      }
      let end = u
      while (end + 1 < o.along && o.mask[row + end + 1]) end++
      if (end - u + 1 >= minLengthPx) {
        u0.push(u)
        u1.push(end)
        rowOf.push(v)
      }
      u = end + 1
    }
  }
  rowStart.push(u0.length)

  const parent = new Int32Array(u0.length)
  for (let i = 0; i < parent.length; i++) parent[i] = i

  for (let v = 1; v < o.across; v++) {
    let a = rowStart[v - 1]
    let b = rowStart[v]
    const endA = rowStart[v]
    const endB = rowStart[v + 1]
    while (a < endA && b < endB) {
      if (u0[a] <= u1[b] && u0[b] <= u1[a]) {
        const ra = findRoot(parent, a)
        const rb = findRoot(parent, b)
        if (ra !== rb) parent[ra] = rb
      }
      // Advance whichever run ends first; both lists are sorted by u0.
      if (u1[a] < u1[b]) a++
      else b++
    }
  }

  const boxes = new Map<number, [number, number, number, number]>()
  for (let i = 0; i < u0.length; i++) {
    const root = findRoot(parent, i)
    const box = boxes.get(root)
    if (!box) {
      boxes.set(root, [u0[i], u1[i], rowOf[i], rowOf[i]])
      continue
    }
    if (u0[i] < box[0]) box[0] = u0[i]
    if (u1[i] > box[1]) box[1] = u1[i]
    if (rowOf[i] < box[2]) box[2] = rowOf[i]
    if (rowOf[i] > box[3]) box[3] = rowOf[i]
  }

  const bands: Band[] = []
  for (const [uLo, uHi, vLo, vHi] of boxes.values()) {
    const band = measure(o, uLo, uHi, vLo, vHi)
    if (band) bands.push(band)
  }
  return bands
}

/**
 * Rejoins collinear bands split by a door.
 *
 * Our model hangs openings ON a wall instead of splitting it, so a wall
 * interrupted by a door must come back as one segment. The gap budget scales
 * with thickness because that is the only in-drawing clue to how big a metre
 * is: a door is a handful of wall thicknesses wide at any scale.
 */
function mergeCollinear(
  o: Oriented,
  bands: Band[],
  gapThicknessFactor: number,
): Band[] {
  const parent = new Int32Array(bands.length)
  for (let i = 0; i < parent.length; i++) parent[i] = i

  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i]
      const b = bands[j]
      const thin = Math.min(a.thickness, b.thickness)
      const thick = Math.max(a.thickness, b.thickness)
      if (thin / thick < 0.5) continue
      if (Math.abs(a.centre - b.centre) > Math.max(2, thin / 2)) continue

      const gap = Math.max(b.uMin - a.uMax, a.uMin - b.uMax) - 1
      if (gap > gapThicknessFactor * thick) continue

      const ra = findRoot(parent, i)
      const rb = findRoot(parent, j)
      if (ra !== rb) parent[ra] = rb
    }
  }

  const groups = new Map<number, Band[]>()
  for (let i = 0; i < bands.length; i++) {
    const root = findRoot(parent, i)
    const group = groups.get(root)
    if (group) group.push(bands[i])
    else groups.set(root, [bands[i]])
  }

  const merged: Band[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0])
      continue
    }
    let uMin = Infinity
    let uMax = -Infinity
    let vMin = Infinity
    let vMax = -Infinity
    for (const b of group) {
      uMin = Math.min(uMin, b.uMin)
      uMax = Math.max(uMax, b.uMax)
      vMin = Math.min(vMin, b.vMin)
      vMax = Math.max(vMax, b.vMax)
    }
    const band = measure(o, uMin, uMax, vMin, vMax)
    if (band) merged.push(band)
  }
  return merged
}

/** True when `end` falls inside the cross-section of the crossing band. */
function touches(end: number, band: Band, tolerance: number) {
  const half = band.thickness / 2 + tolerance
  return end >= band.centre - half && end <= band.centre + half
}

/**
 * Pulls wall ends onto the centreline of the wall they run into.
 *
 * A horizontal band physically reaches the OUTER face of the vertical wall it
 * meets, so it overshoots by half that wall's thickness. Our design model
 * joins walls at their centrelines, and the crossing band knows where its
 * centreline is — so snap to it instead of guessing.
 */
function snapJunctions(
  bands: Band[],
  crossing: Band[],
  tolerance: number,
): Band[] {
  return bands.map((band) => {
    let start = band.uMin
    let end = band.uMax + 1

    for (const other of crossing) {
      const spans =
        band.centre >= other.uMin - tolerance &&
        band.centre <= other.uMax + 1 + tolerance
      if (!spans) continue
      if (touches(start, other, tolerance)) start = other.centre
      if (touches(end, other, tolerance)) end = other.centre
    }

    return { ...band, uMin: start, uMax: end - 1 }
  })
}

/**
 * True when the band crosses at least one perpendicular band.
 *
 * Walls in a plan form a connected network; a scale bar, a north arrow or a
 * title block floats on its own outside the footprint. That is the one cue
 * that separates them reliably once they happen to be the right shape.
 */
function hasJunction(band: Band, crossing: Band[], slack: number) {
  return crossing.some((other) => {
    const a = slack + band.thickness / 2
    const b = slack + other.thickness / 2
    return (
      band.centre >= other.uMin - a &&
      band.centre <= other.uMax + 1 + a &&
      other.centre >= band.uMin - b &&
      other.centre <= band.uMax + 1 + b
    )
  })
}

/**
 * The thickness a wall in this drawing "normally" has.
 *
 * Length-weighted, because a door leaf or a swing arc is the same shape as a
 * short thin wall and only its share of the plan tells them apart. Bands vote
 * in proportion to their length, so annotation barely gets a say.
 */
/**
 * Fuses the two faces of one wall back into a single band.
 *
 * Architectural plans very often draw a wall as an outline — two thin parallel
 * lines with hatching or a tint between them — rather than as a solid black
 * band. Read literally that is two walls a few centimetres apart, which is what
 * puts a doubled, hollow shell in the 3D view: every wall built twice with a
 * slot down the middle.
 *
 * A pair is fused when it looks like one wall seen from both sides: the two
 * bands run alongside each other, they are of similar weight (a wall's faces are
 * drawn with the same pen), and the whole thing from outer face to outer face is
 * still thin enough to BE a wall. That last test is what stops two genuinely
 * separate walls — the sides of a corridor, say — being welded into one solid
 * block: their span is far wider than any wall.
 */
function mergeWallFaces(bands: Band[], maxThicknessPx: number): Band[] {
  if (bands.length < 2) return bands

  const order = [...bands].sort((a, b) => a.centre - b.centre)
  const used = new Array<boolean>(order.length).fill(false)
  const out: Band[] = []

  for (let i = 0; i < order.length; i++) {
    if (used[i]) continue
    const a = order[i]
    let merged: Band | null = null

    for (let j = i + 1; j < order.length; j++) {
      if (used[j]) continue
      const b = order[j]

      // Outer face to outer face. Past the ceiling there is no wall thick
      // enough for these to be two sides of it, and since the list is sorted by
      // centre no later band can be closer either.
      const span = Math.max(a.vMax, b.vMax) - Math.min(a.vMin, b.vMin) + 1
      if (span > maxThicknessPx) break

      // Both faces of one wall are drawn with the same weight; a thin line
      // running beside a thick wall is a different thing (a dimension line, a
      // kerb) and must not be absorbed into it.
      const ratio = a.thickness / b.thickness
      if (ratio < 0.5 || ratio > 2) continue

      // And they have to actually run together, not merely pass nearby.
      const aLength = a.uMax - a.uMin + 1
      const bLength = b.uMax - b.uMin + 1
      const overlap = Math.min(a.uMax, b.uMax) - Math.max(a.uMin, b.uMin) + 1
      const shorter = Math.min(aLength, bLength)
      if (overlap < shorter * FACE_OVERLAP_RATIO) continue

      // Two faces of one wall run its WHOLE length together — they are the
      // same line drawn twice. Overlap alone does not say that: a short band
      // lying entirely alongside a long one is fully overlapped by it while
      // being nothing to do with it.
      //
      // On the simple fixture that short band is a door's quarter-circle swing
      // arc, 98 px of near-vertical curve beside a 500 px partition. It passed
      // every other test — the span to its outer edge was 64 px, under the
      // 96 px ceiling, and the two had similar pen weights — so the partition
      // came back 0.64 m thick and displaced 0.26 m, five times its real size.
      // A wall that wrong flows straight into the 3D model and the cost sheet.
      if (shorter < Math.max(aLength, bLength) * FACE_LENGTH_RATIO) continue

      const vMin = Math.min(a.vMin, b.vMin)
      const vMax = Math.max(a.vMax, b.vMax)
      merged = {
        uMin: Math.min(a.uMin, b.uMin),
        uMax: Math.max(a.uMax, b.uMax),
        vMin,
        vMax,
        centre: (vMin + vMax + 1) / 2,
        thickness: span,
        // The pair describes a solid wall, whatever the drawing put between the
        // faces — hatching, a tint, or nothing at all.
        fill: 1,
      }
      used[j] = true
      break
    }

    used[i] = true
    out.push(merged ?? a)
  }

  return out
}

/** How much of the shorter face must run alongside the other to count as a pair. */
const FACE_OVERLAP_RATIO = 0.5

/**
 * How close in LENGTH two bands must be to be the two faces of one wall.
 *
 * Generous at 0.6, because a real pair is rarely exactly equal: one face may
 * be interrupted by a door the other side of the wall is not, or trimmed by a
 * junction snap. But an arc, a leaf line or a dimension tick beside a long
 * partition is a small fraction of it, and that is what this rejects.
 */
const FACE_LENGTH_RATIO = 0.6

function typicalThickness(bands: Band[]): number {
  const votes: number[] = []
  for (const band of bands) {
    const weight = Math.max(1, Math.round((band.uMax - band.uMin + 1) / 10))
    for (let i = 0; i < weight; i++) votes.push(band.thickness)
  }
  return votes.length > 0 ? median(votes) : 0
}

function keep(band: Band, options: Required<DetectOptions>) {
  const length = band.uMax - band.uMin + 1
  if (length < options.minLengthPx) return false
  if (band.thickness < options.minThicknessPx) return false
  if (band.thickness > options.maxThicknessPx) return false
  if (length / band.thickness < options.minAspect) return false
  return band.fill >= options.minFillRatio
}

/**
 * Finds the axis-aligned walls in a floor-plan raster.
 *
 * Openings are deliberately NOT detected: a door reads as a gap that this
 * function heals, and the user places doors and windows by hand afterwards.
 */
export function detectWallSegments(
  image: RasterLike,
  options: DetectOptions = {},
): PixelSegment[] {
  // Defaults sized to this image; anything the caller passes still wins.
  const opts = { ...sizedDefaults(image), ...options }
  // Defaults sized to this image; anything the caller passes still wins.
  const opts = { ...sizedDefaults(image), ...options }
  const { width, height } = image
  if (width < 2 || height < 2) return []

  // Read the sheet more than one way and keep whichever finds the most wall.
  // No single binarisation covers every drawing: luma-and-Otsu is right for ink
  // on paper, but a plan whose rooms are flooded with a mid-tone colour splits
  // at the wrong level and collapses floor and wall into one blob, while a
  // saturated wall colour can sit at the same lightness as a grid line. Scoring
  // the actual candidates is more honest than guessing the drawing's style up
  // front, and costs one extra pass over an image already in memory.
  let best: PixelSegment[] = []
  let bestScore = -1

  for (const mask of candidateMasks(image)) {
    const segments = segmentsFromMask(mask, width, height, opts)
    const score = scoreSegments(segments)
    if (score > bestScore) {
      bestScore = score
      best = segments
    }
  }

  return best
}

/**
 * How much of a plan a candidate reading found. Total wall length rather than a
 * count, so a reading that recovers one long exterior run beats one that
 * shatters the same wall into fragments.
 */
function scoreSegments(segments: PixelSegment[]): number {
  let total = 0
  for (const s of segments) total += Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
  return total
}

/** The ink readings worth trying, cheapest and most common first. */
function candidateMasks(image: RasterLike): Uint8Array[] {
  return [inkMask(image), ...paperContrastMasks(image)]
}

/** Runs the band pipeline over one ink mask. */
function segmentsFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  opts: typeof DEFAULT_DETECT_OPTIONS,
): PixelSegment[] {
  // Read the sheet more than one way and keep whichever finds the most wall.
  // No single binarisation covers every drawing: luma-and-Otsu is right for ink
  // on paper, but a plan whose rooms are flooded with a mid-tone colour splits
  // at the wrong level and collapses floor and wall into one blob, while a
  // saturated wall colour can sit at the same lightness as a grid line. Scoring
  // the actual candidates is more honest than guessing the drawing's style up
  // front, and costs one extra pass over an image already in memory.
  let best: PixelSegment[] = []
  let bestScore = -1

  for (const mask of candidateMasks(image)) {
    const segments = segmentsFromMask(mask, width, height, opts)
    const score = scoreSegments(segments)
    if (score > bestScore) {
      bestScore = score
      best = segments
    }
  }

  return best
}

/**
 * How much of a plan a candidate reading found. Total wall length rather than a
 * count, so a reading that recovers one long exterior run beats one that
 * shatters the same wall into fragments.
 */
function scoreSegments(segments: PixelSegment[]): number {
  let total = 0
  for (const s of segments) total += Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
  return total
}

/** The ink readings worth trying, cheapest and most common first. */
function candidateMasks(image: RasterLike): Uint8Array[] {
  return [inkMask(image), ...paperContrastMasks(image)]
}

/** Runs the band pipeline over one ink mask. */
function segmentsFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  opts: typeof DEFAULT_DETECT_OPTIONS,
): PixelSegment[] {
  const horizontal: Oriented = { mask, along: width, across: height }
  const vertical: Oriented = {
    mask: transpose(mask, width, height),
    along: height,
    across: width,
  }

  const rough = [horizontal, vertical].map((o) =>
    mergeCollinear(
      o,
      findBands(o, opts.minLengthPx).filter(
        (b) =>
          b.thickness >= opts.minThicknessPx &&
          b.thickness <= opts.maxThicknessPx,
      ),
      opts.gapThicknessFactor,
    ).filter((b) => keep(b, opts)),
  )

  // Fuse outlined walls before anything measures thickness: left as pairs, the
  // "typical wall" of a hatched drawing would be the weight of its pen rather
  // than the width of its walls, and every later test would be scaled to that.
  const paired = rough.map((bands) => mergeWallFaces(bands, opts.maxThicknessPx))

  const floor = typicalThickness(paired.flat()) * opts.thicknessFloorRatio
  const walls = paired.map((bands) => bands.filter((b) => b.thickness >= floor))

  let snappedH = snapJunctions(walls[0], walls[1], opts.junctionTolerancePx)
  let snappedV = snapJunctions(walls[1], walls[0], opts.junctionTolerancePx)

  if (opts.requireJunction) {
    const slack = opts.junctionTolerancePx
    const linkedH = snappedH.filter((b) => hasJunction(b, snappedV, slack))
    const linkedV = snappedV.filter((b) => hasJunction(b, snappedH, slack))
    // A plan of one lone wall is still a plan; only prune a real network.
    if (linkedH.length + linkedV.length > 0) {
      snappedH = linkedH
      snappedV = linkedV
    }
  }

  const segments: PixelSegment[] = []
  for (const band of snappedH) {
    segments.push({
      x1: band.uMin,
      y1: band.centre,
      x2: band.uMax + 1,
      y2: band.centre,
      thickness: band.thickness,
    })
  }
  for (const band of snappedV) {
    segments.push({
      x1: band.centre,
      y1: band.uMin,
      x2: band.centre,
      y2: band.uMax + 1,
      thickness: band.thickness,
    })
  }

  return segments
}

/**
 * Maps pixel segments into design space.
 *
 * Image +x becomes world +x and image +y becomes world +z: our plan view is
 * top-down with z running down the screen, so no axis is flipped.
 */
export function segmentsToWalls(
  segments: PixelSegment[],
  transform: { metresPerPixel: number; origin: Point },
): Array<{ start: Point; end: Point; thickness: number }> {
  const { metresPerPixel: scale, origin } = transform

  return segments.map((s) => ({
    start: { x: origin.x + s.x1 * scale, z: origin.z + s.y1 * scale },
    end: { x: origin.x + s.x2 * scale, z: origin.z + s.y2 * scale },
    thickness: s.thickness * scale,
  }))
}
