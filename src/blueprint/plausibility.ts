import type { CalibrationSource } from '../store/useDesignStore'

/**
 * The gates that decide whether a detected reading is worth believing.
 *
 * ── The evidence these are designed against ──
 * `samples/real-plan-cv-untitled.json` is a user's real project. It reported
 * 3 rooms and 176 sq ft on a 950 sq ft building, and every wall in it came
 * from the detector. Measured:
 *
 *   - the image is 400 px across, covering 11.03 m — **36.3 source px/m**
 *   - `calibration.source` is `'ai'` and `lockedByUser` false: never measured
 *   - 10 distinct thicknesses, 23.6–275.8 mm, 19 of 30 under 90 mm
 *   - every thickness is an exact INTEGER in a raster that `raster.ts`
 *     upscaled ×3.5 — i.e. 0.86 to 10.0 pixels of the actual evidence
 *
 * ── The root cause, and why these gates are shaped as they are ──
 * `MIN_RASTER_DIMENSION` upscales any image under 1400 px, nearest-neighbour,
 * which manufactures pixels without adding information. `sizedDefaults` then
 * scales its pixel thresholds against the MANUFACTURED dimension, so
 * `minThicknessPx` resolves to 2.10 upscaled px = **0.60 source px**. The two
 * mechanisms that exist to make small images work are what let sub-pixel noise
 * through.
 *
 * **Gate 1 therefore measures SOURCE pixels per metre and never raster ones.**
 * This file at raster scale reads 126.9 px/m — better than the 100 px/m the
 * detector's defaults were tuned at. Measured at source it reads 36.3. A gate
 * that looks at the raster passes the very document it exists to reject.
 */

/* ─── Gate 1 — resolution ─────────────────────────────────────────────── */

/**
 * The thinnest wall that must survive detection, in metres.
 *
 * 115 mm is the half-brick partition — universal in Indian residential work
 * and the realistic floor. 75 mm block and 50–60 mm glazed screens exist, but
 * they are the exception and are handled by `MIN_WALL_THICKNESS_M` rather than
 * by weakening this.
 */
export const THINNEST_WALL_M = 0.115

/**
 * Source pixels per metre below which detection is refused, and below which it
 * is warned about.
 *
 * ── Derivation, not a pick ──
 * A drawn line's width in pixels is a property of the PEN and is roughly
 * constant across renderings — 1 to 3 px. A wall body's width in pixels scales
 * with resolution. The two are separable only when the body is several times
 * the pen. Taking a bold pen at 3 px and requiring a 2x margin to classify:
 *
 *   115 mm >= 6 px  =>  52 px/m     (refuse below)
 *   115 mm >= 9 px  =>  78 px/m     (3x margin — trust)
 *
 * Rounded to 40 and 80. The detector's own defaults were tuned at 100 px/m
 * (`detectWalls.ts`), which puts a 115 mm wall at 11.5 px — the known-good
 * point, corroborating the derivation from the other end.
 *
 * The WARN band exists because a cliff at exactly 40 would refuse someone at
 * 39 and accept someone at 41 with no difference they can perceive. Between
 * the two, shell walls are measurable and thin partitions are not, which is
 * something a user can act on.
 */
export const REFUSE_BELOW_PX_PER_M = 40
export const TRUST_ABOVE_PX_PER_M = 80

/**
 * Smallest source raster that could hold a floor plan at all, longest edge.
 *
 * Scale-free, so it runs before anything is calibrated. A building is 8–20 m
 * across; at the 40 px/m floor that needs 320–800 px for the building alone,
 * before margins, title block or annotation. 600 px is the conservative point
 * inside that range.
 *
 * This is why it must be checked on the image AS DELIVERED, before
 * `MIN_RASTER_DIMENSION` upscales it — upscaling to satisfy a downstream
 * threshold is the defect, not the remedy.
 */
export const MIN_SOURCE_LONGEST_PX = 600

/* ─── Gate 3A — per-wall physical minimum ────────────────────────────── */

