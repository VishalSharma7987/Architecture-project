import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InspectorPanel } from './InspectorPanel'
import { parseDesign } from '../persistence/schema'
import { doorSwing, swingDirection } from '../scene/wallGeometry'
import { resetStore } from '../test/fixtures'
import {
  DEFAULT_SWING,
  useDesignStore,
  type Opening,
  type Swing,
  type Wall,
} from '../store/useDesignStore'

/**
 * B22 — the swing controls, and the end of v4's first field being unreachable.
 *
 * B21 put `Opening.swing` in the model and made four renderers read it, but
 * nothing except `addOpening` and the migration could WRITE it — so every door
 * in every document carried the same swing and no user could change it. This
 * suite is the assertion that the loop is closed.
 *
 * Every test here asserts through `doorSwing`, never through the DOM's own
 * idea of what was clicked. What matters is not that a button is pressed; it
 * is that the WORLD GEOMETRY the three renderers draw from has moved. A test
 * that only checked `aria-pressed` would pass against a control wired to
 * nothing.
 */

/** Runs due east from the origin, so world x is along it and world z across. */
const WALL_ID = 'w1'
const DOOR_ID = 'd1'

function doorWall(swing?: Swing): Wall {
  const opening: Opening = {
    id: DOOR_ID,
    type: 'door',
    position: 2,
    width: 1,
    height: 2.1,
    sill: 0,
    ...(swing ? { swing } : {}),
  }
  return {
    id: WALL_ID,
    start: { x: 0, z: 0 },
    end: { x: 4, z: 0 },
    height: 3,
    thickness: 0.2,
    openings: [opening],
    material: 'white-paint',
    type: 'shell' as const,
  }
}

/** Puts one wall carrying one opening in the store and selects the opening. */
function showOpening(wall: Wall) {
  useDesignStore.setState({
    walls: [wall],
    selection: { kind: 'opening', wallId: WALL_ID, openingId: wall.openings[0].id },
  })
  render(<InspectorPanel />)
}

/** The opening as the store currently holds it — never the render's copy. */
function current(): Opening {
  const found = useDesignStore
    .getState()
    .walls.find((w) => w.id === WALL_ID)
    ?.openings.find((o) => o.id === DOOR_ID)
  if (!found) throw new Error('opening vanished from the store')
  return found
}

const wall = () => useDesignStore.getState().walls[0]

/** Rounds away float noise, and `-0` with it — see `doorSwing.test.ts`. */
const v = (p: { x: number; z: number }) => ({
  x: Math.round(p.x * 1e6) / 1e6 + 0,
  z: Math.round(p.z * 1e6) / 1e6 + 0,
})

/**
 * Closes the current undo burst. Edits within `HISTORY_COALESCE_MS` coalesce
 * into one step, so a test measuring `past.length` would otherwise be
 * measuring the coalescing. Copied from `history.test.ts`.
 */
const settle = () => vi.advanceTimersByTime(250)

beforeEach(() => {
  vi.useFakeTimers()
  resetStore()
})
afterEach(() => {
  vi.useRealTimers()
  resetStore()
})

