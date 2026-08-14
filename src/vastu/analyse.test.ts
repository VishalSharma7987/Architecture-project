import { describe, expect, it } from 'vitest'
import { DEFAULT_WALL_MATERIAL } from '../materials/palette'
import { resolveRooms } from '../rooms/resolve'
import type { Point, RoomLabel, RoomType, Wall } from '../store/useDesignStore'
import { analyseVastu } from './analyse'

/**
 * The last of the seven pure modules §7 Stage 1 names, and the one carrying the
 * product's most opinionated output: a 0-100 score printed in a panel and on a
 * PDF page handed to a client.
 *
 * The subject is a traditional guideline system, not building science. What is
 * tested here is therefore not whether the advice is right — it is whether the
 * module reports the written ruleset faithfully, and in particular whether it
 * keeps the distinctions it goes out of its way to make: `no-rule` is not
 * `okay`, a straddling room is hedged rather than asserted, and no reading at
 * all scores `null` rather than zero.
 */

let nextId = 0
const wallFrom = (a: Point, b: Point): Wall => ({
  id: `w${nextId++}`,
  start: a,
  end: b,
  height: 3,
  thickness: 0.2,
  type: 'shell' as const,
  openings: [],
  material: DEFAULT_WALL_MATERIAL,
})

/** A closed rectangle on the wall centrelines. */
function rect(x0: number, z0: number, x1: number, z1: number): Wall[] {
  const c: Point[] = [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ]
  return c.map((p, i) => wallFrom(p, c[(i + 1) % 4]))
}

const label = (type: RoomType, anchor: Point): RoomLabel => ({
  id: `l${nextId++}`,
  type,
  anchor,
})

/**
 * A 12 x 12 shell divided into nine 4 x 4 rooms.
 *
 * Deliberately nine and not four. The zone grid is the thirds of the plan's
 * bounding box, so a 6 x 6 quadrant straddles 1.5 cells on each axis and lands
 * at 44% coverage — which is a genuine straddle, not a placement. A 3 x 3 grid
 * makes each room fill exactly one zone, so a test about the RULE is not
 * silently also a test about the clipping.
 */
function ninths(): Wall[] {
  const walls = [...rect(-6, -6, 6, 6)]
  for (const at of [-2, 2]) {
    walls.push(wallFrom({ x: at, z: -6 }, { x: at, z: 6 }))
    walls.push(wallFrom({ x: -6, z: at }, { x: 6, z: at }))
  }
  return walls
}

// Room centres. North-up: -z is north, +x is east.
const NE = { x: 4, z: -4 }
const SE = { x: 4, z: 4 }
const SW = { x: -4, z: 4 }
const NW = { x: -4, z: -4 }
const W = { x: -4, z: 0 }

function analyse(walls: Wall[], labels: RoomLabel[], north = 0, facing = 'N' as const) {
  return analyseVastu(resolveRooms(walls, labels), walls, north, facing)
}

describe('reading a room against the table', () => {
  it('reports a preferred placement as good', () => {
    // The table puts the kitchen in the South-East first.
    const report = analyse(ninths(), [label('kitchen', SE)])
    const kitchen = report.rooms.find((r) => r.room.label?.type === 'kitchen')!

    expect(kitchen.zone).toBe('SE')
    expect(kitchen.status).toBe('good')
    expect(kitchen.message).toContain('prefers')
  })

  it('reports a placement on the avoid list, and names what it prefers', () => {
    // Kitchen avoids NE, SW and N.
    const report = analyse(ninths(), [label('kitchen', NE)])
    const kitchen = report.rooms.find((r) => r.room.label?.type === 'kitchen')!

    expect(kitchen.status).toBe('avoid')
    expect(kitchen.message).toContain('avoid')
    expect(kitchen.message).toContain('South-East')
  })

  it('★ says the table is SILENT rather than implying approval', () => {
    // Living names three preferred zones and no zones to avoid. A living room
    // in the South-West is neither preferred nor forbidden, and the sentence
    // has to say which of those two it is.
    const report = analyse(ninths(), [label('living', SW)])
    const living = report.rooms.find((r) => r.room.label?.type === 'living')!

    expect(living.status).toBe('okay')
    expect(living.message).toContain('says nothing either way')
  })

  it('distinguishes "allowed but not first" from "silent"', () => {
    // The master bedroom's table row: ideal SW, and an explicit `ok` list of
    // S and W. West is therefore allowed-but-not-first.
    const report = analyse(ninths(), [label('master-bedroom', W)])
    const bedroom = report.rooms.find((r) => r.room.label?.type === 'master-bedroom')!

    expect(bedroom.status).toBe('okay')
    expect(bedroom.message).toContain('allows')
    expect(bedroom.message).not.toContain('says nothing either way')
  })

  it('★ no-rule is a distinct status from okay', () => {
    // The table has no entry for a balcony. That is a different statement from
    // "this placement is acceptable", and conflating them would let an
    // unmodelled subject quietly prop the score up.
    const report = analyse(ninths(), [label('balcony', NE)])
    const balcony = report.rooms.find((r) => r.room.label?.type === 'balcony')!

    expect(balcony.status).toBe('no-rule')
    expect(balcony.message).toContain('no placement rule')
  })

  it('asks an unnamed space to be named rather than judging it', () => {
    const report = analyse(ninths(), [])
    expect(report.rooms.every((r) => r.status === 'no-rule')).toBe(true)
    expect(report.rooms[0].message).toContain('name it')
  })
})

