import type { Point } from '../store/useDesignStore'

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

let calibratedSrc: string | null = null

/**
 * Records that a blueprint's scale came from a real measurement.
 *
 * Kept here rather than in component state because the panel unmounts every
 * time it is closed, and a calibrated drawing must not start warning that it
 * is uncalibrated just because the user shut the panel.
 */
export const markCalibrated = (src: string) => {
  calibratedSrc = src
}

/** Whether this exact image has been measured, as opposed to guessed at. */
export const isCalibrated = (src: string) => calibratedSrc === src

/** Subscribes to pick changes. Returns the unsubscribe function. */
export function subscribeCalibration(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
