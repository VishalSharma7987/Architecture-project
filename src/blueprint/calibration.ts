import { BLUEPRINT } from '../scene/config'
import {
  useDesignStore,
  type Calibration,
  type CalibrationEvidence,
  type CalibrationSource,
  type Point,
} from '../store/useDesignStore'

// Re-exported so callers can reach the whole vocabulary from the module that
// owns the rules, rather than importing the shape from the store and the
// behaviour from here.
export type { Calibration, CalibrationEvidence, CalibrationSource }

/**
 * Blueprint scale: who is allowed to set it, and what happens when two
 * sources disagree.
 *
 * ── The bug this module exists to make impossible ────────────────────────
 * There is exactly one screen↔world conversion factor in the whole app,
 * `Blueprint.metresPerPixel`. Everything else in the model is already metric.
 * Two code paths measured it — the user's two-point calibration, and a vision
 * model reading dimension text off a JPEG — and both wrote it through the same
 * unguarded `updateBlueprint`. The AI path never checked whether the user had
 * already measured, so switching to 3D on a freshly calibrated plan silently
 * replaced a real measurement with an estimate, baked the estimate into every
 * wall it then built, and reported the result as "calibrated". None of it was
 * undoable or persisted, so there was no way back.
 *
 * The fix is not a conditional at the call site. It is that `metresPerPixel`
 * now has exactly one writer, and that writer knows how much each source is
 * worth.
 */

/**
 * The authority ladder. LOWER IS STRONGER.
 *
 * A proposal may replace the current scale only when its rank is better than
 * or equal to what is already there — so a re-measure can correct a measure,
 * but a guess can never overwrite one.
 */
export const CALIBRATION_RANK: Record<CalibrationSource, number> = {
  /** Two picks and a typed real-world length. The user measured it. */
  manual: 1,
  /** `$INSUNITS` / `$MEASUREMENT` from a DXF header. */
  'dxf-units': 2,
  /** A vector PDF page transform in real units. */
  vector: 3,
  /** Three or more OCR'd dimension strings agreeing within 2%. */
  ocr: 4,
  /**
   * The drawing's stated scale notation, typed by the user, times the print
   * density the file claims (B38).
   *
   * **4.5 is deliberate, and the fraction is the point.** The ratio half is a
   * USER STATEMENT read off the sheet, which belongs above every automatic
   * guess — above `heuristic`'s assumed door and far above `ai`. The density
   * half is machine metadata the user did not state and nothing cross-checks,
   * where `ocr` validates itself against the drawing's own pixel geometry
   * three times over. So it sits between them.
   *
   * Renumbering 5–7 to make room was rejected: §8's rank NUMBERS are cited by
   * value elsewhere ("Gate 2 refuses rank 6"), and shifting documented ranks
   * is the same citation rot §10's renumbering already cost this project once.
   * Every comparison here is `>` on the value, so a fraction orders correctly
   * and moves nobody.
   */
  stated: 4.5,
  /** Inferred from a known object — an assumed 900 mm door leaf. */
  heuristic: 5,
  /** A model reading an image. Always the weakest thing that is still a claim. */
  ai: 6,
  /** The 0.01 default. Not a measurement; a placeholder so something renders. */
  none: 7,
}

/** The calibration a freshly loaded image starts with: a placeholder. */
export const uncalibrated = (metresPerPixel: number, at: string): Calibration => ({
  source: 'none',
  metresPerPixel,
  lockedByUser: false,
  setAt: at,
})

export type ProposalResult =
  | {
      applied: true
      calibration: Calibration
      /**
       * Walls already drawn when the scale changed. Their coordinates were
       * baked at the old scale and are NOT rescaled — see `propose`.
       */
      staleWalls: number
    }
  | { applied: false; reason: string }

/** Clamped, finite, positive — or null when the number is not a scale at all. */
function sane(metresPerPixel: number): number | null {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return null
  return Math.min(
    BLUEPRINT.maxMetresPerPixel,
    Math.max(BLUEPRINT.minMetresPerPixel, metresPerPixel),
  )
}

/**
 * Human name for a source, for the one sentence the UI shows.
 * Note `ai` is "estimated", never "calibrated" — see `describeCalibration`.
 */
