import { describe, expect, it } from 'vitest'
import { DEFAULT_WALL_MATERIAL } from '../materials/palette'
import { containsPoint, resolveRooms, roomSize } from '../rooms/resolve'
import type { Point, RoomLabel, Wall } from '../store/useDesignStore'
import { detectRooms, totalFloorArea } from './rooms'

/**
 * Room detection: a planar-graph face traversal, and the source of every area
 * figure in the app — the status bar, the room schedule, the Vastu analysis,
 * the area statement, the cost estimate.
 *
 * §3 says the algorithm is correct and must not be rewritten, only indexed.
 * These tests pin the behaviour so that the O(n²) work at B8 can be verified
 * to change nothing but the speed.
 */

let nextId = 0
function wallFrom(a: Point, b: Point, thickness = 0.2): Wall {
  return {
    id: `w${nextId++}`,
    start: a,
    end: b,
    height: 3,
    thickness,
    type: 'shell' as const,
    openings: [],
    material: DEFAULT_WALL_MATERIAL,
  }
}

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

describe('detectRooms', () => {
  it('finds a single closed rectangle', () => {
    const rooms = detectRooms(rect(0, 0, 4, 3))
    expect(rooms).toHaveLength(1)
    expect(rooms[0].area).toBeCloseTo(12, 9)
  })

  it('finds nothing when the loop is open', () => {
    // Three sides of a rectangle enclose no space, and `pruneDangles` removes
    // every edge because each has a free end.
    expect(detectRooms(rect(0, 0, 4, 3).slice(0, 3))).toEqual([])
  })

  it('★ splits at a T-junction so a partition makes two rooms', () => {
    // Without `splitAtIntersections` there is no node where the partition meets
    // the shell, the traversal walks straight past, and the two rooms come back
    // as one — the specific failure that function exists to prevent.
    const walls = [...rect(0, 0, 6, 4), wallFrom({ x: 3, z: 0 }, { x: 3, z: 4 })]
    const rooms = detectRooms(walls)

    expect(rooms).toHaveLength(2)
    expect(rooms[0].area).toBeCloseTo(12, 9)
    expect(rooms[1].area).toBeCloseTo(12, 9)
  })

  it('discards the unbounded outer face by winding sign', () => {
    // A correct traversal produces one bounded face per room PLUS the infinite
    // face around the building. Only the sign tells them apart.
    const rooms = detectRooms(rect(0, 0, 4, 3))
    expect(rooms).toHaveLength(1)
  })

  it('orders rooms largest first', () => {
    const walls = [...rect(0, 0, 10, 4), wallFrom({ x: 3, z: 0 }, { x: 3, z: 4 })]
    const areas = detectRooms(walls).map((r) => r.area)
    expect(areas).toEqual([...areas].sort((a, b) => b - a))
  })

  it('★ handles an L-shaped room', () => {
    // Six walls, one concave corner. A bounding-box or nearest-centroid method
    // gets this wrong; a face traversal does not.
    const c: Point[] = [
      { x: 0, z: 0 },
      { x: 6, z: 0 },
      { x: 6, z: 2 },
      { x: 3, z: 2 },
      { x: 3, z: 5 },
      { x: 0, z: 5 },
    ]
    const walls = c.map((p, i) => wallFrom(p, c[(i + 1) % c.length]))
    const rooms = detectRooms(walls)

    expect(rooms).toHaveLength(1)
    // 6x2 plus 3x3 = 21.
    expect(rooms[0].area).toBeCloseTo(21, 9)
  })

  it('prunes a dangling spur rather than detouring up and back', () => {
    const walls = [...rect(0, 0, 4, 3), wallFrom({ x: 4, z: 1 }, { x: 7, z: 1 })]
    const rooms = detectRooms(walls)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].area).toBeCloseTo(12, 9)
  })

  it('welds corners that miss by under a millimetre', () => {
    const walls = rect(0, 0, 4, 3)
    walls[0] = wallFrom({ x: 0, z: 0 }, { x: 4, z: 0.0005 })
    expect(detectRooms(walls)).toHaveLength(1)
  })

  it('still closes when an end overshoots ONTO another wall', () => {
    // Worth pinning because it is stronger than the 1 mm weld suggests: the
    // top wall ends 50 mm down the right wall's span, far past the weld
    // tolerance, but `splitAtIntersections` puts a node exactly there and the
    // loop closes anyway. This is what makes hand-traced and detected walls
    // usable without pixel-perfect corners.
    const walls = rect(0, 0, 4, 3)
    walls[0] = wallFrom({ x: 0, z: 0 }, { x: 4, z: 0.05 })

    const rooms = detectRooms(walls)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].area).toBeCloseTo(11.9, 6)
  })

  it('does NOT close when an end stops short of everything', () => {
    // A genuine gap: the top wall stops 200 mm before the corner and touches
    // no other wall, so every edge is pruned as a dangle and nothing encloses.
    const walls = rect(0, 0, 4, 3)
    walls[0] = wallFrom({ x: 0, z: 0 }, { x: 3.8, z: 0 })
    expect(detectRooms(walls)).toEqual([])
  })

  it('ignores zero-length walls', () => {
    const walls = [...rect(0, 0, 4, 3), wallFrom({ x: 2, z: 2 }, { x: 2, z: 2 })]
    expect(detectRooms(walls)).toHaveLength(1)
  })

  it('measures to wall centrelines, and therefore overstates', () => {
    // Stated openly in the module and printed on every document. A 4x3 room
    // with 200 mm walls has 3.8x2.8 = 10.64 m² of floor and reports 12 m².
    expect(totalFloorArea(rect(0, 0, 4, 3))).toBeCloseTo(12, 9)
  })
})