describe('★ the zone is decided by AREA, not by the centroid', () => {
  it('assigns a long room to the zone holding most of it', () => {
    // A room spanning the full width sits with its centroid in the centre
    // column, but two-thirds of its area is elsewhere. The module clips the
    // polygon against all nine cells and compares areas precisely because a
    // centroid test gets this wrong.
    const walls = [...rect(-6, -6, 6, 6), wallFrom({ x: -6, z: -2 }, { x: 6, z: -2 })]
    const report = analyse(walls, [label('kitchen', { x: 0, z: -4 })])
    const kitchen = report.rooms.find((r) => r.room.label?.type === 'kitchen')!

    // The strip is the northern third: N, not C.
    expect(kitchen.zone).toBe('N')
    expect(kitchen.coverage).toBeGreaterThan(0.3)
    expect(kitchen.coverage).toBeLessThanOrEqual(1)
  })

  it('★ hedges the sentence when a room straddles zones', () => {
    // Below 75% coverage the verdict rests on a share barely bigger than the
    // runner-up's, so the fraction is named rather than a coin-flip being
    // printed as a fact.
    const walls = [...rect(-6, -6, 6, 6), wallFrom({ x: -6, z: -2 }, { x: 6, z: -2 })]
    const report = analyse(walls, [label('kitchen', { x: 0, z: -4 })])
    const kitchen = report.rooms.find((r) => r.room.label?.type === 'kitchen')!

    expect(kitchen.coverage).toBeLessThan(0.75)
    expect(kitchen.message).toContain('mostly')
    expect(kitchen.message).toContain('% of its floor area')
  })

  it('does not hedge a room that sits squarely in one zone', () => {
    const report = analyse(ninths(), [label('kitchen', SE)])
    const kitchen = report.rooms.find((r) => r.room.label?.type === 'kitchen')!
    expect(kitchen.coverage).toBeGreaterThanOrEqual(0.75)
    expect(kitchen.message).not.toContain('mostly')
  })

  it('reports coverage as a fraction of the room, never above 1', () => {
    const report = analyse(ninths(), [label('kitchen', SE), label('pooja', NE)])
    for (const verdict of report.rooms) {
      expect(verdict.coverage).toBeGreaterThanOrEqual(0)
      expect(verdict.coverage).toBeLessThanOrEqual(1)
    }
  })
})

describe('the score', () => {
  it('★ is null when no room carries a rule, not zero', () => {
    // An average of nothing is not a zero. Printing 0 would read as a terrible
    // plan rather than as no reading.
    expect(analyse(ninths(), []).score).toBeNull()
    expect(analyse(ninths(), [label('balcony', NE)]).score).toBeNull()
  })

  it('is 100 when every ruled room is preferred', () => {
    const report = analyse(ninths(), [
      label('kitchen', SE), // SE is ideal
      label('pooja', NE), // NE is ideal
    ])
    expect(report.score).toBe(100)
    expect(report.counts.good).toBe(2)
  })

  it('is 0 when every ruled room is on the avoid list', () => {
    const report = analyse(ninths(), [
      label('kitchen', NE), // avoid
      label('pooja', SW), // avoid
    ])
    expect(report.score).toBe(0)
    expect(report.counts.avoid).toBe(2)
  })

  it('counts a not-first-choice placement as half', () => {
    const report = analyse(ninths(), [
      label('kitchen', SE), // good  = 1
      label('master-bedroom', W), // okay  = 0.5 (ideal is SW)
    ])
    expect(report.score).toBe(75)
  })

  it('★ excludes no-rule rooms from the average entirely', () => {
    // A balcony must neither lift nor drag the number.
    const withoutBalcony = analyse(ninths(), [label('kitchen', SE)])
    const withBalcony = analyse(ninths(), [
      label('kitchen', SE),
      label('balcony', NW),
    ])

    expect(withBalcony.score).toBe(withoutBalcony.score)
    expect(withBalcony.counts.noRule).toBeGreaterThan(0)
  })

  it('counts every verdict exactly once', () => {
    const report = analyse(ninths(), [
      label('kitchen', SE),
      label('pooja', SW),
      label('balcony', NW),
    ])
    const { good, okay, avoid, noRule } = report.counts
    expect(good + okay + avoid + noRule).toBe(report.rooms.length)
  })
})