describe('★ B22 — a user can set a door\'s swing', () => {
  it('shows both controls for a door', () => {
    showOpening(doorWall(DEFAULT_SWING))
    expect(screen.getByTestId('swing-hand-start')).toBeTruthy()
    expect(screen.getByTestId('swing-hand-end')).toBeTruthy()
    expect(screen.getByTestId('swing-side-left')).toBeTruthy()
    expect(screen.getByTestId('swing-side-right')).toBeTruthy()
  })

  /**
   * ★ The one that matters.
   *
   * Demonstrated red (SD5) before the controls existed, with the symptom
   *
   *   TestingLibraryElementError: Unable to find an element by:
   *     [data-testid="swing-hand-end"]
   *
   * — no control rendered, so the query failed before any assertion about
   * geometry could run. That is the finding named exactly: the model could
   * express a swing that no user could set.
   */
  it('★ flipping the hinge moves the world hinge point doorSwing returns', () => {
    showOpening(doorWall(DEFAULT_SWING))

    // position 2, width 1 ⇒ jambs at 1.5 and 2.5 along a wall running east.
    expect(v(doorSwing(wall(), current()).hinge)).toEqual({ x: 1.5, z: 0 })

    fireEvent.click(screen.getByTestId('swing-hand-end'))

    expect(current().swing).toEqual({ hand: 'end', side: 'left' })
    expect(v(doorSwing(wall(), current()).hinge)).toEqual({ x: 2.5, z: 0 })
  })

  it('★ flipping the side reverses the direction the leaf sweeps', () => {
    showOpening(doorWall(DEFAULT_SWING))
    expect(v(swingDirection(doorSwing(wall(), current())))).toEqual({ x: 0, z: -1 })

    fireEvent.click(screen.getByTestId('swing-side-right'))

    expect(current().swing).toEqual({ hand: 'start', side: 'right' })
    expect(v(swingDirection(doorSwing(wall(), current())))).toEqual({ x: 0, z: 1 })
  })

  it('leaves the hinge alone when only the side changes, and vice versa', () => {
    // The two fields are independent in the model, and the controls must not
    // quietly couple them — `side` names a side of the WALL, so rehanging the
    // leaf on the other jamb must not move which way it opens (SD13).
    showOpening(doorWall({ hand: 'end', side: 'right' }))

    fireEvent.click(screen.getByTestId('swing-hand-start'))
    expect(current().swing).toEqual({ hand: 'start', side: 'right' })

    fireEvent.click(screen.getByTestId('swing-side-left'))
    expect(current().swing).toEqual({ hand: 'start', side: 'left' })
  })

  it('records one undo step, and ⌘Z restores the previous swing', () => {
    showOpening(doorWall(DEFAULT_SWING))
    settle()
    const before = useDesignStore.getState().past.length

    fireEvent.click(screen.getByTestId('swing-side-right'))
    settle()

    expect(useDesignStore.getState().past.length).toBe(before + 1)
    expect(current().swing).toEqual({ hand: 'start', side: 'right' })

    useDesignStore.getState().undo()
    expect(current().swing).toEqual(DEFAULT_SWING)
  })

  it('produces a NEW Opening object, which is what makes the undo step real', () => {
    // §4 invariant 1: `designChanged` is a pure reference compare, and §10
    // rule 10 is the hazard on the other side of it. A patch that mutated the
    // opening in place would render correctly and be silently un-undoable.
    showOpening(doorWall(DEFAULT_SWING))
    const firstOpening = current()
    const firstWall = useDesignStore.getState().walls[0]
    const firstArray = useDesignStore.getState().walls

    fireEvent.click(screen.getByTestId('swing-side-right'))

    // The whole chain the recorder compares, one link at a time: the array is
    // what `designChanged` reads, and it is only a new array if `patchWall`
    // found the wall, which is only a new wall if the opening was replaced.
    expect(current()).not.toBe(firstOpening)
    expect(useDesignStore.getState().walls[0]).not.toBe(firstWall)
    expect(useDesignStore.getState().walls).not.toBe(firstArray)
  })

  it('shows the default on a door that carries no swing at all', () => {
    // The migration guarantees every door has one, so an absent swing IS a
    // bug — but the control must still show what will actually be drawn
    // (`doorSwing` falls back to DEFAULT_SWING) rather than an empty state
    // that suggests the door has no swing.
    showOpening(doorWall())

    expect(screen.getByTestId('swing-hand-start').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('swing-side-left').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('swing-hand-end').getAttribute('aria-pressed')).toBe('false')
  })

  it('shows the swing a v3 → v4 migration wrote', () => {
    const parsed = parseDesign({
      version: 3,
      name: 'old',
      savedAt: '2026-05-19T11:40:00.000Z',
      settings: { viewMode: '2d' },
      walls: [
        {
          id: WALL_ID,
          start: { x: 0, z: 0 },
          end: { x: 4, z: 0 },
          height: 3,
          thickness: 0.2,
          material: 'white-paint',
          type: 'shell' as const,
          openings: [
            { id: DOOR_ID, type: 'door', position: 2, width: 1, height: 2.1, sill: 0 },
          ],
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    showOpening(parsed.doc.walls[0])

    // What v3 drew, now stated in the document and read back by the control.
    expect(current().swing).toEqual({ hand: 'start', side: 'left' })
    expect(screen.getByTestId('swing-hand-start').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('swing-side-left').getAttribute('aria-pressed')).toBe('true')
  })

  it('shows no swing controls for a window — a window does not swing', () => {
    showOpening({
      ...doorWall(),
      openings: [
        {
          id: DOOR_ID,
          type: 'window',
          position: 2,
          width: 1.2,
          height: 1.2,
          sill: 0.9,
        },
      ],
    })

    expect(screen.queryByTestId('swing-controls')).toBeNull()
    expect(screen.queryByTestId('swing-hand-start')).toBeNull()
    expect(screen.queryByTestId('swing-side-left')).toBeNull()
  })
})
