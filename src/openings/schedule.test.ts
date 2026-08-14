import { describe, expect, it } from 'vitest'
import {
  compareMarks,
  conflictingRows,
  openingSchedule,
  scheduledCount,
} from './schedule'
import { parseDesign, serializeDesign } from '../persistence/schema'
import type { Opening, OpeningType, Wall } from '../store/useDesignStore'

/**
 * B24 — the door and window schedule.
 *
 * A mark is a CLAIM that the openings carrying it are the same unit. This
 * suite is mostly about what happens when that claim is false, and about the
 * openings that make no claim at all.
 *
 * Every assertion here is a positive delta against a baseline — a count, a
 * row, a flag — never the absence of a token. That rule has now been learned
 * four times in this project (SD14, B22's two catches, B23's arc count), and
 * it is why the conflict test asserts `conflict === true` on the row it names
 * AND `false` on a control row in the same schedule.
 */

let counter = 0
function opening(patch: Partial<Opening> & { type?: OpeningType } = {}): Opening {
  return {
    id: `o${++counter}`,
    type: 'door',
    position: 1,
    width: 0.9,
    height: 2.1,
    sill: 0,
    ...patch,
  }
}

/** One wall carrying all of these openings; the wall itself is incidental. */
function wallOf(...openings: Opening[]): Wall[] {
  return [
    {
      id: 'w1',
      start: { x: 0, z: 0 },
      end: { x: 20, z: 0 },
      height: 3,
      thickness: 0.2,
      openings,
      material: 'white-paint',
      type: 'shell' as const,
    },
  ]
}

const rowFor = (rows: ReturnType<typeof openingSchedule>, mark: string | null) => {
  const found = rows.find((r) => r.mark === mark)
  if (!found) throw new Error(`no row for mark ${String(mark)}`)
  return found
}

