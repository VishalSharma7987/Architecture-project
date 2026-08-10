import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InspectorPanel } from '../components/InspectorPanel'
import { resetRoomCaches } from '../plan/rooms'
import { rectangleWalls, resetStore } from '../test/fixtures'
import { useDesignStore, type Point, type RoomLabel } from '../store/useDesignStore'
import { resolveRooms, roomSelectionAt, selectedRoomOf } from './resolve'

/**
 * B7.1 — a selected room is a selected NAME, identified by id.
 *
 * Before this, `Selection{kind:'room'}` carried a `Point`, and that point meant
 * two different things: the schedule panel set a label's own anchor, and a plan
 * click set the raw click point. `RoomInspector` told them apart by comparing
 * both coordinates as floats, which only ever matched the first.
 */

beforeEach(() => {
  resetStore()
  resetRoomCaches()
})
afterEach(() => {
  resetStore()
  resetRoomCaches()
})

/**
 * One enclosure, two names — the open plan. `Kitchen` is appended first, so it
 * is the primary and `Dining` rides along in `extraLabels`.
 */
function openPlan(): { kitchen: RoomLabel; dining: RoomLabel } {
  const kitchen: RoomLabel = {
    id: 'label-kitchen',
    type: 'kitchen',
    anchor: { x: 1, z: 1.5 },
  }
  const dining: RoomLabel = {
    id: 'label-dining',
    type: 'dining',
    anchor: { x: 3, z: 1.5 },
  }
  useDesignStore.setState({
    walls: rectangleWalls(),
    roomLabels: [kitchen, dining],
  })
  return { kitchen, dining }
}

/** Exactly what `FloorPlanEditor`'s click handler does. */
function clickPlanAt(point: Point): void {
  const { walls, roomLabels, select } = useDesignStore.getState()
  select(roomSelectionAt(resolveRooms(walls, roomLabels), point))
}

const labelById = (id: string) =>
  useDesignStore.getState().roomLabels.find((l) => l.id === id)!

describe('★ B7.1 — renaming an open-plan zone edits that zone', () => {
  /**
   * Demonstrated red (SD5). Against the pre-B7.1 code, with the selection made
   * the way `FloorPlanEditor.tsx:599` made it — `{ kind: 'room', anchor: point }`
   * carrying the raw click point — this failed twice over:
   *
   *   AssertionError: expected 'dining' to be 'study'
   *   AssertionError: DIAGNOSIS: did the primary get it?:
   *                   expected 'study' to be 'kitchen'
   *
   * So the selected zone was untouched and the PRIMARY was renamed instead.
   * (3.2, 1.6) is inside the enclosure but equals no label's anchor, so
   * `roomLabels.find(l => l.anchor.x === anchor.x && l.anchor.z === anchor.z)`
   * missed and the `?? room.label` fallback took over. Selecting the same zone
   * from the schedule panel worked, which is why the defect survived a comment
   * claiming it was fixed: that path passed `extra.anchor` by reference, so the
   * floats matched.
   */
  it('a plan click near the Dining zone renames Dining, not Kitchen', () => {
    const { kitchen, dining } = openPlan()
    clickPlanAt({ x: 3.2, z: 1.6 })

    render(<InspectorPanel />)
    fireEvent.click(screen.getByTestId('room-type-study'))

    expect(labelById(dining.id).type).toBe('study')
    expect(labelById(kitchen.id).type, 'the primary must not be touched').toBe(
      'kitchen',
    )
  })

  it('a plan click near the Kitchen zone renames Kitchen', () => {
    const { kitchen, dining } = openPlan()
    clickPlanAt({ x: 0.8, z: 1.4 })

    render(<InspectorPanel />)
    fireEvent.click(screen.getByTestId('room-type-study'))

    expect(labelById(kitchen.id).type).toBe('study')
    expect(labelById(dining.id).type).toBe('dining')
  })

  it('the selection carries the label id, not a point', () => {
    const { dining } = openPlan()
    clickPlanAt({ x: 3.2, z: 1.6 })

    expect(useDesignStore.getState().selection).toEqual({
      kind: 'room',
      roomId: dining.id,
    })
  })

  it('equidistant anchors resolve to the earlier label, deterministically', () => {
    const { kitchen } = openPlan()
    // Dead centre between (1, 1.5) and (3, 1.5).
    clickPlanAt({ x: 2, z: 1.5 })

    expect(useDesignStore.getState().selection).toEqual({
      kind: 'room',
      roomId: kitchen.id,
    })
  })
})