/**
 * Thinnest thing the DETECTOR may call a wall, in metres.
 *
 * 75 mm is the thinnest partition actually built in the target market — block
 * or stud. Below that the reading is measuring a drawn line.
 *
 * `LIMITS.wallThickness.min` is 20 mm and is a modelling clamp, not an
 * architectural statement; it is deliberately not reused here.
 *
 * ── The loophole, closed by SOURCE rather than by type ──
 * A user may hand-draw a 50 mm glazed screen. The detector may not claim to
 * have MEASURED one at 36 px/m. Gating on provenance rather than carving
 * exceptions into the thickness rule keeps it un-gameable, and needs no new
 * field — `provenance.source` already carries it.
 */
export const MIN_WALL_THICKNESS_M = 0.075
export const WARN_WALL_THICKNESS_M = 0.1

/* ─── Gate 3B — distribution shape ───────────────────────────────────── */

/** Two thicknesses differing by less than this are the same family. */
const FAMILY_GAP_RATIO = 0.2

/** A real plan has a shell and one or two partition types. */
export const MAX_THICKNESS_FAMILIES = 4

/** The commonest family must account for at least this share of the walls. */
export const MIN_DOMINANT_SHARE = 0.4

/**
 * Fewest SOURCE pixels a thickness may be measured across and still be a
 * measurement.
 *
 * Below about three pixels there is no band to measure — the value is the
 * width of a stroke, or of the antialiasing around one. This is Gate 1
 * restated from the OUTPUT end, and it is the strongest of the three
 * distribution signals because it is scale-free and upscale-proof: it reads
 * what the detector actually produced rather than what it was given.
 */
export const MIN_THICKNESS_SOURCE_PX = 3

/* ─── Gate 4 — scorer sanity ─────────────────────────────────────────── */

/**
 * Largest share of an image that may be ink before a mask is rejected.
 *
 * ADR 0002 measured `paperContrastMasks` selecting THE PAPER: 87–95% of the
 * image marked as ink, which the grid then sliced into 75 strips totalling
 * 77,592 px, beating 7 real walls at 6,300 px. A plan's walls are line work;
 * even a heavily poché'd drawing is well under half the sheet. 35% rejects
 * that mask with enormous margin and cannot reject a real one.
 */
export const MAX_INK_FRACTION = 0.35

/**
 * Least share of segments that must touch another segment.
 *
 * ── Why this and not segment count or mean length ──
 * ADR 0002's numbers rule both out: the 75 imaginary segments averaged
 * **1,035 px** against the 7 real ones at **900 px**. The fakes were LONGER.
 * Neither count nor length separates them.
 *
 * What does: real walls form a connected network; strips sliced out of a white
 * field by a grid do not meet each other. `hasJunction` already exists — this
 * uses it BEFORE the score rather than after, which is new information from
 * code that is already there.
 */
export const MIN_JUNCTION_RATIO = 0.5

/* ─── results ────────────────────────────────────────────────────────── */

export type GateName =
  | 'raster-size'
  | 'scale-provenance'
  | 'resolution'
  | 'thickness-minimum'
  | 'thickness-distribution'

export type GateStatus = 'pass' | 'warn' | 'fail'

export type GateResult = {
  gate: GateName
  status: GateStatus
  /** Plain words, for the user. Names the measurement, never "failed". */
  message: string
  /** What was measured, for tests and logs. Never shown as a confidence. */
  measured: Record<string, number | string>
}

const px = (n: number) => n.toFixed(1)
const mm = (m: number) => Math.round(m * 1000)

/**
 * Gate 1a — is this raster big enough to hold a plan at all?
 *
 * Scale-free, so it runs first and depends on nothing. Takes the SOURCE
 * dimensions, before any upscale.
 */
export function gateRasterSize(
  sourceWidth: number,
  sourceHeight: number,
): GateResult {
  const longest = Math.max(sourceWidth, sourceHeight)
  const measured = { longestSourcePx: longest, floor: MIN_SOURCE_LONGEST_PX }

  if (longest >= MIN_SOURCE_LONGEST_PX) {
    return {
      gate: 'raster-size',
      status: 'pass',
      message: `${longest} px across.`,
      measured,
    }
  }
  return {
    gate: 'raster-size',
    status: 'fail',
    message:
      `This image is ${longest} px on its longest edge. A floor plan needs at ` +
      `least ${MIN_SOURCE_LONGEST_PX} px before a wall is more than a few ` +
      'pixels wide. Re-upload it larger — enlarging this one adds no detail.',
    measured,
  }
}