describe('★ B24 — grouping by mark', () => {
  it('★ two openings sharing a mark make ONE row with count 2', () => {
    const rows = openingSchedule(
      wallOf(
        opening({ mark: 'D1', position: 2 }),
        opening({ mark: 'D1', position: 6 }),
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rowFor(rows, 'D1').count).toBe(2)
    // …and it is the identical unit it claims to be.
    expect(rowFor(rows, 'D1').conflict).toBe(false)
    expect(rowFor(rows, 'D1').widths).toEqual([0.9])
  })

  it('keeps distinct marks apart', () => {
    const rows = openingSchedule(
      wallOf(
        opening({ mark: 'D1' }),
        opening({ mark: 'D1' }),
        opening({ mark: 'MD', width: 1.2 }),
        opening({ mark: 'W2', type: 'window', height: 1.2, sill: 0.9 }),
      ),
    )

    expect(rows.map((r) => r.mark)).toEqual(['D1', 'MD', 'W2'])
    expect(rows.map((r) => r.count)).toEqual([2, 1, 1])
  })

  it('orders marks so D2 comes before D10, on every machine', () => {
    // `localeCompare(…, { numeric: true })` would do this, but its ICU
    // behaviour varies between environments — and a schedule whose row order
    // depends on the machine that rendered it fails L6.
    const rows = openingSchedule(
      wallOf(
        opening({ mark: 'D10' }),
        opening({ mark: 'D2' }),
        opening({ mark: 'W3' }),
        opening({ mark: 'KW2' }),
      ),
    )
    expect(rows.map((r) => r.mark)).toEqual(['D2', 'D10', 'KW2', 'W3'])
    expect(compareMarks('D2', 'D10')).toBeLessThan(0)
  })

  it('is order-independent — the same walls in any order give the same rows', () => {
    const a = opening({ mark: 'W2', type: 'window' })
    const b = opening({ mark: 'D1' })
    const c = opening({ mark: 'MD', width: 1.2 })

    expect(openingSchedule(wallOf(a, b, c))).toEqual(
      openingSchedule(wallOf(c, a, b)),
    )
  })

  it('groups across walls, not just within one', () => {
    const walls = [
      ...wallOf(opening({ mark: 'D1' })),
      { ...wallOf(opening({ mark: 'D1' }))[0], id: 'w2' },
    ]
    expect(rowFor(openingSchedule(walls), 'D1').count).toBe(2)
  })

  it('does not split one unit on float noise', () => {
    // 0.9 and 0.9000001 are the same door. Distinctness is judged on the
    // millimetre, the same tolerance `plan/rooms.ts` welds at.
    const rows = openingSchedule(
      wallOf(
        opening({ mark: 'D1', width: 0.9 }),
        opening({ mark: 'D1', width: 0.9 + 1e-7 }),
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rowFor(rows, 'D1').widths).toEqual([0.9])
    expect(rowFor(rows, 'D1').conflict).toBe(false)
  })
})

describe('★ B24 — a repeated mark that is not one unit', () => {
  /**
   * ★ The conflict branch, asserted as REACHED rather than as "something
   * rendered".
   *
   * The control is the second row in the SAME schedule: `D1` must be flagged
   * and `W2` must not, in one call. A test that only asserted `conflict` on
   * the bad row would pass equally against a build that flagged every row.
   */
  /*
   * Demonstrated red (SD5) by forcing `conflict` to `false` in
   * `openingSchedule`: `expected false to be true`, on this test and on the
   * two below it, while every grouping and counting assertion stayed green —
   * i.e. the schedule still worked and had simply stopped checking the claim,
   * which is exactly the silent failure the flag exists to prevent.
   */
  it('★ flags the row, and only that row', () => {
    const rows = openingSchedule(
      wallOf(
        opening({ mark: 'D1', width: 0.9 }),
        opening({ mark: 'D1', width: 1.05 }),
        opening({ mark: 'W2', type: 'window', width: 1.2 }),
        opening({ mark: 'W2', type: 'window', width: 1.2 }),
      ),
    )

    const d1 = rowFor(rows, 'D1')
    expect(d1.conflict).toBe(true)
    // Both sizes SHOWN, ascending — not collapsed to one, not split into two
    // rows. You cannot fix a mark conflict without being told what the values
    // actually are.
    expect(d1.widths).toEqual([0.9, 1.05])
    expect(d1.count).toBe(2)

    // The control, in the same schedule.
    expect(rowFor(rows, 'W2').conflict).toBe(false)
    expect(conflictingRows(rows).map((r) => r.mark)).toEqual(['D1'])
  })

  it('flags a differing type under one mark', () => {
    // `D1` used on a door and on a window is the same error as two widths.
    const rows = openingSchedule(
      wallOf(
        opening({ mark: 'D1' }),
        opening({ mark: 'D1', type: 'window' }),
      ),
    )
    expect(rowFor(rows, 'D1').conflict).toBe(true)
    expect(rowFor(rows, 'D1').types).toEqual(['door', 'window'])
  })

  it('flags differing heights and sills, not only widths', () => {
    const byHeight = openingSchedule(
      wallOf(opening({ mark: 'D1' }), opening({ mark: 'D1', height: 2.4 })),
    )
    const bySill = openingSchedule(
      wallOf(
        opening({ mark: 'W2', type: 'window' }),
        opening({ mark: 'W2', type: 'window', sill: 1.2 }),
      ),
    )
    expect(rowFor(byHeight, 'D1').conflict).toBe(true)
    expect(rowFor(bySill, 'W2').conflict).toBe(true)
  })
})

describe('★ B24 — openings that make no claim', () => {
  it('accounts for unmarked openings in their own row', () => {
    const rows = openingSchedule(
      wallOf(
        opening({ mark: 'D1' }),
        opening(),
        opening({ type: 'window', width: 1.2 }),
      ),
    )

    const unmarked = rowFor(rows, null)
    expect(unmarked.count).toBe(2)
    // Every opening on the walls reaches the schedule. This is the assertion
    // that stops a future "hide the unmarked ones" change losing half a plan.
    expect(scheduledCount(rows)).toBe(3)
  })

  it('never flags the unmarked row, however varied it is', () => {
    // Varying sizes among unmarked openings is not a conflict: no claim was
    // made about them. Flagging it would put a warning on every document in
    // existence — every one predates `mark` — and teach people to ignore it.
    const rows = openingSchedule(
      wallOf(
        opening({ width: 0.9 }),
        opening({ width: 1.2, type: 'window' }),
        opening({ width: 2.0, type: 'cased' }),
      ),
    )

    const unmarked = rowFor(rows, null)
    expect(unmarked.conflict).toBe(false)
    expect(unmarked.count).toBe(3)
    expect(unmarked.widths).toEqual([0.9, 1.2, 2])
    expect(conflictingRows(rows)).toEqual([])
  })

  it('sorts the unmarked row last', () => {
    const rows = openingSchedule(
      wallOf(opening(), opening({ mark: 'W3' }), opening({ mark: 'D1' })),
    )
    expect(rows.map((r) => r.mark)).toEqual(['D1', 'W3', null])
  })

  it('is empty when there are no openings at all', () => {
    expect(openingSchedule(wallOf())).toEqual([])
    expect(scheduledCount(openingSchedule(wallOf()))).toBe(0)
  })
})

describe('★ B24 — mark survives the file', () => {
  /*
   * Demonstrated red by dropping `...(mark ? { mark } : {})` from
   * `parseOpening`: `expected undefined to be 'MD'`. The document saved the
   * mark and lost it on the way back in, which is the failure that would have
   * shipped silently — nothing else in the suite notices.
   */
  it('★ round-trips through save and load, present and absent', () => {
    const doc = serializeDesign({
      name: 'marks',
      viewMode: '2d',
      savedAt: '2026-08-10T00:00:00.000Z',
      walls: wallOf(
        opening({ mark: 'MD', width: 1.2, position: 2 }),
        opening({ position: 6 }),
      ),
    })

    const result = parseDesign(JSON.parse(JSON.stringify(doc)))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const [marked, bare] = result.doc.walls[0].openings
    expect(marked.mark).toBe('MD')
    expect(bare.mark).toBeUndefined()
    // And the schedule built from the RELOADED document says the same thing.
    expect(openingSchedule(result.doc.walls).map((r) => [r.mark, r.count])).toEqual(
      [['MD', 1], [null, 1]],
    )
  })

  it('trims a mark, and drops a blank one entirely', () => {
    // `''` and `undefined` must not both be able to mean "unmarked", or the
    // schedule would show an empty mark as a unit distinct from no mark.
    const result = parseDesign({
      version: 4,
      name: 'x',
      savedAt: '2026-08-10T00:00:00.000Z',
      settings: { viewMode: '2d' },
      walls: [
        {
          id: 'w1',
          start: { x: 0, z: 0 },
          end: { x: 20, z: 0 },
          height: 3,
          thickness: 0.2,
          material: 'white-paint',
          type: 'shell' as const,
          openings: [
            { id: 'a', type: 'door', position: 2, width: 0.9, height: 2.1, sill: 0, mark: '  D1  ' },
            { id: 'b', type: 'door', position: 6, width: 0.9, height: 2.1, sill: 0, mark: '   ' },
            { id: 'c', type: 'door', position: 9, width: 0.9, height: 2.1, sill: 0, mark: 42 },
          ],
        },
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [a, b, c] = result.doc.walls[0].openings
    expect(a.mark).toBe('D1')
    expect(b.mark).toBeUndefined()
    // A non-string is dropped like any other malformed field, not coerced.
    expect(c.mark).toBeUndefined()
    expect(rowFor(openingSchedule(result.doc.walls), null).count).toBe(2)
  })
})
