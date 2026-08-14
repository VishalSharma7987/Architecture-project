import { describe, expect, it } from 'vitest'
import { DEFAULT_WALL_MATERIAL } from '../materials/palette'
import type { Point, Wall } from '../store/useDesignStore'
import { bearingOf, normalizeDegrees, sectorOf, snapNorth } from '../site/orientation'
import { buildableRect, frontEdge, plotRect, rectArea, wallsOutsideBuildable } from '../site/plot'
import { fromNorthUp, toNorthUp, vastuZones, zoneFrame, zoneOfPoint } from './zones'

/**
 * The site frame: bearings, setbacks, and the nine-zone grid.
 *
 * §4 invariant 5: `zoneFrame` rotates the plan to north-up FIRST and takes the
 * bounding box THERE. Reversing it shears the grid off the compass on every
 * plot that is not square — invisible on a square plan and wrong on all the
 * others. That is the first test below.
 */

let n = 0
const wall = (a: Point, b: Point): Wall => ({
  id: `w${n++}`,
  start: a,
  end: b,
  height: 3,
  thickness: 0.2,
  openings: [],
  material: DEFAULT_WALL_MATERIAL,
  type: 'shell' as const,
})

/** A rectangle wider than it is deep, so rotation is observable. */
const OBLONG = [
  wall({ x: -6, z: -2 }, { x: 6, z: -2 }),
  wall({ x: 6, z: -2 }, { x: 6, z: 2 }),
  wall({ x: 6, z: 2 }, { x: -6, z: 2 }),
  wall({ x: -6, z: 2 }, { x: -6, z: -2 }),
]

describe('★ the zone grid belongs to the compass — §4 invariant 5', () => {
  it('is 12x4 in the plan frame when north is up', () => {
    const frame = zoneFrame(OBLONG, 0)!
    const cell = frame.cells[0]
    expect(cell.maxX - cell.minX).toBeCloseTo(4, 9)
    expect(cell.maxZ - cell.minZ).toBeCloseTo(4 / 3, 9)
  })

  it('★ rotates the PLAN before taking the box, not the labels after', () => {
    // At 90° the oblong lies across the north-up frame the other way round, so
    // the cells must swap proportions. If the box were taken first and the
    // labels rotated afterwards, the cells would keep their plan-frame shape
    // and the whole grid would be sheared off the compass.
    const frame = zoneFrame(OBLONG, 90)!
    const cell = frame.cells[0]
    expect(cell.maxX - cell.minX).toBeCloseTo(4 / 3, 6)
    expect(cell.maxZ - cell.minZ).toBeCloseTo(4, 6)
  })

  it('puts the north-east zone in the real north-east however the plot is turned', () => {
    // The whole point: a plot turned 30° off north still has its NE corner in
    // the actual north-east.
    for (const north of [0, 30, 90, 217]) {
      const frame = zoneFrame(OBLONG, north)!
      const ne = frame.cells.find((c) => c.zone === 'NE')!
      // In the north-up frame, north-east is max-x / min-z by construction.
      const maxX = Math.max(...frame.cells.map((c) => c.maxX))
      const minZ = Math.min(...frame.cells.map((c) => c.minZ))
      expect(ne.maxX).toBeCloseTo(maxX, 6)
      expect(ne.minZ).toBeCloseTo(minZ, 6)
    }
  })

  it('is null with no walls, so an empty plan reports no grid at all', () => {
    // A zero-sized box would report every point as Centre.
    expect(zoneFrame([], 0)).toBeNull()
    expect(vastuZones([], 0)).toEqual([])
  })

  it('round-trips a point through the north-up frame', () => {
    const pivot = { x: 1, z: -2 }
    const point = { x: 4, z: 7 }
    for (const north of [0, 47, 180, 359]) {
      const there = toNorthUp(point, pivot, north)
      const back = fromNorthUp(there, pivot, north)
      expect(back.x).toBeCloseTo(point.x, 9)
      expect(back.z).toBeCloseTo(point.z, 9)
    }
  })

  it('draws nine cells that tile the plan', () => {
    const cells = vastuZones(OBLONG, 0)
    expect(cells).toHaveLength(9)
    expect(new Set(cells.map((c) => c.zone)).size).toBe(9)
  })

  it('locates a point in the zone the compass says it is in', () => {
    // North-up: -z is north, +x is east.
    expect(zoneOfPoint({ x: 5, z: -1.5 }, OBLONG, 0)).toBe('NE')
    expect(zoneOfPoint({ x: 0, z: 0 }, OBLONG, 0)).toBe('C')
    expect(zoneOfPoint({ x: -5, z: 1.5 }, OBLONG, 0)).toBe('SW')
  })

  it('returns null for a point outside the grid', () => {
    expect(zoneOfPoint({ x: 100, z: 100 }, OBLONG, 0)).toBeNull()
  })
})

