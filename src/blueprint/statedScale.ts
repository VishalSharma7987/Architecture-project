/**
 * The drawing's STATED scale, typed by the user — §8's missing middle rung
 * (B38).
 *
 * ── What a scale notation is, and what it is not ──
 * "1:100" is a PAPER-to-world ratio. It converts image pixels to metres only
 * through the image's print density (pixels per paper-metre), which a raster
 * file may or may not record: PNG has an optional pHYs chunk, JPEG an
 * optional JFIF density — and both are frequently absent, or filled with the
 * encoder's 72/96 dpi boilerplate that describes no sheet of paper anywhere.
 *
 * So the honest position, stated up front: **a typed scale alone cannot size
 * a raster image.** It sizes one only when the file carries a density that
 * looks deliberate. When it does not, the caller must say so and fall back to
 * measuring a known length — that is a finding about raster images, not a
 * failure of this module.
 *
 * ── The rank it earns: 4.5, between 'ocr' and 'heuristic' ──
 * The ratio half is a USER STATEMENT about the document (the user read it off
 * the sheet), which puts it above every automatic guess — above 'heuristic'
 * (an assumed door width) and far above 'ai'. But the density half is machine
 * metadata the user did not state and nothing cross-checks, where 'ocr'
 * (rank 4) validates itself against the drawing's own pixel geometry three
 * times over. Fractional deliberately: §8's published rank numbers are cited
 * elsewhere ("Gate 2 refuses rank 6"), and renumbering documented ranks is
 * the same citation-rot §10's renumbering already caused once. The ladder
 * compares by order, and 4.5 orders correctly without moving anyone.
 *
 * Gate 2 does NOT admit it: an unverifiable density baked into permanent
 * wall geometry is the exact disaster the gate exists to prevent. A stated
 * scale sizes the UNDERLAY — tracing over it is at true scale — and the
 * panel says detection still needs a measurement.
 */

/** Density values encoders write by default, describing no real sheet. */
const BOILERPLATE_DPI = [72, 96]

export type ImageDensity = {
  /** Pixels per PAPER metre. */
  pixelsPerMetre: number
  /** Where in the file it came from, for the evidence note. */
  kind: 'png-phys' | 'jpeg-jfif'
}

/**
 * Parses a scale notation into its world-per-paper ratio, or null.
 *
 *   "1:100", "1/100", "1 : 50"      → 100, 100, 50
 *   "1:100 MTS" (trailing words ok) → 100
 *   `1/4"=1'`, `1/8"=1'-0"`         → 48, 96   (inches of paper per feet)
 *   "1cm=1m", "5mm=1m"              → 100, 200
 *
 * Ratios at or below zero, non-finite, or absurd (beyond 1:5000 — no
 * building drawing) are null. Enlargements ("2:1") are refused too: a floor
 * plan larger than its building is a detail convention this app does not
 * carry.
 */
export function parseScaleNotation(text: string): number | null {
  const trimmed = text.trim()

  // 1:N / 1/N, with trailing words tolerated ("1:100 MTS.").
  const colon = /^1\s*[:/]\s*(\d+(?:\.\d+)?)(?:\s+[a-z.]+)?\s*$/i.exec(trimmed)
  if (colon) return sane(Number(colon[1]))

  // A"=B' — inches of paper equal feet of world. A may be a fraction.
  const imperial =
    /^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:"|″|in)\s*=\s*(\d+(?:\.\d+)?)\s*(?:'|′|ft)(?:\s*-\s*0\s*(?:"|″))?\s*$/i.exec(
      trimmed,
    )
  if (imperial) {
    const inches = fraction(imperial[1])
    const feet = Number(imperial[2])
    if (inches === null || inches <= 0) return null
    return sane((feet * 12) / inches)
  }

  // Acm=Bm / Amm=Bm — metric equalities.
  const metric =
    /^(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*=\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)\s*$/i.exec(
      trimmed,
    )
  if (metric) {
    const paper = Number(metric[1]) * METRES[metric[2].toLowerCase() as MetricUnit]
    const world = Number(metric[3]) * METRES[metric[4].toLowerCase() as MetricUnit]
    if (paper <= 0) return null
    return sane(world / paper)
  }

  return null
}

type MetricUnit = 'mm' | 'cm' | 'm'
const METRES: Record<MetricUnit, number> = { mm: 0.001, cm: 0.01, m: 1 }

