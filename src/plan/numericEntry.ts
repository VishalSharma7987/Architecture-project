/**
 * Typing a length while a wall chain is being drawn.
 *
 * ── The gap this closes ──
 * §7 Stage 2 calls this "the single largest gap versus AutoCAD". A wall chain
 * has been click-only: a 13'-0" wall could not be DRAWN, only approximated to
 * the nearest 6" grid cell and then corrected in the inspector afterwards. It
 * is also step 5 of the import review flow — a user looking at a reconstructed
 * wall that came out 34% short has had no way to say what its length should be.
 *
 * ── The split: direction from the pointer, length from the keyboard ──
 * The cursor already carries a precise direction and an imprecise length. The
 * keyboard carries a precise length and no direction. Neither input is
 * replaced; each supplies the half it is good at.
 *
 * ── Authority ──
 * A typed length is the highest-authority input in the editor and overrides
 * BOTH grid and snap (§L2 — user input outranks). Grid is a convenience, and
 * snap is an inference about intent from proximity; a number the user typed is
 * a statement of intent with no inference in it at all.
 *
 * ── One parser ──
 * `parseLength` is the only parser, and this module does not add a second one.
 * It already accepts `12'6"`, `12'-6"`, `12 ft 6 in`, `6 3/4"`, `381cm`,
 * `3.81m`. §4 invariant 4: `formatLength` is LOSSY and `parseLength` is not
 * its inverse, so a value must never be round-tripped through a formatted
 * string — the buffer here holds what the user typed, verbatim, and is parsed
 * exactly once at commit.
 */
import type { Point, Unit } from '../store/useDesignStore'
import { LIMITS } from '../store/useDesignStore'
import { parseLength } from '../units/length'

/** The keystroke buffer, or null when no numeric entry is in progress. */
export type NumericEntry = { text: string } | null

/**
 * What a keystroke does to the entry.
 *
 * `ignore` is distinct from `cancel` on purpose: a key that means nothing here
 * must fall through to whatever else was listening (Escape's back-out ladder,
 * the space-bar pan, undo), and a key that cancels must not.
 */
export type EntryAction =
  | { kind: 'update'; text: string }
  | { kind: 'commit'; text: string }
  | { kind: 'cancel' }
  | { kind: 'ignore' }

/**
 * Which keys OPEN numeric entry.
 *
 * Digits, and the three characters that can legitimately begin a length —
 * `.` for `.5m`, and `'`/`"` are excluded because a length never starts with a
 * unit mark. Deliberately narrow: every character not listed here has to keep
 * working as a shortcut, and a mode that swallows keys it cannot use is worse
 * than no mode.
 */
export const opensEntry = (key: string): boolean => /^[0-9.]$/.test(key)

/** Characters accepted INSIDE the buffer — everything `parseLength` reads. */
const ACCEPTS_INSIDE = /^[0-9.'"\-/ a-zA-Z]$/

export function keyToAction(entry: NumericEntry, key: string): EntryAction {
  if (entry === null) {
    return opensEntry(key) ? { kind: 'update', text: key } : { kind: 'ignore' }
  }

  if (key === 'Enter') return { kind: 'commit', text: entry.text }
  if (key === 'Escape') return { kind: 'cancel' }
  if (key === 'Backspace') {
    const text = entry.text.slice(0, -1)
    // Backspacing the last character leaves entry, rather than sitting in an
    // empty mode the user cannot see they are in.
    return text === '' ? { kind: 'cancel' } : { kind: 'update', text }
  }
  if (key.length === 1 && ACCEPTS_INSIDE.test(key)) {
    return { kind: 'update', text: entry.text + key }
  }
  return { kind: 'ignore' }
}

/**
 * Where the segment ends: the direction of `toward` from `anchor`, at `metres`.
 *
 * Null when there is no direction to take — the pointer sitting exactly on the
 * anchor, which happens on the click that starts a chain and any time the user
 * has not moved yet. A length with no direction is not a segment, and guessing
 * one (east, say, or the last segment's) would be inventing input.
 */
export function typedEndpoint(
  anchor: Point,
  toward: Point,
  metres: number,
): Point | null {
  const dx = toward.x - anchor.x
  const dz = toward.z - anchor.z
  const hypot = Math.hypot(dx, dz)
  if (hypot === 0) return null

  return { x: anchor.x + (dx / hypot) * metres, z: anchor.z + (dz / hypot) * metres }
}

/**
 * The typed text as a wall length in metres, or null if it means nothing.
 *
 * Clamping is done here because `parseLength`'s contract says it is the
 * caller's job, and because the store would otherwise silently reject a
 * 900 m wall as out of range after the entry had already been dismissed.
 */
export function entryLength(text: string, unit: Unit): number | null {
  const metres = parseLength(text, unit)
  if (metres === null) return null
  if (metres < LIMITS.wallLength.min || metres > LIMITS.wallLength.max) return null
  return metres
}