describe('orientation', () => {
  it('folds any angle into [0, 360)', () => {
    expect(normalizeDegrees(-30)).toBe(330)
    expect(normalizeDegrees(450)).toBe(90)
    expect(normalizeDegrees(Number.NaN)).toBe(0)
  })

  it('measures bearings clockwise from plan-up', () => {
    expect(bearingOf(0, -1, 0)).toBeCloseTo(0, 9) // -z is north
    expect(bearingOf(1, 0, 0)).toBeCloseTo(90, 9) // +x is east
    expect(bearingOf(0, 1, 0)).toBeCloseTo(180, 9)
  })

  it('shifts every reading when north rotates', () => {
    expect(bearingOf(1, 0, 90)).toBeCloseTo(0, 9)
  })

  it('★ centres each sector on its own bearing, not at its edge', () => {
    // North runs 337.5°..22.5°, not 0°..45°. Getting this wrong rotates every
    // reading by half a sector — invisible on a square plot, wrong on the rest.
    expect(sectorOf(0)).toBe('N')
    expect(sectorOf(22)).toBe('N')
    expect(sectorOf(23)).toBe('NE')
    expect(sectorOf(338)).toBe('N')
    expect(sectorOf(337)).toBe('NW')
  })

  it('snaps a compass drag to a true direction, but only when close', () => {
    expect(snapNorth(359)).toBe(0)
    expect(snapNorth(43)).toBe(45)
    expect(snapNorth(30)).toBe(30)
  })
})

describe('plot setbacks', () => {
  const plot = {
    width: 10,
    depth: 20,
    origin: { x: 0, z: 0 },
    setbacks: { front: 3, rear: 2, left: 1, right: 1.5 },
  }

  it('measures the plot', () => {
    expect(rectArea(plotRect(plot))).toBe(200)
  })

  it('★ moves the front edge with the facing and the north rotation', () => {
    // "Front setback" has to mean what it means on a sanction drawing: the
    // side the plot faces, not the bottom of the page.
    expect(frontEdge('N', 0)).toBe('top')
    expect(frontEdge('E', 0)).toBe('right')
    expect(frontEdge('S', 0)).toBe('bottom')
    // Rotating north to point right swings the front with it.
    expect(frontEdge('N', 90)).toBe('right')
  })

  it('applies each setback to the edge it names', () => {
    const inner = buildableRect(plot, 'N', 0)!
    // Front is the top, so it eats into minZ.
    expect(inner.minZ).toBe(3)
    expect(inner.maxZ).toBe(20 - 2)
    // Left and right are as seen standing at the front looking in.
    expect(inner.maxX - inner.minX).toBeCloseTo(10 - 1 - 1.5, 9)
  })

  it('swaps left and right as the front moves around the plot', () => {
    const facingNorth = buildableRect(plot, 'N', 0)!
    const facingSouth = buildableRect(plot, 'S', 0)!
    expect(facingNorth.minX).not.toBe(facingSouth.minX)
  })

  it('★ is null when the setbacks meet, rather than an inverted rectangle', () => {
    // An inverted rect would have every downstream check measuring a negative
    // box — the area statement, the violation test and the plan hatch.
    const impossible = { ...plot, setbacks: { front: 12, rear: 12, left: 1, right: 1 } }
    expect(buildableRect(impossible, 'N', 0)).toBeNull()
  })

  it('measures a wall by its outer face, not its centreline', () => {
    // A wall sitting exactly on the setback line still has half its thickness
    // over it, and that is the half a drawing gets rejected for.
    const inner = buildableRect(plot, 'N', 0)!
    // Inside the buildable box on x. Note `inner.minX` is 1.5, not 1: the
    // client's "left" setback lands on the page's RIGHT edge for a
    // north-facing plot, which is what the previous test is about.
    const x0 = inner.minX + 0.5
    const x1 = inner.maxX - 0.5

    const onTheLine = wall({ x: x0, z: inner.minZ }, { x: x1, z: inner.minZ })
    const wellInside = wall({ x: x0, z: inner.minZ + 1 }, { x: x1, z: inner.minZ + 1 })

    expect(wallsOutsideBuildable([onTheLine], inner)).toEqual([])
    expect(wallsOutsideBuildable([wellInside], inner)).toEqual([])

    const over = wall({ x: x0, z: inner.minZ - 0.05 }, { x: x1, z: inner.minZ - 0.05 })
    const [violation] = wallsOutsideBuildable([over], inner)
    expect(violation.overhang).toBeCloseTo(0.05 + 0.1, 9)
  })

  it('treats every wall as over the line when nothing is buildable', () => {
    const walls = [wall({ x: 0, z: 0 }, { x: 1, z: 0 })]
    expect(wallsOutsideBuildable(walls, null)).toHaveLength(1)
  })
})
