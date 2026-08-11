import { describe, expect, it } from 'vitest'
import {
  openArea,
  resolveRoomsUncached,
  roomAtPoint,
  roomSelectionAt,
  roomSize,
  totalBuiltUpArea,
  withBoundaryHints,
} from './resolve'
import { parseDesign, serializeDesign } from '../persistence/schema'
import { rectangleWalls } from '../test/fixtures'
import type { Point, RoomLabel, Wall } from '../store/useDesignStore'

/**
 * B25 — spaces no walls enclose.
 *
 * Porch, sitout, wash area and balcony are named AND dimensioned in every
 * reference drawing, and before this they could not even be SELECTED:
 * `roomSelectionAt` returned null for a point inside no loop, so the click
 * opened no inspector and there was no "place a room label here" action
 * anywhere in the app.
 *
 * The precedence is what most of this file is about, because it is the part
 * that can go silently wrong: **containment > hint > openBoundary**.
 */

/** A 4 x 3 rectangle to the right of the enclosed 4 x 3 one at the origin. */
const PORCH: Point[] = [
  { x: 6, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 3 },
  { x: 6, z: 3 },
]

const porchLabel = (patch: Partial<RoomLabel> = {}): RoomLabel => ({
  id: 'porch',
  type: 'balcony',
  anchor: { x: 8, z: 1.5 },
  openBoundary: PORCH,
  ...patch,
})

/** A label pinned inside the enclosed rectangle `rectangleWalls()` draws. */
const bedroom = (patch: Partial<RoomLabel> = {}): RoomLabel => ({
  id: 'bedroom',
  type: 'bedroom',
  anchor: { x: 2, z: 1.5 },
  ...patch,
})

describe('★ B25 — a space with no closed loop', () => {
  /**
   * ★ Demonstrated red (SD5) by removing pass 3 from `matchLabels`:
   *
   *   expected undefined to be defined      (no room resolved for the label)
   *
   * and, with `roomSelectionAt`, `expected null to have property 'kind'` —
   * the porch was a detached label, exactly as the audit found it.
   */
  it('★ resolves, reports an area, and can be selected', () => {
    const rooms = resolveRoomsUncached([], [porchLabel()])

    expect(rooms).toHaveLength(1)
    expect(rooms[0].open).toBe(true)
    expect(rooms[0].label?.id).toBe('porch')
    expect(rooms[0].area).toBeCloseTo(12)

    // Selectable — the whole point. Before B25 this was `null`.
    expect(roomSelectionAt(rooms, { x: 8, z: 1.5 })).toEqual({
      kind: 'room',
      roomId: 'porch',
    })
  })

  it('carries the width x length the references print under the name', () => {
    // PORCH 321X420, SITOUT 370X140 — a name alone does not reproduce those.
    const rooms = resolveRoomsUncached([], [porchLabel()])
    expect(roomSize(rooms[0].polygon)).toEqual({ width: 4, length: 3 })
  })

  it('is found by a point inside it and not by one outside', () => {
    const rooms = resolveRoomsUncached([], [porchLabel()])
    expect(roomAtPoint(rooms, { x: 8, z: 1.5 })?.label?.id).toBe('porch')
    expect(roomAtPoint(rooms, { x: 2, z: 1.5 })).toBeNull()
  })

  it('refuses a degenerate outline rather than scheduling a zero-area space', () => {
    const flat: Point[] = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 0, z: 0 },
    ]
    expect(resolveRoomsUncached([], [porchLabel({ openBoundary: flat })])).toEqual([])
    expect(resolveRoomsUncached([], [porchLabel({ openBoundary: [] })])).toEqual([])
  })
})

describe('★ B25 — precedence: containment > hint > openBoundary', () => {
  /**
   * ★ The rule that can go silently wrong.
   *
   * A label carrying BOTH a containing enclosure and an outline must resolve
   * to the ENCLOSURE. The walls are the more specific architectural fact, and
   * B7's whole design is that geometry is recomputed while the name persists —
   * so walling in a porch must turn it into a room, not leave it reading its
   * own stale rectangle.
   *
   * Demonstrated red (SD5) by running pass 3 over `labels` instead of over
   * `stillUnplaced` — i.e. making the outline unconditional rather than a last
   * resort:
   *
   *   expected [ { polygon: [ …(4) ], …(5) } ] to deeply equal []
   *
   * The label resolved to the enclosure AND produced a second, open room from
   * its outline. Exactly two tests failed — this one and the hint case below —
   * which is what says the break was precedence and not resolution.
   */
  it('★ prefers the enclosure over the outline the label also carries', () => {
    // The anchor is inside `rectangleWalls()`, and the outline is elsewhere.
    const label = bedroom({ openBoundary: PORCH })
    const rooms = resolveRoomsUncached(rectangleWalls(), [label])

    const mine = rooms.find((r) => r.label?.id === 'bedroom')
    expect(mine).toBeDefined()
    // Resolved to the WALLS: 4 x 3 enclosure, area 12, and not open.
    expect(mine?.open).toBe(false)
    expect(mine?.area).toBeCloseTo(12)
    // The positive delta that makes this non-vacuous: the outline's own
    // polygon is nowhere in the result, so pass 3 did not also fire.
    expect(rooms.filter((r) => r.open)).toEqual([])
    expect(rooms).toHaveLength(1)
  })

  it('prefers the boundary hint over the outline', () => {
    // Pass 2's input: the anchor has fallen outside every loop, but the hint
    // still matches the enclosure. That must win over pass 3.
    const label = bedroom({
      anchor: { x: 50, z: 50 },
      boundaryHint: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 3 },
        { x: 0, z: 3 },
      ],
      openBoundary: PORCH,
    })
    const rooms = resolveRoomsUncached(rectangleWalls(), [label])

    const mine = rooms.find((r) => r.label?.id === 'bedroom')
    expect(mine?.open).toBe(false)
    expect(rooms.filter((r) => r.open)).toEqual([])
  })

  it('falls to the outline only when neither pass placed the label', () => {
    // Same label, same walls, but the hint no longer resembles anything.
    const label = bedroom({
      anchor: { x: 50, z: 50 },
      openBoundary: PORCH,
    })
    const rooms = resolveRoomsUncached(rectangleWalls(), [label])

    const mine = rooms.find((r) => r.label?.id === 'bedroom')
    expect(mine?.open).toBe(true)
    expect(mine?.area).toBeCloseTo(12)
    // The enclosure is still there, still detected, and now unnamed.
    expect(rooms.filter((r) => !r.open)).toHaveLength(1)
    expect(rooms.find((r) => !r.open)?.label).toBeNull()
  })
})

