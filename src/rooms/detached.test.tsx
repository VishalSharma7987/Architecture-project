import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InspectorPanel } from '../components/InspectorPanel'
import { RoomSchedulePanel } from '../components/RoomSchedulePanel'
import { resetRoomCaches } from '../plan/rooms'
import { rectangleWalls, resetStore } from '../test/fixtures'
import { useDesignStore, type RoomLabel, type Wall } from '../store/useDesignStore'
import { detachedLabels, resolveRooms } from './resolve'
import { provenance } from '../store/provenance'

/**
 * B7.2 — a name whose room disappeared is KEPT.
 *
 * It used to vanish from every panel while staying in the document: invisible,
 * un-editable and undeletable, recoverable only by closing the walls again and
 * hoping. Deleting it instead would be worse — the user typed it, so dropping
 * it because the geometry moved violates L2, with no confirmation and no undo
 * step to find it in (L4).
 */

beforeEach(() => {
  resetStore()
  resetRoomCaches()
})
afterEach(() => {
  resetStore()
  resetRoomCaches()
})

const KITCHEN: RoomLabel = {
  id: 'label-kitchen',
  type: 'kitchen',
  anchor: { x: 2, z: 1.5 },
}

function namedRoom(): Wall[] {
  const walls = rectangleWalls()
  useDesignStore.setState({ walls, roomLabels: [KITCHEN] })
  useDesignStore.getState().setRoomPanelOpen(true)
  return walls
}

/** Takes one wall out, so nothing encloses the anchor any more. */
function openTheLoop(walls: Wall[]) {
  useDesignStore.getState().removeWall(walls[0].id)
}

const labels = () => useDesignStore.getState().roomLabels
const currentRooms = () => {
  const { walls, roomLabels } = useDesignStore.getState()
  return resolveRooms(walls, roomLabels)
}

describe('★ B7.2 — the name survives its room', () => {
  /**
   * Demonstrated red (SD5). Before B7.2 both halves failed as
   * `TestingLibraryElementError: Unable to find an element by:` —
   * `[data-testid="detached-labels"]` for the listing, which did not exist,
   * and `[data-testid="room-type-study"]` for the editor, because the
   * inspector rendered a bare paragraph with no controls in it at all.
   */
  it('stays in the document when the loop opens', () => {
    const walls = namedRoom()
    openTheLoop(walls)

    expect(currentRooms()).toHaveLength(0)
    expect(labels(), 'the name is not deleted by a geometry edit').toHaveLength(1)
    expect(labels()[0].id).toBe(KITCHEN.id)
  })

  it('is listed under its own heading in the schedule', () => {
    const walls = namedRoom()
    openTheLoop(walls)

    render(<RoomSchedulePanel />)
    const section = screen.getByTestId('detached-labels')
    expect(within(section).getByText('Kitchen')).toBeTruthy()
    expect(section.textContent).toContain('Not in an enclosed space (1)')
  })

  it('is still editable in the inspector, and names itself', () => {
    const walls = namedRoom()
    useDesignStore.getState().select({ kind: 'room', roomId: KITCHEN.id })
    openTheLoop(walls)

    render(<InspectorPanel />)
    expect(screen.getByTestId('room-detached').textContent).toContain(
      'Kitchen is not inside an enclosed space right now',
    )

    fireEvent.click(screen.getByTestId('room-type-study'))
    expect(labels()[0].type).toBe('study')

    fireEvent.change(screen.getByTestId('room-custom-name'), {
      target: { value: "Kids' Room" },
    })
    expect(labels()[0].name).toBe("Kids' Room")
  })

  it('can still be deleted deliberately', () => {
    const walls = namedRoom()
    useDesignStore.getState().select({ kind: 'room', roomId: KITCHEN.id })
    openTheLoop(walls)

    render(<InspectorPanel />)
    fireEvent.click(screen.getByTestId('room-clear-name'))

    expect(labels()).toHaveLength(0)
  })

  it('★ re-attaches, with its area, when the walls close again', () => {
    const walls = namedRoom()
    openTheLoop(walls)
    expect(detachedLabels(currentRooms(), labels())).toHaveLength(1)

    // Put the missing wall back. Nothing re-attaches it explicitly — pass-1
    // containment simply finds the anchor inside a loop again.
    useDesignStore.getState().addWall(walls[0].start, walls[0].end, { provenance: provenance.manual() })

    const rooms = currentRooms()
    expect(detachedLabels(rooms, labels())).toHaveLength(0)
    expect(rooms).toHaveLength(1)
    expect(rooms[0].label?.id).toBe(KITCHEN.id)
    expect(rooms[0].area).toBeCloseTo(12, 6)
  })

  it('the schedule drops the detached section once nothing is detached', () => {
    namedRoom()
    render(<RoomSchedulePanel />)
    expect(screen.queryByTestId('detached-labels')).toBeNull()
  })
})

describe('B7.2 — detachedLabels', () => {
  it('counts a name as attached whether it is primary or an open-plan extra', () => {
    const kitchen: RoomLabel = { id: 'k', type: 'kitchen', anchor: { x: 1, z: 1.5 } }
    const dining: RoomLabel = { id: 'd', type: 'dining', anchor: { x: 3, z: 1.5 } }
    const orphan: RoomLabel = { id: 'o', type: 'study', anchor: { x: 40, z: 40 } }
    useDesignStore.setState({
      walls: rectangleWalls(),
      roomLabels: [kitchen, dining, orphan],
    })

    const detached = detachedLabels(currentRooms(), labels())
    expect(detached.map((l) => l.id)).toEqual(['o'])
  })

  it('returns them in document order, so the list does not reshuffle', () => {
    const far = (id: string, x: number): RoomLabel => ({
      id,
      type: 'store',
      anchor: { x, z: 40 },
    })
    useDesignStore.setState({
      walls: rectangleWalls(),
      roomLabels: [far('a', 40), far('b', 50), far('c', 60)],
    })

    expect(detachedLabels(currentRooms(), labels()).map((l) => l.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})
