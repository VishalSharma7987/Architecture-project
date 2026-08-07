import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDesignStore } from '../store/useDesignStore'
import { resetStore, seedRichDesign } from '../test/fixtures'
import { useDesignAI } from './useDesignAI'

/**
 * Regression suite for the worst defect the audit found: an assistant edit
 * called `loadDesign({name, walls})`, and `loadDesign` defaults every field it
 * is not handed. Furniture, room names, stairs, the plot, the north rotation,
 * the construction rate, the floor finish and both upper storeys were deleted
 * on every edit — and the history epoch bumped, so none of it could be undone.
 *
 * Every assertion here fails against the pre-fix code.
 */

/** A model reply the server would have returned, in the client's expected shape. */
function stubAiResponse(body: {
  name?: string
  notes?: string
  walls?: unknown
  error?: string
  ok?: boolean
}) {
  // Typed with the arguments the hook actually passes, so `mock.calls[0]` is
  // a usable tuple rather than `[]` — otherwise asserting on the request body
  // needs a cast that would also hide a real signature change.
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: body.ok === false ? 500 : 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Two walls the "model" returns — a different plan from the seeded rectangle. */
const RETURNED_WALLS = [
  {
    start: { x: 0, z: 0 },
    end: { x: 6, z: 0 },
    height: 3,
    thickness: 0.3,
    openings: [
      { type: 'door', position: 3, width: 0.9, height: 2.1, sill: 0 },
    ],
  },
  {
    start: { x: 6, z: 0 },
    end: { x: 6, z: 5 },
    height: 3,
    thickness: 0.3,
    openings: [],
  },
]

afterEach(() => {
  vi.unstubAllGlobals()
  resetStore()
})

describe('useDesignAI.edit', () => {
  it('replaces the walls', async () => {
    seedRichDesign()
    stubAiResponse({ name: 'Edited plan', notes: 'Widened it.', walls: RETURNED_WALLS })

    const { result } = renderHook(() => useDesignAI())
    await act(async () => {
      await result.current.edit('make the living room bigger')
    })

    await waitFor(() => expect(result.current.status.kind).toBe('done'))
    const after = useDesignStore.getState()
    expect(after.walls).toHaveLength(2)
    expect(after.walls[0].thickness).toBe(0.3)
    expect(after.walls[0].openings).toHaveLength(1)
  })

  it('preserves every field the model was never shown', async () => {
    const before = seedRichDesign()
    stubAiResponse({ name: 'Edited plan', notes: '', walls: RETURNED_WALLS })

    const { result } = renderHook(() => useDesignAI())
    await act(async () => {
      await result.current.edit('make the living room bigger')
    })
    await waitFor(() => expect(result.current.status.kind).toBe('done'))

    const after = useDesignStore.getState()

    // The four collections that used to be emptied.
    expect(after.furniture).toEqual(before.furniture)
    expect(after.roomLabels).toEqual(before.roomLabels)
    expect(after.stairs).toEqual(before.stairs)

    // The site, which used to be nulled.
    expect(after.plot).toEqual(before.plot)
    expect(after.northOffset).toBe(47)
    expect(after.plotFacing).toBe('N')

    // The settings, which used to be reset to defaults.
    expect(after.constructionRate).toBe(1800)
    expect(after.units).toBe('ftin')
    expect(after.floorMaterial).toBe('oak')
  })

  it('preserves the upper storeys', async () => {
    const before = seedRichDesign()
    stubAiResponse({ name: 'Edited plan', notes: '', walls: RETURNED_WALLS })

    const { result } = renderHook(() => useDesignAI())
    await act(async () => {
      await result.current.edit('widen it')
    })
    await waitFor(() => expect(result.current.status.kind).toBe('done'))

    const after = useDesignStore.getState()
    // The floors array is only reconciled on switch, so the upper two are
    // compared directly; the ground floor is the one being edited.
    expect(after.floors[1].walls).toEqual(before.floors[1].walls)
    expect(after.floors[2].walls).toEqual(before.floors[2].walls)
    expect(after.floors[1].walls).toHaveLength(4)
    expect(after.floors[2].walls).toHaveLength(4)
  })

  it('is undoable', async () => {
    const before = seedRichDesign()
    stubAiResponse({ name: 'Edited plan', notes: '', walls: RETURNED_WALLS })

    const { result } = renderHook(() => useDesignAI())
    await act(async () => {
      await result.current.edit('widen it')
    })
    await waitFor(() => expect(result.current.status.kind).toBe('done'))

    expect(useDesignStore.getState().past.length).toBeGreaterThan(0)

    act(() => useDesignStore.getState().undo())

    const restored = useDesignStore.getState()
    expect(restored.walls).toEqual(before.walls)
    expect(restored.walls).toHaveLength(4)
  })

  it('sends the walls without ids, and nothing else', async () => {
    seedRichDesign()
    const fetchMock = stubAiResponse({ name: 'x', notes: '', walls: RETURNED_WALLS })

    const { result } = renderHook(() => useDesignAI())
    await act(async () => {
      await result.current.edit('widen it')
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ai/edit')
    const sent = JSON.parse(init.body as string)
    expect(Object.keys(sent.design).sort()).toEqual(['name', 'walls'])
    for (const wall of sent.design.walls) {
      expect(wall).not.toHaveProperty('id')
      for (const opening of wall.openings) expect(opening).not.toHaveProperty('id')
    }
  })

  it('leaves the design untouched when the model returns nothing usable', async () => {
    const before = seedRichDesign()
    stubAiResponse({ name: 'x', notes: '', walls: [] })

    const { result } = renderHook(() => useDesignAI())
    await act(async () => {
      await result.current.edit('widen it')
    })

    await waitFor(() => expect(result.current.status.kind).toBe('error'))
    const after = useDesignStore.getState()
    expect(after.walls).toEqual(before.walls)
    expect(after.furniture).toEqual(before.furniture)
  })

  it('leaves the design untouched when the geometry is not finite', async () => {
    const before = seedRichDesign()
    stubAiResponse({
      name: 'x',
      notes: '',
      // 1e999 parses to Infinity — the case `parseDesign` exists to catch.
      // oxlint-disable-next-line no-loss-of-precision
      walls: [{ start: { x: 1e999, z: 0 }, end: { x: 1, z: 1 }, height: 3, thickness: 0.2, openings: [] }],
    })

    const { result } = renderHook(() => useDesignAI())
    await act(async () => {
      await result.current.edit('widen it')
    })

    await waitFor(() => expect(result.current.status.kind).toBe('error'))
    expect(useDesignStore.getState().walls).toEqual(before.walls)
  })
})

describe('useDesignAI.generate', () => {
  it('replaces the walls but keeps the site and settings', async () => {
    const before = seedRichDesign()
    stubAiResponse({ name: 'Generated plan', notes: 'A 2-BHK.', walls: RETURNED_WALLS })

    const { result } = renderHook(() => useDesignAI())
    await act(async () => {
      await result.current.generate('a two bedroom flat')
    })
    await waitFor(() => expect(result.current.status.kind).toBe('done'))

    const after = useDesignStore.getState()
    expect(after.walls).toHaveLength(2)
    // Generating a new plan on the same site does not un-survey the site.
    expect(after.plot).toEqual(before.plot)
    expect(after.northOffset).toBe(47)
    expect(after.constructionRate).toBe(1800)
    expect(after.past.length).toBeGreaterThan(0)
  })
})