/**
 * Gate 2 — was the scale measured, or guessed?
 *
 * §8 ranks `'ai'` lowest and says its result is always "estimated", never
 * "calibrated". Detected coordinates become PERMANENT geometry and nothing
 * rescales existing walls, so an estimate baked into thirty of them is not
 * reversible the way an estimate on screen is.
 *
 * `'manual'`, `'dxf-units'` and `'vector'` are measurements. `'ocr'` reads the
 * drawing's own dimension strings and is accepted on the same footing — it is
 * rank 4 and it is evidence from the document rather than from a model.
 */
export function gateScaleProvenance(
  source: CalibrationSource,
  lockedByUser: boolean,
): GateResult {
  const measured = { source, lockedByUser: String(lockedByUser) }
  const measuredSources: CalibrationSource[] = [
    'manual',
    'dxf-units',
    'vector',
    'ocr',
  ]

  if (measuredSources.includes(source)) {
    return {
      gate: 'scale-provenance',
      status: 'pass',
      message: `Scale measured (${source}).`,
      measured,
    }
  }
  return {
    gate: 'scale-provenance',
    status: 'fail',
    message:
      source === 'none'
        ? 'This drawing has no scale yet. Measure a known length on it first — ' +
          'walls built now would be the wrong size permanently.'
        : `The scale is an estimate (${source}), not a measurement. Walls built ` +
          'from it keep that estimate forever, because nothing rescales walls ' +
          'once they exist. Measure a known length on the drawing first.',
    measured,
  }
}

/**
 * Gate 1b — enough source pixels per metre to measure a wall body?
 *
 * Only meaningful once Gate 2 has passed: `metresPerPixel` is the divisor, so
 * an estimated scale makes this verdict an estimate too. The caller runs them
 * in order for that reason.
 */
export function gateResolution(sourceMetresPerPixel: number): GateResult {
  const perMetre = 1 / sourceMetresPerPixel
  const thinnestPx = THINNEST_WALL_M * perMetre
  const measured = {
    sourcePxPerMetre: Number(perMetre.toFixed(2)),
    thinnestWallPx: Number(thinnestPx.toFixed(2)),
  }

  if (perMetre >= TRUST_ABOVE_PX_PER_M) {
    return {
      gate: 'resolution',
      status: 'pass',
      message: `${px(perMetre)} pixels per metre.`,
      measured,
    }
  }
  if (perMetre >= REFUSE_BELOW_PX_PER_M) {
    return {
      gate: 'resolution',
      status: 'warn',
      message:
        `${px(perMetre)} pixels per metre. Walls of ${mm(THINNEST_WALL_M)} mm ` +
        `are only ${px(thinnestPx)} pixels wide here, so thin partitions may ` +
        'be missed or mis-measured. Shell walls should be sound.',
      measured,
    }
  }
  return {
    gate: 'resolution',
    status: 'fail',
    message:
      `${px(perMetre)} pixels per metre. A ${mm(THINNEST_WALL_M)} mm partition ` +
      `is ${px(thinnestPx)} pixels wide at this scale — no wider than the line ` +
      'that draws it, so its body cannot be told from its outline.',
    measured,
  }
}

/**
 * Gate 3A — is any single detected wall thinner than anything ever built?
 *
 * Catches the plan where ONE wall is wrong: a hatch line or a dimension
 * witness read as a wall in an otherwise sound reading. Says nothing about
 * whether the reading as a whole is sound — that is 3B.
 */
