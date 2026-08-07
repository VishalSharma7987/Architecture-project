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
const listeners = new Set<() => void>()

/** Points picked so far — none, the first, or both. */
export const getCalibrationPicks = (): Point[] => picks

/** Replaces the picks and wakes every subscriber. */
export function setCalibrationPicks(next: Point[]) {
  picks = next
  for (const listener of listeners) listener()
}

/** Abandons an in-progress or finished measurement. */
export const clearCalibrationPicks = () => setCalibrationPicks(EMPTY)

/** Subscribes to pick changes. Returns the unsubscribe function. */
export function subscribeCalibration(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
