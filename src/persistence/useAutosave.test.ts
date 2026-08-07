import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesignStore } from '../store/useDesignStore'
import { rectangleWalls, resetStore } from '../test/fixtures'
import { AUTOSAVE_KEY, PROJECTS_KEY, readAutosave } from './storage'
import { AUTOSAVE_INTERVAL_MS, __resetRestoredGuard, useAutosave } from './useAutosave'

/**
 * Autosave regression suite.
 *
 * The defect: the dirty check was `walls === savedWallsRef.current`. A session
 * spent naming rooms, arranging furniture, setting the plot and its setbacks,
 * rotating north, entering a construction rate or changing the floor finish
 * touched no wall and was therefore never written anywhere — while the README
 * promised that closing the tab does not lose work.
 *
 * Secondary: a quota-exceeded write returned without updating the dirty marker
 * and retried in silence every four seconds, so a broken autosave looked
 * exactly like a working one.
 */

/** Runs one autosave tick. */
function tick() {
  vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS + 1)
}

/** Mounts the hook with the restore guard cleared. */
function mountAutosave() {
  __resetRestoredGuard()
  return renderHook(() => useAutosave({ enabled: true }))
}

beforeEach(() => {
  localStorage.clear()
  resetStore()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
  resetStore()
})

describe('the dirty check covers everything that is persisted', () => {
  /**
   * Every non-wall mutation that used to be invisible to autosave. Each is
   * applied to a design whose walls never change, so the only thing that can
   * trigger a save is the field under test.
   */
  const NON_WALL_EDITS: [name: string, apply: () => void][] = [
    ['naming a room', () => useDesignStore.getState().nameRoom({ x: 2, z: 1.5 }, 'living')],
    ['placing furniture', () => useDesignStore.getState().addFurniture('sofa', { x: 2, z: 1 })],
    ['adding a stair', () => useDesignStore.getState().addStair({ x: 1, z: 1 })],
    [
      'setting the plot',
      () =>
        useDesignStore.getState().setPlot({
          width: 9,
          depth: 12,
          origin: { x: 0, z: 0 },
          setbacks: { front: 1.5, rear: 1.5, left: 1, right: 1 },
        }),
    ],
    ['rotating north', () => useDesignStore.getState().setNorthOffset(47)],
    ['changing the plot facing', () => useDesignStore.getState().setPlotFacing('E')],
    ['entering a construction rate', () => useDesignStore.getState().setConstructionRate(1800)],
    ['changing the floor finish', () => useDesignStore.getState().setFloorMaterial('tile')],
    ['switching units', () => useDesignStore.getState().setUnits('m')],
  ]

  for (const [what, apply] of NON_WALL_EDITS) {
    it(`★ saves after ${what}`, () => {
      useDesignStore.setState({ walls: rectangleWalls() })
      mountAutosave()

      // Flush the save caused by the walls themselves, so the next tick can
      // only be triggered by the edit under test.
      tick()
      const baseline = readAutosave()
      expect(baseline).not.toBeNull()

      apply()
      tick()

      const after = readAutosave()
      expect(after).not.toBeNull()
      expect(after!.doc.savedAt).not.toBe(baseline!.doc.savedAt)
    })
  }

  it('does not save when nothing has changed', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    mountAutosave()
    tick()
    const first = readAutosave()!.doc.savedAt

    tick()
    tick()

    expect(readAutosave()!.doc.savedAt).toBe(first)
  })

  it('does not save a purely view-level change', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    mountAutosave()
    tick()
    const first = readAutosave()!.doc.savedAt

    // Panels, tools and selection are not part of the document.
    useDesignStore.getState().setTool('door')
    useDesignStore.getState().setAiPanelOpen(true)
    useDesignStore.getState().select({ kind: 'floor' })
    tick()

    expect(readAutosave()!.doc.savedAt).toBe(first)
  })

  it('persists the room name it saved, not just a timestamp', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    mountAutosave()
    tick()

    useDesignStore.getState().nameRoom({ x: 2, z: 1.5 }, 'kitchen')
    tick()

    expect(readAutosave()!.doc.rooms[0]?.type).toBe('kitchen')
  })
})

describe('a failed write is reported', () => {
  it('★ surfaces a full quota instead of retrying in silence', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    mountAutosave()

    const quota = new DOMException('full', 'QuotaExceededError')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quota
    })

    tick()

    const autosave = useDesignStore.getState().autosave
    expect(autosave.kind).toBe('failed')
    expect(autosave.kind === 'failed' && autosave.message).toContain('full')
  })

  it('does not mark the design clean after a failure', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    mountAutosave()

    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })

    tick()
    const attemptsAfterFirst = setItem.mock.calls.length
    tick()

    // Still trying, because the work is still unsaved — the point is that the
    // user is now told, not that it gives up.
    expect(setItem.mock.calls.length).toBeGreaterThan(attemptsAfterFirst)
    expect(useDesignStore.getState().autosave.kind).toBe('failed')
  })

  it('clears back to saved once storage recovers', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    mountAutosave()

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    tick()
    expect(useDesignStore.getState().autosave.kind).toBe('failed')

    spy.mockRestore()
    tick()
    expect(useDesignStore.getState().autosave.kind).toBe('saved')
  })
})

describe('cross-tab conflict', () => {
  it('★ notices another tab writing the same slot', () => {
    mountAutosave()
    expect(useDesignStore.getState().autosave.kind).toBe('idle')

    // `storage` fires only in OTHER tabs, so this is what this tab would see.
    window.dispatchEvent(new StorageEvent('storage', { key: AUTOSAVE_KEY }))

    expect(useDesignStore.getState().autosave.kind).toBe('conflict')
  })

  it('notices another tab writing the project library', () => {
    mountAutosave()
    window.dispatchEvent(new StorageEvent('storage', { key: PROJECTS_KEY }))
    expect(useDesignStore.getState().autosave.kind).toBe('conflict')
  })

  it('ignores unrelated keys', () => {
    mountAutosave()
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme' }))
    expect(useDesignStore.getState().autosave.kind).toBe('idle')
  })
})

describe('read-only designs are never autosaved', () => {
  it('a shared design does not overwrite the viewer’s own draft', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    __resetRestoredGuard()
    renderHook(() => useAutosave({ enabled: false }))

    tick()

    expect(readAutosave()).toBeNull()
  })
})