export function gateThicknessMinimum(thicknesses: number[]): GateResult {
  const below = thicknesses.filter((t) => t < MIN_WALL_THICKNESS_M)
  const marginal = thicknesses.filter(
    (t) => t >= MIN_WALL_THICKNESS_M && t < WARN_WALL_THICKNESS_M,
  )
  const measured = {
    walls: thicknesses.length,
    belowMinimum: below.length,
    marginal: marginal.length,
    thinnestMm: thicknesses.length ? mm(Math.min(...thicknesses)) : 0,
  }

  if (below.length > 0) {
    return {
      gate: 'thickness-minimum',
      status: 'fail',
      message:
        `${below.length} of ${thicknesses.length} walls came out under ` +
        `${mm(MIN_WALL_THICKNESS_M)} mm — the thinnest is ` +
        `${measured.thinnestMm} mm. Nothing is built that thin, so those are ` +
        'lines on the drawing rather than walls.',
      measured,
    }
  }
  if (marginal.length > 0) {
    return {
      gate: 'thickness-minimum',
      status: 'warn',
      message:
        `${marginal.length} walls are under ${mm(WARN_WALL_THICKNESS_M)} mm. ` +
        'Thin partitions exist, but check them against the drawing.',
      measured,
    }
  }
  return {
    gate: 'thickness-minimum',
    status: 'pass',
    message: `Thinnest wall ${measured.thinnestMm} mm.`,
    measured,
  }
}

/**
 * Groups thicknesses into families, largest first.
 *
 * Sorted then split on a RELATIVE gap, so a 230 mm shell and a 240 mm shell
 * are one family while 115 mm and 230 mm are two — the tolerance that matters
 * scales with the wall, not with the millimetre.
 */
export function thicknessFamilies(thicknesses: number[]): number[][] {
  if (thicknesses.length === 0) return []
  const sorted = [...thicknesses].sort((a, b) => a - b)
  const families: number[][] = [[sorted[0]]]

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]
    const gap = (sorted[i] - previous) / previous
    if (gap > FAMILY_GAP_RATIO) families.push([sorted[i]])
    else families[families.length - 1].push(sorted[i])
  }

  return families.sort((a, b) => b.length - a.length)
}

/**
 * Gate 3B — is the DETECTOR wrong, rather than one wall?
 *
 * Three signals, and they are not interchangeable with 3A. 3B fires with 3A
 * passing on a reading of 180/185/190/195/200/205 mm — no implausible wall,
 * but noise rather than families. 3A fires with 3B passing on 29 good walls
 * and one 20 mm artefact.
 */
export function gateThicknessDistribution(
  thicknesses: number[],
  sourceMetresPerPixel: number,
): GateResult {
  if (thicknesses.length === 0) {
    return {
      gate: 'thickness-distribution',
      status: 'pass',
      message: 'No walls to judge.',
      measured: { walls: 0 },
    }
  }

  const families = thicknesses.length ? thicknessFamilies(thicknesses) : []
  const dominant = families.length ? families[0].length / thicknesses.length : 0
  const sourcePx = thicknesses.map((t) => t / sourceMetresPerPixel).sort((a, b) => a - b)
  const medianPx = sourcePx[Math.floor(sourcePx.length / 2)]

  const measured = {
    walls: thicknesses.length,
    families: families.length,
    dominantShare: Number(dominant.toFixed(2)),
    medianSourcePx: Number(medianPx.toFixed(2)),
  }

  // The strongest signal first: a thickness measured across fewer than three
  // source pixels is not a measurement, whatever its distribution looks like.
  if (medianPx < MIN_THICKNESS_SOURCE_PX) {
    return {
      gate: 'thickness-distribution',
      status: 'fail',
      message:
        `The typical wall here was measured across ${px(medianPx)} pixels of ` +
        'the original image. That is the width of a drawn line, so these are ' +
        'stroke widths rather than wall thicknesses.',
      measured,
    }
  }
  if (families.length > MAX_THICKNESS_FAMILIES) {
    return {
      gate: 'thickness-distribution',
      status: 'fail',
      message:
        `${families.length} different wall thicknesses were found. A plan has ` +
        'two or three — a shell and its partitions. This many means the ' +
        'detector is measuring whatever ink it finds.',
      measured,
    }
  }
  if (dominant < MIN_DOMINANT_SHARE) {
    return {
      gate: 'thickness-distribution',
      status: 'warn',
      message:
        `No thickness accounts for more than ${Math.round(dominant * 100)}% of ` +
        'the walls. Real plans repeat a small number of wall types.',
      measured,
    }
  }
  return {
    gate: 'thickness-distribution',
    status: 'pass',
    message:
      `${families.length} wall ${families.length === 1 ? 'type' : 'types'}, ` +
      `the commonest covering ${Math.round(dominant * 100)}%.`,
    measured,
  }
}

