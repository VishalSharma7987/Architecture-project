import type { Opening, OpeningType, Wall } from '../store/useDesignStore'

/**
 * The door and window schedule — one row per distinct mark.
 *
 * A mark (`D1`, `MD`, `W2`, `KW2`, `V`) is a claim: every opening carrying it
 * is the SAME UNIT, so the schedule can say "D1 × 6" and a joiner can quote it.
 * This module's whole job is to group by that claim and to CHECK it, because
 * the claim is typed by hand and a plan with two different 'D1's is a plan that
 * orders the wrong doors.
 */

/** One line of the schedule: a mark, or the group carrying none. */
export type ScheduleRow = {
  /**
   * The mark, or `null` for the openings that have none.
   *
   * Null is a real row, not a missing one. Unmarked openings must be counted
   * somewhere — a schedule that silently omits half the doors is worse than no
   * schedule — and every existing document has zero marks, so this is the row
   * most users will see first.
   */
  mark: string | null
  count: number
  /** Distinct values across the row's openings, each ascending / in order. */
  types: OpeningType[]
  widths: number[]
  heights: number[]
  sills: number[]
  /**
   * The row's openings claim to be identical units and are not.
   *
   * **Only ever true on a MARKED row.** Varying sizes among unmarked openings
   * is not a conflict, because no claim was made about them: they are simply
   * several different openings that nobody has scheduled yet. Flagging those
   * would put a warning on every document in existence and teach people to
   * ignore it.
   */
  conflict: boolean
}

/** The wall an opening sits on is irrelevant to the schedule; the unit is not. */
type Entry = { opening: Opening }

/**
 * Millimetres, for comparing sizes.
 *
 * Distinctness is judged on the quantised value and REPORTED as the real one,
 * so float noise cannot split one unit into two rows — the same 1 mm tolerance
 * `plan/rooms.ts` welds at and `spaceId` hashes at.
 */
const mm = (metres: number) => Math.round(metres * 1000)

/**
 * Distinct values, in first-seen order for types and ascending for sizes.
 *
 * Returns the ORIGINAL numbers, deduplicated by their millimetre value.
 */
function distinctSizes(values: number[]): number[] {
  const seen = new Map<number, number>()
  for (const value of values) {
    if (!seen.has(mm(value))) seen.set(mm(value), value)
  }
  return [...seen.values()].sort((a, b) => a - b)
}

function distinctTypes(values: OpeningType[]): OpeningType[] {
  return [...new Set(values)]
}

/**
 * Compares marks so `D2` sorts before `D10`.
 *
 * Hand-rolled rather than `localeCompare(…, { numeric: true })` on purpose:
 * ICU behaviour varies between environments, and a schedule whose row ORDER
 * depends on which machine rendered it fails L6 — same input, same output. A
 * digit-run comparison is a few lines and is the same everywhere.
 */
export function compareMarks(a: string, b: string): number {
  const chunks = (s: string) => s.match(/\d+|\D+/g) ?? []
  const left = chunks(a)
  const right = chunks(b)

  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i]
    const y = right[i]
    const bothNumeric = /^\d/.test(x) && /^\d/.test(y)

    if (bothNumeric) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }

  return left.length - right.length
}

/**
 * Every opening on these walls, grouped into schedule rows.
 *
 * Marked rows first, ordered by mark; the unmarked group last, because it is
 * the residue rather than a unit — it reads as "and these are not scheduled
 * yet", which is what it means.
 *
 * Pure and order-independent: the same walls in any order give the same rows,
 * which is what lets the panel, the PDF and the tests all agree (L6).
 */
export function openingSchedule(walls: Wall[]): ScheduleRow[] {
  const groups = new Map<string | null, Entry[]>()

  for (const wall of walls) {
    for (const opening of wall.openings) {
      const key = opening.mark ?? null
      const group = groups.get(key)
      if (group) group.push({ opening })
      else groups.set(key, [{ opening }])
    }
  }

  const rows: ScheduleRow[] = []
  for (const [mark, entries] of groups) {
    const types = distinctTypes(entries.map((e) => e.opening.type))
    const widths = distinctSizes(entries.map((e) => e.opening.width))
    const heights = distinctSizes(entries.map((e) => e.opening.height))
    const sills = distinctSizes(entries.map((e) => e.opening.sill))

    rows.push({
      mark,
      count: entries.length,
      types,
      widths,
      heights,
      sills,
      // The claim is what makes a difference a conflict — see `conflict`.
      conflict:
        mark !== null &&
        (types.length > 1 ||
          widths.length > 1 ||
          heights.length > 1 ||
          sills.length > 1),
    })
  }

  return rows.sort((a, b) => {
    if (a.mark === null) return 1
    if (b.mark === null) return -1
    return compareMarks(a.mark, b.mark)
  })
}

/** How many openings the schedule accounts for. Equals the total on the walls. */
export const scheduledCount = (rows: ScheduleRow[]): number =>
  rows.reduce((sum, row) => sum + row.count, 0)

/** Rows whose repeated mark does not describe one unit. */
export const conflictingRows = (rows: ScheduleRow[]): ScheduleRow[] =>
  rows.filter((row) => row.conflict)
