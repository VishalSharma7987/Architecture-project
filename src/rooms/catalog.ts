import type { RoomLabel, RoomType } from '../store/useDesignStore'

/**
 * Room tints, shared between related types so the plan reads as zones —
 * sleeping, wet, service — instead of thirteen unrelated colours.
 *
 * All near-white at ~8% alpha: a floor plan is read for its walls and
 * dimensions, and a fill strong enough to notice is a fill that competes.
 */
const TINT = {
  /** Living and dining: the warm, social half of the plan. */
  warm: 'rgba(217, 160, 108, 0.10)',
  /** Anywhere you sleep or work quietly. */
  calm: 'rgba(120, 152, 199, 0.10)',
  /** Kitchen — a working room, warmer than the wet rooms it neighbours. */
  service: 'rgba(206, 145, 78, 0.12)',
  /** Toilet and bathroom. */
  wet: 'rgba(96, 168, 176, 0.12)',
  /** Pooja, the one space that earns a little colour of its own. */
  accent: 'rgba(184, 143, 60, 0.14)',
  /** Store and staircase: circulation and leftovers. */
  neutral: 'rgba(148, 163, 184, 0.10)',
  /** Balcony — outside the envelope, so it reads greener. */
  outside: 'rgba(126, 176, 122, 0.12)',
}

export type RoomTypeInfo = {
  id: RoomType
  /** Full name, for the picker and the room panel. */
  label: string
  /** Short form for the plan, where a toilet is often 30px wide. */
  short: string
  /** Plan fill for the room. See `TINT`. */
  tint: string
}

/**
 * Every namable room type, in the order the picker offers them.
 *
 * Ordered by how often a space gets named rather than alphabetically: the
 * living room and the bedrooms are the first things anyone labels, and the
 * service spaces trail behind them.
 */
export const ROOM_TYPES: RoomTypeInfo[] = [
  { id: 'living', label: 'Living', short: 'Living', tint: TINT.warm },
  { id: 'bedroom', label: 'Bedroom', short: 'Bed', tint: TINT.calm },
  {
    id: 'master-bedroom',
    label: 'Master Bedroom',
    short: 'M Bed',
    tint: TINT.calm,
  },
  { id: 'kitchen', label: 'Kitchen', short: 'Kitchen', tint: TINT.service },
  { id: 'dining', label: 'Dining', short: 'Dining', tint: TINT.warm },
  { id: 'pooja', label: 'Pooja', short: 'Pooja', tint: TINT.accent },
  { id: 'toilet', label: 'Toilet', short: 'WC', tint: TINT.wet },
  { id: 'bathroom', label: 'Bathroom', short: 'Bath', tint: TINT.wet },
  { id: 'study', label: 'Study', short: 'Study', tint: TINT.calm },
  { id: 'store', label: 'Store', short: 'Store', tint: TINT.neutral },
  { id: 'balcony', label: 'Balcony', short: 'Balcony', tint: TINT.outside },
  { id: 'guest-room', label: 'Guest Room', short: 'Guest', tint: TINT.calm },
  { id: 'staircase', label: 'Staircase', short: 'Stair', tint: TINT.neutral },
]

const BY_ID = new Map(ROOM_TYPES.map((t) => [t.id, t]))

/**
 * Presentation for a room type. Falls back to the first entry, so a label
 * loaded from a newer document still draws instead of blanking the room.
 */
export const getRoomType = (id: RoomType): RoomTypeInfo =>
  BY_ID.get(id) ?? ROOM_TYPES[0]

/**
 * The caption for a named space: the user's custom name if they typed one,
 * otherwise the type's default label. The single source of truth so every
 * surface — plan, 3D, schedule, print — reads the same name.
 */
export const roomDisplayName = (label: Pick<RoomLabel, 'type' | 'name'>): string =>
  label.name?.trim() || getRoomType(label.type).label