const SOURCE_LABEL: Record<CalibrationSource, string> = {
  manual: 'measured on the drawing',
  'dxf-units': 'read from the DXF units',
  vector: 'read from the PDF page',
  ocr: 'read from the dimension text',
  stated: "taken from the scale you typed and the image's own print size",
  heuristic: 'inferred from a standard door width',
  ai: 'estimated by a vision model',
  none: 'not measured — this is the default guess',
}

/**
 * How the scale should be described to the user.
 *
 * `manual` is the only source that earns the word "calibrated". The old code
 * returned `kind: 'calibrated'` for the AI path and the banner read "Sized to
 * 40′ from the drawing", which told the user their plan had been measured when
 * it had been guessed at by a free model reading a JPEG. That is the one place
 * this codebase's otherwise careful honesty about uncertainty failed, and the
 * vocabulary is now enforced here rather than written out at each call site.
 */
export function describeCalibration(calibration: Calibration): string {
  return SOURCE_LABEL[calibration.source]
}

/** Whether this scale is a real measurement rather than a guess or a read. */
export const isMeasured = (calibration: Calibration | null | undefined): boolean =>
  calibration?.source === 'manual'

/**
 * The ONLY way `Blueprint.metresPerPixel` ever changes.
 *
 * Rejects, in order:
 *   1. no blueprint loaded;
 *   2. a value that is not a usable scale;
 *   3. anything at all once the user has measured it themselves (`lockedByUser`);
 *   4. a source weaker than the one already in force.
 *
 * On success the image is scaled ABOUT `anchor` rather than re-centred on the
 * world origin. The two writers used to disagree about this: the manual path
 * pinned the user's first pick so the drawing grew under the point they aimed
 * at, and the AI path re-centred on the origin, sliding the underlay out from
 * beneath anything already traced. Anchoring is correct in both cases; when no
 * anchor is given the image's own centre is held, so it never wanders.
 *
 * Existing walls are NOT rescaled. Their metres were baked in by
 * `segmentsToWalls` at the old scale and moving them would silently rewrite
 * geometry the user may have edited by hand. The count comes back as
 * `staleWalls` so the caller can say so instead of pretending it did not happen.
 */
export function proposeCalibration(input: {
  source: CalibrationSource
  metresPerPixel: number
  /** World point to hold fixed while the image resizes. */
  anchor?: Point
  evidence?: CalibrationEvidence
  /** ISO 8601. Injected so tests are deterministic. */
  at?: string
}): ProposalResult {
  const store = useDesignStore.getState()
  const blueprint = store.blueprint
  if (!blueprint) return { applied: false, reason: 'No blueprint is loaded.' }

  const metresPerPixel = sane(input.metresPerPixel)
  if (metresPerPixel === null) {
    return {
      applied: false,
      reason: `${input.metresPerPixel} is not a usable scale.`,
    }
  }

  const current = blueprint.calibration

  if (current.lockedByUser && input.source !== 'manual') {
    return {
      applied: false,
      reason:
        `The scale was measured on the drawing and is locked. A value ` +
        `${SOURCE_LABEL[input.source]} cannot replace it.`,
    }
  }

  if (CALIBRATION_RANK[input.source] > CALIBRATION_RANK[current.source]) {
    return {
      applied: false,
      reason:
        `The scale is already ${SOURCE_LABEL[current.source]}, which is more ` +
        `reliable than a value ${SOURCE_LABEL[input.source]}.`,
    }
  }

  const factor = metresPerPixel / blueprint.metresPerPixel
  // Default anchor: the image's own centre, so a rescale does not translate it.
  const anchor: Point = input.anchor ?? {
    x: blueprint.origin.x + (blueprint.width * blueprint.metresPerPixel) / 2,
    z: blueprint.origin.z + (blueprint.height * blueprint.metresPerPixel) / 2,
  }

  const calibration: Calibration = {
    source: input.source,
    metresPerPixel,
    // Measuring it yourself locks it. Nothing else does.
    lockedByUser: input.source === 'manual',
    setAt: input.at ?? new Date().toISOString(),
    evidence: input.evidence,
  }

  store.updateBlueprint({
    metresPerPixel,
    origin: {
      x: anchor.x - (anchor.x - blueprint.origin.x) * factor,
      z: anchor.z - (anchor.z - blueprint.origin.z) * factor,
    },
    calibration,
  })

  return { applied: true, calibration, staleWalls: store.walls.length }
}