/* ─── Gate 4 — mask candidate sanity, in front of the length score ────── */

/** What a candidate mask produced, as far as the gate is concerned. */
export type MaskEvidence = {
  /** Fraction of the image marked as ink, 0–1. */
  inkFraction: number
  /** Fraction of segments touching at least one other, 0–1. */
  junctionRatio: number
  /** Detected band thicknesses, in pixels of whatever raster was read. */
  thicknessesPx: number[]
  /** The existing score: total detected length, in pixels. */
  totalLengthPx: number
}

/**
 * Whether a candidate reading may be scored at all.
 *
 * ── §3, and what this extends rather than replaces ──
 * `scoreSegments` and its total-length ranking are untouched, and so is the
 * `mergeWallFaces` -> `typicalThickness` ordering (§10 rule 9). This runs IN
 * FRONT: a candidate that fails is not scored, and among those that pass the
 * length score still chooses. That is the "extend, do not replace" §3 asks
 * for, and the argued reason it also asks for exists twice — ADR 0002's
 * measurement, and `samples/real-plan-cv-untitled.json`.
 */
export function maskIsCredible(evidence: MaskEvidence): boolean {
  if (evidence.inkFraction > MAX_INK_FRACTION) return false
  // A lone wall is still a plan, so the junction rule only applies once there
  // are enough segments for a network to be a meaningful claim.
  if (evidence.thicknessesPx.length >= 4 && evidence.junctionRatio < MIN_JUNCTION_RATIO) {
    return false
  }
  return true
}

/**
 * Ranks credible candidates, rejecting the rest.
 *
 * Ordering within the credible set is the existing total-length score. The
 * gate only decides who is allowed into that comparison.
 */
export function rankCandidates<T extends MaskEvidence>(candidates: T[]): T[] {
  return candidates
    .filter(maskIsCredible)
    .sort((a, b) => b.totalLengthPx - a.totalLengthPx)
}

/* ─── the run ────────────────────────────────────────────────────────── */

export type PlausibilityReport = {
  results: GateResult[]
  /** The first hard failure, or null when nothing failed. */
  blocking: GateResult | null
  warnings: GateResult[]
}

const summarise = (results: GateResult[]): PlausibilityReport => ({
  results,
  blocking: results.find((r) => r.status === 'fail') ?? null,
  warnings: results.filter((r) => r.status === 'warn'),
})

/**
 * The gates that can be answered BEFORE detection runs, in dependency order.
 *
 * 1a first because it depends on nothing. Gate 2 next. Gate 1b only if Gate 2
 * passed — its divisor is the scale, so on an estimated scale the resolution
 * verdict would itself be an estimate, and the honest answer is "measure the
 * scale and I will tell you", not a number.
 */
export function gateBeforeDetection(input: {
  sourceWidth: number
  sourceHeight: number
  sourceMetresPerPixel: number
  calibrationSource: CalibrationSource
  lockedByUser: boolean
}): PlausibilityReport {
  const results: GateResult[] = [
    gateRasterSize(input.sourceWidth, input.sourceHeight),
  ]

  const scale = gateScaleProvenance(input.calibrationSource, input.lockedByUser)
  results.push(scale)

  if (scale.status === 'pass') {
    results.push(gateResolution(input.sourceMetresPerPixel))
  }

  return summarise(results)
}

/** The gates that read the detector's output. Thicknesses in METRES. */
export function gateAfterDetection(
  thicknesses: number[],
  sourceMetresPerPixel: number,
): PlausibilityReport {
  return summarise([
    gateThicknessMinimum(thicknesses),
    gateThicknessDistribution(thicknesses, sourceMetresPerPixel),
  ])
}