describe('B7.1 — space, the unnamed variant', () => {
  it('clicking an unnamed enclosure selects a space, not a room', () => {
    useDesignStore.setState({ walls: rectangleWalls(), roomLabels: [] })
    clickPlanAt({ x: 2, z: 1.5 })

    expect(useDesignStore.getState().selection).toEqual({
      kind: 'space',
      anchor: { x: 2, z: 1.5 },
    })
  })

  it('clicking outside every enclosure selects nothing', () => {
    useDesignStore.setState({ walls: rectangleWalls(), roomLabels: [] })
    clickPlanAt({ x: 40, z: 40 })

    expect(useDesignStore.getState().selection).toBeNull()
  })

  it('naming a space promotes the selection onto the new label', () => {
    useDesignStore.setState({ walls: rectangleWalls(), roomLabels: [] })
    clickPlanAt({ x: 2, z: 1.5 })

    render(<InspectorPanel />)
    fireEvent.click(screen.getByTestId('room-type-bedroom'))

    const [label] = useDesignStore.getState().roomLabels
    expect(label.type).toBe('bedroom')
    expect(useDesignStore.getState().selection).toEqual({
      kind: 'room',
      roomId: label.id,
    })
  })

  it('★ renaming twice in a row does not mint a second label', () => {
    // Without the promotion above, the inspector would still be pointing at a
    // bare point after the first click, so the second would call `nameRoom`
    // again and leave two labels stacked in one space.
    useDesignStore.setState({ walls: rectangleWalls(), roomLabels: [] })
    clickPlanAt({ x: 2, z: 1.5 })

    const { rerender } = render(<InspectorPanel />)
    fireEvent.click(screen.getByTestId('room-type-bedroom'))
    rerender(<InspectorPanel />)
    fireEvent.click(screen.getByTestId('room-type-study'))

    const labels = useDesignStore.getState().roomLabels
    expect(labels).toHaveLength(1)
    expect(labels[0].type).toBe('study')
  })
})

describe('B7.1 — selectedRoomOf', () => {
  it('finds the enclosure behind a primary id and an extra id alike', () => {
    const { kitchen, dining } = openPlan()
    const { walls, roomLabels } = useDesignStore.getState()
    const rooms = resolveRooms(walls, roomLabels)

    const viaPrimary = selectedRoomOf(rooms, {
      kind: 'room',
      roomId: kitchen.id,
    })
    const viaExtra = selectedRoomOf(rooms, { kind: 'room', roomId: dining.id })

    expect(viaPrimary).not.toBeNull()
    // Both names live in the one enclosure, so both must land on it — that is
    // what makes the plan highlight the same fill for either zone.
    expect(viaExtra).toBe(viaPrimary)
  })

  it('returns null for an id that no longer resolves', () => {
    const { walls, roomLabels } = useDesignStore.getState()
    expect(
      selectedRoomOf(resolveRooms(walls, roomLabels), {
        kind: 'room',
        roomId: 'gone',
      }),
    ).toBeNull()
  })

  it('returns null for the selections that are not spatial', () => {
    const rooms = resolveRooms(rectangleWalls(), [])
    expect(selectedRoomOf(rooms, null)).toBeNull()
    expect(selectedRoomOf(rooms, { kind: 'wall', wallId: 'w' })).toBeNull()
    expect(selectedRoomOf(rooms, { kind: 'floor' })).toBeNull()
  })
})