const fraction = (text: string): number | null => {
  const parts = text.split('/')
  if (parts.length === 2) {
    const denominator = Number(parts[1])
    return denominator === 0 ? null : Number(parts[0]) / denominator
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

const sane = (ratio: number): number | null =>
  Number.isFinite(ratio) && ratio >= 1 && ratio <= 5000 ? ratio : null

/**
 * The print density an image file claims, or null when it claims none worth
 * believing.
 *
 * PNG: the pHYs chunk, unit must be metres (unit flag 1). JPEG: the JFIF
 * APP0 density, dpi or dots-per-cm (unit 0 is aspect-ratio-only — no claim
 * at all). Values equal to the 72/96 dpi encoder boilerplate are REJECTED:
 * they are what libraries write when nobody chose anything, and trusting one
 * would size a building off a default. A mismatched X/Y density is rejected
 * too — an anisotropic "print size" is finding 35's stretched drawing, and
 * no single number describes it.
 *
 * CRCs are not validated: this reads metadata from a file the browser
 * already decoded, so a corrupt file never gets this far.
 */
export function readImageDensity(bytes: Uint8Array): ImageDensity | null {
  return readPngDensity(bytes) ?? readJpegDensity(bytes)
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const u32 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]

const u16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] << 8) | bytes[at + 1]

function readPngDensity(bytes: Uint8Array): ImageDensity | null {
  if (bytes.length < 8 + 12) return null
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null

  let at = 8
  while (at + 12 <= bytes.length) {
    const length = u32(bytes, at) >>> 0
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7])
    if (type === 'pHYs' && length === 9 && at + 8 + 9 <= bytes.length) {
      const ppmX = u32(bytes, at + 8) >>> 0
      const ppmY = u32(bytes, at + 12) >>> 0
      const unit = bytes[at + 16]
      // Unit 0 is "aspect ratio only" — a shape, not a size.
      if (unit !== 1 || ppmX === 0 || ppmX !== ppmY) return null
      if (isBoilerplatePpm(ppmX)) return null
      return { pixelsPerMetre: ppmX, kind: 'png-phys' }
    }
    if (type === 'IEND') return null
    at += 12 + length
  }
  return null
}

/** 72 and 96 dpi in pixels-per-metre, with the ±1 the round trip loses. */
const isBoilerplatePpm = (ppm: number): boolean =>
  BOILERPLATE_DPI.some((dpi) => Math.abs(ppm - dpi / 0.0254) <= 2)

function readJpegDensity(bytes: Uint8Array): ImageDensity | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let at = 2
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]
    // Standalone markers carry no length; anything past SOS is entropy data.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) return null
    const length = u16(bytes, at + 2)
    if (marker === 0xe0 && length >= 16 && at + 2 + length <= bytes.length) {
      const p = at + 4
      const isJfif =
        bytes[p] === 0x4a && bytes[p + 1] === 0x46 && bytes[p + 2] === 0x49 &&
        bytes[p + 3] === 0x46 && bytes[p + 4] === 0x00
      if (isJfif) {
        const unit = bytes[p + 7]
        const xDensity = u16(bytes, p + 8)
        const yDensity = u16(bytes, p + 10)
        if (unit === 0 || xDensity === 0 || xDensity !== yDensity) return null
        const pixelsPerMetre = unit === 1 ? xDensity / 0.0254 : xDensity * 100
        if (isBoilerplatePpm(pixelsPerMetre)) return null
        return { pixelsPerMetre, kind: 'jpeg-jfif' }
      }
    }
    at += 2 + length
  }
  return null
}

/**
 * Metres of world per image pixel, from a stated ratio and a claimed density.
 * One pixel is 1/density paper-metres; the ratio turns paper into world.
 */
export const metresPerPixelFromScale = (
  ratio: number,
  density: ImageDensity,
): number => ratio / density.pixelsPerMetre

/* ─── the loaded image's density, transiently ───────────────────────────── */

/**
 * The density of the image currently loaded, or null.
 *
 * Session state, like the calibration picks and `imagesSeen`: it is a fact
 * about the FILE, and a reopened project has the placement but not the
 * pixels, so there would be nothing for a persisted copy to describe. Kept
 * here rather than on `Blueprint` for exactly that reason — and it means B38
 * needs no schema bump and no migration.
 *
 * Written by `blueprint/load.ts`, the one place an image file's bytes arrive,
 * so both the Blueprint panel and the Import menu populate it.
 */
let loadedDensity: ImageDensity | null = null

export const getLoadedDensity = (): ImageDensity | null => loadedDensity

export const setLoadedDensity = (density: ImageDensity | null): void => {
  loadedDensity = density
}
