import type { Facing, RoomType } from '../store/useDesignStore'
import { getFacing } from '../site/orientation'

/**
 * The placement table this app checks a plan against.
 *
 * Vastu Shastra is a traditional guideline system, not building science. What
 * lives here is one written-down ruleset, encoded verbatim so the app can
 * REPORT what it says; the architect and the client decide what to act on.
 * Nothing is inferred — where the table names no direction for a subject, the
 * subject is absent from this file rather than given a guessed rule.
 */

/** The eight compass zones plus `C`, the centre — the Brahmasthan. */
export type VastuZone = Facing | 'C'

export type VastuRule = {
  /** Which subject this rule is about, for display. */
  label: string
  /** First-preference zones. */
  ideal: VastuZone[]
  /** Zones the table allows but does not put first. */
  ok: VastuZone[]
  /** Zones the table names as ones to avoid. */
  avoid: VastuZone[]
}

/**
 * The table's room entries, keyed by this app's room types.
 *
 * `Partial` is load-bearing: `balcony` has no entry in this table, and an
 * absent key is how the analysis knows to say "no rule in this set" instead of
 * scoring a room against an empty list. `toilet` and `bathroom` share the
 * table's single "Toilet / bathroom" row.
 */
export const ROOM_RULES: Partial<Record<RoomType, VastuRule>> = {
  living: {
    label: 'Living room',
    ideal: ['N', 'E', 'NE'],
    ok: [],
    avoid: [],
  },
  bedroom: {
    label: 'Children bedroom',
    ideal: ['W', 'NW', 'E'],
    ok: [],
    avoid: [],
  },
  'master-bedroom': {
    label: 'Master bedroom',
    ideal: ['SW'],
    ok: ['S', 'W'],
    avoid: ['NE', 'SE'],
  },
  kitchen: {
    label: 'Kitchen',
    ideal: ['SE'],
    ok: ['NW'],
    avoid: ['NE', 'SW', 'N'],
  },
  dining: {
    label: 'Dining',
    ideal: ['W', 'NW', 'E'],
    ok: [],
    avoid: [],
  },
  pooja: {
    label: 'Pooja / prayer',
    ideal: ['NE'],
    ok: ['E', 'N'],
    avoid: ['S', 'SW'],
  },
  toilet: {
    label: 'Toilet / bathroom',
    ideal: ['NW', 'W', 'S'],
    ok: [],
    avoid: ['NE', 'SW', 'C'],
  },
  bathroom: {
    label: 'Toilet / bathroom',
    ideal: ['NW', 'W', 'S'],
    ok: [],
    avoid: ['NE', 'SW', 'C'],
  },
  study: {
    label: 'Study',
    ideal: ['W', 'NE', 'E'],
    ok: [],
    avoid: [],
  },
  store: {
    label: 'Store room',
    ideal: ['NW', 'S', 'SW'],
    ok: [],
    avoid: ['NE'],
  },
  'guest-room': {
    label: 'Guest bedroom',
    ideal: ['NW'],
    ok: [],
    avoid: [],
  },
  staircase: {
    label: 'Staircase',
    ideal: ['S', 'W', 'SW'],
    ok: [],
    avoid: ['NE', 'C'],
  },
}

/**
 * Where the table would like the main entrance.
 *
 * The app has no door-level model of an entrance, but the plot's facing is the
 * direction the entrance looks out on, so the analysis checks that instead and
 * labels it as the plot facing rather than as a room.
 */
export const ENTRANCE_RULE: VastuRule = {
  label: 'Main entrance',
  ideal: ['N', 'E', 'NE'],
  ok: [],
  avoid: ['SW'],
}

/**
 * Subjects in the table that this app does not model, kept here so the ruleset
 * lives in one place. They drive no results: nothing in a floor plan says where
 * a sump or a tank is, and the analysis does not fabricate an answer for them.
 */
export const SITE_RULES: VastuRule[] = [
  {
    label: 'Underground water tank',
    ideal: ['NE'],
    ok: [],
    avoid: ['SE', 'SW'],
  },
  {
    label: 'Overhead tank',
    ideal: ['SW', 'W'],
    ok: [],
    avoid: ['NE'],
  },
]

/**
 * Room types the Brahmasthan should be kept clear of.
 *
 * The table's own wording is "any heavy room, toilet, stairs". Only the toilet
 * and the staircase are named outright — "heavy room" is not enumerated
 * anywhere in this ruleset, so it is not guessed at here, and the analysis says
 * as much rather than quietly extending the list.
 */
export const BRAHMASTHAN_AVOID: RoomType[] = ['toilet', 'bathroom', 'staircase']

/** The Brahmasthan entry, for display alongside the other rules. */
export const BRAHMASTHAN_RULE: VastuRule = {
  label: 'Centre (Brahmasthan)',
  ideal: ['C'],
  ok: [],
  avoid: [],
}

/** Display name for a zone, e.g. `North-East` or `Centre`. */
export function zoneLabel(zone: VastuZone): string {
  return zone === 'C' ? 'Centre' : getFacing(zone).label
}

/** Display names for a list of zones, joined for a sentence. */
export function zoneList(zones: VastuZone[]): string {
  const labels = zones.map(zoneLabel)
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

/** The rule for a room type, or null when this table is silent about it. */
export function ruleForRoom(type: RoomType): VastuRule | null {
  return ROOM_RULES[type] ?? null
}