/**
 * Releases a measurement so automated sources can propose again.
 *
 * Clearing `lockedByUser` alone would achieve nothing: the source would still
 * read `manual`, which outranks every automated source, so the rank check
 * would go on refusing them and "unlock" would be a button that does not work.
 * So the source is demoted to `none` as well — "I am no longer vouching for
 * this number" — while the value itself stays in force until something better
 * replaces it.
 *
 * Only ever called from an explicit user action. There is no code path that
 * unlocks a scale on the user's behalf, which is the point.
 */
export function unlockCalibration(): void {
  const { blueprint, updateBlueprint } = useDesignStore.getState()
  if (!blueprint) return
  updateBlueprint({
    calibration: {
      ...blueprint.calibration,
      source: 'none',
      lockedByUser: false,
    },
  })
}

/* ─── transient pick state ──────────────────────────────────────────────── */

/**
 * The two world points picked to calibrate a blueprint's scale.
 *
 * This is transient pointer state, not part of the design, so it stays out of
 * the design store: the plan canvas writes it, the blueprint panel reads it,
 * and it never reaches persistence or undo. The array identity only changes
 * when the picks do, which is what `useSyncExternalStore` needs.
 */
const EMPTY: Point[] = []

let picks: Point[] = EMPTY
let notice: string | null = null
const listeners = new Set<() => void>()

const wake = () => {
  for (const listener of listeners) listener()
}

/** Points picked so far — none, the first, or both. */
export const getCalibrationPicks = (): Point[] => picks

/** Replaces the picks and wakes every subscriber. */
export function setCalibrationPicks(next: Point[]) {
  picks = next
  wake()
}

/**
 * Why the last pick was refused, or null (B38 scope C).
 *
 * Transient like the picks and carried on the same subscription: the canvas
 * writes it at the click, the panel reads it, and it never reaches
 * persistence or undo. It rides here rather than in the panel's own state
 * because the refusal happens in the CANVAS — the panel is not where the
 * click landed.
 */
export const getCalibrationNotice = (): string | null => notice

export function setCalibrationNotice(next: string | null) {
  if (notice === next) return
  notice = next
  wake()
}

/** Abandons an in-progress or finished measurement, and any refusal with it. */
export const clearCalibrationPicks = () => {
  notice = null
  setCalibrationPicks(EMPTY)
}

/**
 * How close a second pick may land to the first before it is refused, in
 * SCREEN pixels (B38, scope C).
 *
 * Screen, not world: on an uncalibrated image world distance means nothing —
 * a "1 metre" gap at the 0.01 default is one pixel, and at a corrected scale
 * the same click is metres. What decides whether the user aimed at two
 * different things is how far apart the two clicks were ON THE SCREEN THEY
 * AIMED AT, which is the same argument `SNAP_RADIUS_PX` and
 * `HIT_TOLERANCE_PX` already make.
 *
 * 6 px is derived: above `HIT_TOLERANCE_PX` (7) a click is a deliberate
 * second target, and a double-click or a small hand tremor lands within a
 * few pixels. Chosen below the pick radius so a user aiming at an adjacent
 * feature is never refused — the refusal must be rarer than the mistake it
 * catches.
 */
export const MIN_PICK_SEPARATION_PX = 6

/**
 * Whether a second calibration pick is far enough from the first to be a
 * measurement.
 *
 * Real use found this: two picks landing on the same point produced a panel
 * reading *"That span currently reads 0″. How long is it really?"* — a
 * question with no answer and a field that could not be acted on, because
 * every scale derived from a zero span is a division by zero. The honest
 * moment to refuse is the CLICK, where the user still has their hand on the
 * thing they mis-aimed at, not the form afterwards.
 *
 * Pure so the rule is testable without a DOM, and so the editor stays an
 * adapter that knows about pixels.
 */
export function pickIsSeparated(
  first: Point,
  second: Point,
  /** Screen pixels per world metre — the viewport's scale. */
  pixelsPerMetre: number,
): boolean {
  const worldGap = Math.hypot(second.x - first.x, second.z - first.z)
  return worldGap * pixelsPerMetre >= MIN_PICK_SEPARATION_PX
}

/** Subscribes to pick changes. Returns the unsubscribe function. */
export function subscribeCalibration(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