describe('★ B25 — enclosed rooms are unchanged', () => {
  it('resolves exactly as it did before, with no open label present', () => {
    // Acceptance 6, asserted rather than assumed: the whole result for an
    // ordinary named room, field by field, including the new flag's default.
    const rooms = resolveRoomsUncached(rectangleWalls(), [bedroom()])

    expect(rooms).toHaveLength(1)
    expect(rooms[0].open).toBe(false)
    expect(rooms[0].label?.id).toBe('bedroom')
    expect(rooms[0].extraLabels).toEqual([])
    expect(rooms[0].area).toBeCloseTo(12)
    expect(totalBuiltUpArea(rooms)).toBeCloseTo(12)
    expect(openArea(rooms)).toBe(0)
  })

  it('leaves B7 re-attachment alone when an open space is also present', () => {
    const detachedButHinted = bedroom({
      anchor: { x: 50, z: 50 },
      boundaryHint: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 3 },
        { x: 0, z: 3 },
      ],
    })
    const rooms = resolveRoomsUncached(rectangleWalls(), [
      detachedButHinted,
      porchLabel(),
    ])

    // Pass 2 still re-attached, and pass 3 still made the porch.
    expect(rooms.find((r) => !r.open)?.label?.id).toBe('bedroom')
    expect(rooms.find((r) => r.open)?.label?.id).toBe('porch')
  })

  it('writes no boundaryHint for an open space', () => {
    // Its polygon IS its `openBoundary`, already in the document. A hint would
    // store the same ring twice and make re-attachment try to claim a detected
    // loop for a space that has none.
    const labels = [porchLabel()]
    const hinted = withBoundaryHints([], labels)
    expect(hinted[0].boundaryHint).toBeUndefined()
    // Unchanged array identity, so a save cannot record a phantom undo step.
    expect(hinted).toBe(labels)
  })
})

describe('★ B25 — a porch is not built-up area', () => {
  it('is counted separately, and never in the built-up total', () => {
    // This number is multiplied by `constructionRate` to produce rupees, so
    // counting a porch would silently OVERSTATE a client's cost on every
    // design that has one. Overstating money is the worse error.
    const rooms = resolveRoomsUncached(rectangleWalls(), [
      bedroom(),
      porchLabel(),
    ])

    expect(rooms).toHaveLength(2)
    expect(totalBuiltUpArea(rooms)).toBeCloseTo(12)
    expect(openArea(rooms)).toBeCloseTo(12)
    // The delta that makes it a real assertion rather than a coincidence: both
    // spaces are 12 m², so a total of 12 can only mean one of them was excluded.
    expect(totalBuiltUpArea(rooms)).not.toBeCloseTo(24)
  })
})

describe('★ B25 — openBoundary survives the file', () => {
  it('★ round-trips, present and absent', () => {
    const walls: Wall[] = rectangleWalls()
    const doc = serializeDesign({
      name: 'porch',
      viewMode: '2d',
      savedAt: '2026-08-10T00:00:00.000Z',
      walls,
      roomLabels: [bedroom(), porchLabel()],
    })

    const result = parseDesign(JSON.parse(JSON.stringify(doc)))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const porch = result.doc.rooms.find((r) => r.id === 'porch')
    const room = result.doc.rooms.find((r) => r.id === 'bedroom')
    expect(porch?.openBoundary).toEqual(PORCH)
    expect(room?.openBoundary).toBeUndefined()

    // …and the reloaded document resolves the same way it did in memory.
    const rooms = resolveRoomsUncached(result.doc.walls, result.doc.rooms)
    expect(rooms.filter((r) => r.open).map((r) => r.label?.id)).toEqual(['porch'])
  })

  it('drops a ring with a hole punched in it, all or nothing', () => {
    const result = parseDesign({
      version: 4,
      name: 'x',
      savedAt: '2026-08-10T00:00:00.000Z',
      settings: { viewMode: '2d' },
      walls: [],
      rooms: [
        {
          id: 'porch',
          type: 'balcony',
          anchor: { x: 8, z: 1.5 },
          // One corner is not a point. A ring with a gap describes a shape the
          // user never had, so the whole outline goes rather than a guess.
          openBoundary: [{ x: 6, z: 0 }, { x: 10, z: 0 }, { z: 3 }],
        },
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.rooms[0].openBoundary).toBeUndefined()
    // The NAME survives, which is the point — L2. Only the outline is dropped.
    expect(result.doc.rooms[0].id).toBe('porch')
  })
})