describe('★ containsPoint — §4 invariant 8', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 4 },
    { x: 0, z: 4 },
  ]

  it('is true inside and false outside', () => {
    expect(containsPoint(square, { x: 2, z: 2 })).toBe(true)
    expect(containsPoint(square, { x: 5, z: 2 })).toBe(false)
    expect(containsPoint(square, { x: 2, z: -1 })).toBe(false)
  })

  it('awards a point on a shared wall to exactly one room, never both', () => {
    // The half-open comparisons are deliberate. Which side wins matters far
    // less than that it always wins: a label sitting on a wall must not
    // flicker between the rooms either side of it as the plan redraws.
    const left = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 4 },
      { x: 0, z: 4 },
    ]
    const right = [
      { x: 2, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 4 },
      { x: 2, z: 4 },
    ]
    const onTheWall = { x: 2, z: 2 }

    const inLeft = containsPoint(left, onTheWall)
    const inRight = containsPoint(right, onTheWall)
    expect(inLeft !== inRight).toBe(true)

    // And stably so, however many times it is asked.
    for (let i = 0; i < 10; i++) {
      expect(containsPoint(left, onTheWall)).toBe(inLeft)
      expect(containsPoint(right, onTheWall)).toBe(inRight)
    }
  })
})

describe('resolveRooms', () => {
  const label = (id: string, anchor: Point): RoomLabel => ({
    id,
    type: 'living',
    anchor,
  })

  it('attaches a name by containment, not by id', () => {
    const rooms = resolveRooms(rect(0, 0, 4, 3), [label('a', { x: 2, z: 1.5 })])
    expect(rooms[0].label?.id).toBe('a')
  })

  it('detaches a name whose space no longer contains it', () => {
    const rooms = resolveRooms(rect(0, 0, 4, 3), [label('a', { x: 20, z: 20 })])
    expect(rooms[0].label).toBeNull()
  })

  it('gives one enclosure its FIRST name and lists the rest as open-plan zones', () => {
    // A deleted partition merges two named rooms. The earliest label owns the
    // area so the merged room keeps reading as the room it already was.
    const rooms = resolveRooms(rect(0, 0, 6, 4), [
      label('first', { x: 1, z: 2 }),
      label('second', { x: 5, z: 2 }),
    ])
    expect(rooms[0].label?.id).toBe('first')
    expect(rooms[0].extraLabels.map((l) => l.id)).toEqual(['second'])
  })

  it('puts the caption point inside the room, even for an L', () => {
    // The area-weighted centroid of an L falls outside it — a "Kitchen"
    // caption floating in the hallway. The containment check catches that and
    // falls back to the widest interior chord.
    const c: Point[] = [
      { x: 0, z: 0 },
      { x: 6, z: 0 },
      { x: 6, z: 2 },
      { x: 3, z: 2 },
      { x: 3, z: 8 },
      { x: 0, z: 8 },
    ]
    const walls = c.map((p, i) => wallFrom(p, c[(i + 1) % c.length]))
    const [room] = resolveRooms(walls, [])

    expect(containsPoint(room.polygon, room.centroid)).toBe(true)
  })

  it('roomSize reports width across and length down, not sorted by size', () => {
    // Matches how a blueprint writes it, so the two numbers line up with the
    // drawing even when the room is deeper than it is wide.
    const [room] = resolveRooms(rect(0, 0, 3, 7), [])
    expect(roomSize(room.polygon)).toEqual({ width: 3, length: 7 })
  })
})