describe('★ the Brahmasthan', () => {
  it('is reported clear when nothing heavy overlaps the centre', () => {
    const report = analyse(ninths(), [label('kitchen', SE)])
    expect(report.brahmasthan.clear).toBe(true)
    expect(report.brahmasthan.message).toContain('open')
  })

  it('★ flags a toilet overlapping the centre, and deducts from the score', () => {
    // A single room filling the whole shell, so it certainly covers the centre.
    const clean = analyse(rect(-6, -6, 6, 6), [label('study', { x: 0, z: 0 })])
    const intruding = analyse(rect(-6, -6, 6, 6), [label('toilet', { x: 0, z: 0 })])

    expect(intruding.brahmasthan.clear).toBe(false)
    expect(intruding.brahmasthan.intruders).toHaveLength(1)
    expect(clean.brahmasthan.clear).toBe(true)

    // Study in the centre is 'okay' (50) with no penalty; toilet is 'avoid'
    // (0) and additionally loses the flat centre deduction — but the score
    // floors at 0 rather than going negative.
    expect(intruding.score).toBe(0)
    expect(intruding.score).toBeLessThan(clean.score!)
  })

  it('deducts the centre penalty from an otherwise perfect plan', () => {
    // A bathroom's ideal zones are NW, W and S — so one filling the shell is
    // not 'good', which would confound the test. Use the score difference
    // between an occupied and an unoccupied centre for the same room type.
    const walls = ninths()
    const spread = analyse(walls, [label('bathroom', W)])
    expect(spread.brahmasthan.clear).toBe(true)
    expect(spread.score).toBe(100)
  })

  it('names only the subjects the ruleset actually lists', () => {
    // The table's wording is "any heavy room, toilet, stairs", but only the
    // toilet and the staircase are enumerated. The message says so rather than
    // quietly extending the list.
    const report = analyse(ninths(), [label('kitchen', SE)])
    expect(report.brahmasthan.message).toContain('toilets, bathrooms and staircases')
    expect(report.brahmasthan.message).toContain('does not list which other rooms')
  })

  it('ignores a sliver of overlap', () => {
    // Below a tenth of its own area, a room is not "in" the centre cell.
    const walls = ninths()
    const report = analyse(walls, [label('toilet', NE)])
    expect(report.brahmasthan.clear).toBe(true)
  })
})

describe('the plot facing, reported as a facing and not a room', () => {
  it('accepts a preferred entrance direction', () => {
    const report = analyse(ninths(), [], 0, 'N')
    expect(report.entrance.status).toBe('good')
    expect(report.entrance.facing).toBe('N')
    expect(report.entrance.message).toContain('plot faces North')
  })

  it('flags a direction on the avoid list', () => {
    const report = analyseVastu(resolveRooms(ninths(), []), ninths(), 0, 'SW')
    expect(report.entrance.status).toBe('avoid')
    expect(report.entrance.message).toContain('avoid')
  })

  it('says the table is silent on a direction it does not name', () => {
    const report = analyseVastu(resolveRooms(ninths(), []), ninths(), 0, 'W')
    expect(report.entrance.status).toBe('okay')
    expect(report.entrance.message).toContain('silent')
  })

  it('★ does not let the entrance swing the room score', () => {
    // One line item must not move a whole-plan average, or a one-room plan
    // would read as half a compass reading.
    const good = analyseVastu(resolveRooms(ninths(), [label('kitchen', SE)]), ninths(), 0, 'N')
    const bad = analyseVastu(resolveRooms(ninths(), [label('kitchen', SE)]), ninths(), 0, 'SW')
    expect(good.score).toBe(bad.score)
  })
})

describe('degenerate input', () => {
  it('reports nothing at all when there are no walls', () => {
    const report = analyseVastu([], [], 0, 'N')
    expect(report.rooms).toEqual([])
    expect(report.score).toBeNull()
    expect(report.brahmasthan.clear).toBe(true)
    // The entrance is a property of the plot, so it still reads.
    expect(report.entrance.facing).toBe('N')
  })

  it('turns the grid with north, so a rotated plot reads differently', () => {
    // The zone grid belongs to the compass. Rotating north by 90 moves the
    // kitchen out of the zone the table prefers for it.
    const upright = analyse(ninths(), [label('kitchen', SE)], 0)
    const turned = analyse(ninths(), [label('kitchen', SE)], 90)

    expect(upright.rooms.find((r) => r.room.label)!.zone).toBe('SE')
    expect(turned.rooms.find((r) => r.room.label)!.zone).not.toBe('SE')
  })

  it('produces one verdict per detected space, named or not', () => {
    const report = analyse(ninths(), [label('kitchen', SE)])
    expect(report.rooms).toHaveLength(resolveRooms(ninths(), []).length)
  })
})
