import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesignStore, type Blueprint } from './useDesignStore'
import { createHistory, type HistoryStore } from './history'
import { uncalibrated } from '../blueprint/calibration'
import { rectangleWalls, resetStore } from '../test/fixtures'
import { provenance } from './provenance'

/**
 * The undo engine, and the blueprint's place in it.
 *
 * `blueprint` is part of `DesignSnapshot` because a calibration must be
 * undoable — losing one used to be unrecoverable. But a blueprint also carries
 * an object URL, which has a lifetime the snapshot does not respect, and that
 * is what this suite pins down.
 */

const AT = '2026-08-10T00:00:00.000Z'

function blueprintNamed(fileName: string, src: string): Blueprint {
  return {
    src,
    fileName,
    width: 1000,
    height: 800,
    metresPerPixel: 0.01,
    origin: { x: -5, z: -4 },
    opacity: 0.5,
    visible: true,
    calibration: uncalibrated(0.01, AT),
  }
}

/** Every object URL `setBlueprint` has revoked this test. */
let revoked: string[]

/**
 * Closes the current undo burst.
 *
 * Edits within `HISTORY_COALESCE_MS` of each other coalesce into one step, so
 * that a drag undoes as a single move. Two edits meant to be two steps have to
 * be separated by more than that — otherwise a test measuring `past.length`
 * measures the coalescing rather than the thing it is asking about.
 */
function settle() {
  vi.advanceTimersByTime(250)
}

beforeEach(() => {
  vi.useFakeTimers()
  resetStore()
  revoked = []
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  resetStore()
})

/**
 * ★ F3 — undo used to hand back a blueprint whose pixels had been freed.
 *
 * `setBlueprint` revokes the outgoing object URL, and `blueprint` is in the
 * undo snapshot, so undoing a replacement restored a `Blueprint` whose `src`
 * pointed at a `blob:` URL that had already been revoked. The image silently
 * failed to load — and the panel's own "remembers the file but not the image"
 * message never fired, because it tests `!blueprint.src` and a revoked URL is
 * still a non-null string. The user got a blank underlay and no explanation.
 */
describe('★ a blueprint restored by undo never carries a dead object URL', () => {
  it('does not hand back a revoked URL', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    useDesignStore.getState().setBlueprint(blueprintNamed('second.png', 'blob:test/second'))
    settle()

    expect(revoked, 'the first image was freed on replacement').toContain(
      'blob:test/first',
    )

    useDesignStore.getState().undo()

    const src = useDesignStore.getState().blueprint?.src ?? null
    expect(src === null || !revoked.includes(src)).toBe(true)
  })

  it('reports no image, which is the state the panel already explains', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    useDesignStore.getState().setBlueprint(blueprintNamed('second.png', 'blob:test/second'))
    settle()
    useDesignStore.getState().undo()

    const blueprint = useDesignStore.getState().blueprint
    expect(blueprint?.fileName, 'the placement is still remembered').toBe('first.png')
    expect(blueprint?.src, 'but the pixels are gone, and it says so').toBeNull()
  })

  it('keeps the scale the restored placement was measured at', () => {
    const first = blueprintNamed('first.png', 'blob:test/first')
    useDesignStore.getState().setBlueprint({ ...first, metresPerPixel: 0.019 })
    settle()
    useDesignStore.getState().setBlueprint(blueprintNamed('second.png', 'blob:test/second'))
    settle()
    useDesignStore.getState().undo()

    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.019)
  })

  it('does not revoke the URL of the blueprint still on screen', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('only.png', 'blob:test/only'))
    expect(revoked).not.toContain('blob:test/only')
  })
})

/**
 * The fix nulls `src` inside the snapshot, so `blueprintChanged` can no longer
 * tell two different images apart by their URLs. These pin the behaviour that
 * would otherwise be lost silently — a replacement that stopped being an undo
 * step would be a data-safety regression wearing a performance disguise.
 */
describe('replacing a blueprint is still one undo step', () => {
  it('records the replacement', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    const before = useDesignStore.getState().past.length

    useDesignStore.getState().setBlueprint(blueprintNamed('second.png', 'blob:test/second'))
    settle()

    expect(useDesignStore.getState().past.length).toBeGreaterThan(before)
  })

  it('records a replacement by an image of a different size', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('plan.png', 'blob:test/a'))
    settle()
    const before = useDesignStore.getState().past.length

    useDesignStore.getState().setBlueprint({
      ...blueprintNamed('plan.png', 'blob:test/b'),
      width: 2000,
      height: 1600,
    })
    settle()

    expect(useDesignStore.getState().past.length).toBeGreaterThan(before)
  })

  it('records removing the blueprint entirely', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    const before = useDesignStore.getState().past.length

    useDesignStore.getState().setBlueprint(null)
    settle()

    expect(useDesignStore.getState().past.length).toBeGreaterThan(before)
  })

  it('still does not record an opacity change', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    const before = useDesignStore.getState().past.length

    useDesignStore.getState().updateBlueprint({ opacity: 0.9 })
    settle()
    useDesignStore.getState().updateBlueprint({ opacity: 0.2 })
    settle()

    // Opacity is how you are looking at the drawing, not part of the design.
    expect(useDesignStore.getState().past.length).toBe(before)
  })
})

/**
 * ★ M3 — the engine is a thing you make, not a thing there is one of.
 *
 * It used to be three mutable variables at module scope beside a bare
 * `store.subscribe(...)`, which meant it could not be created twice, disposed,
 * or exercised without reaching through the real store. That is not a tidiness
 * complaint: it forecloses every feature with two documents in it, and each of
 * those will be quoted as small by whoever has not read the module. These
 * cases are the proof that the constraint is gone — none of them can be
 * written against a singleton.
 */
describe('★ createHistory is instantiable, isolated and disposable', () => {
  type Snapshot = { value: number }
  type State = Snapshot & { past: Snapshot[]; future: Snapshot[]; epoch: number }

  /** The smallest store the engine will accept. */
  function fakeStore(): HistoryStore<State> & { set: (value: number) => void } {
    let state: State = { value: 0, past: [], future: [], epoch: 0 }
    const listeners = new Set<(s: State) => void>()

    return {
      getState: () => state,
      setState: (partial) => {
        state = { ...state, ...partial }
        for (const listener of listeners) listener(state)
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      set: (value) => {
        state = { ...state, value }
        for (const listener of listeners) listener(state)
      },
    }
  }

  const engineFor = (store: HistoryStore<State>) =>
    createHistory<Snapshot, State>({
      store,
      snapshotOf: (s) => ({ value: s.value }),
      changed: (a, b) => a.value !== b.value,
      epochOf: (s) => s.epoch,
    })

  it('records and steps back on its own store', () => {
    const store = fakeStore()
    const history = engineFor(store)

    store.set(1)
    settle()
    history.undo()

    expect(store.getState().value).toBe(0)
  })

  it('★ two engines do not share a scrap of state', () => {
    const a = fakeStore()
    const b = fakeStore()
    const historyA = engineFor(a)
    engineFor(b)

    a.set(1)
    b.set(99)
    settle()

    historyA.undo()

    expect(a.getState().value, 'the one that was undone').toBe(0)
    expect(b.getState().value, 'the one that was not').toBe(99)
    expect(b.getState().past, 'and it kept its own history').toHaveLength(1)
  })

  it('stops recording once disposed', () => {
    const store = fakeStore()
    const history = engineFor(store)
    history.dispose()

    store.set(1)
    settle()

    expect(store.getState().past).toHaveLength(0)
  })

  it('coalesces a burst into one step', () => {
    const store = fakeStore()
    const history = engineFor(store)

    // A drag: many updates a frame apart, one undo step.
    store.set(1)
    store.set(2)
    store.set(3)
    settle()

    history.undo()
    expect(store.getState().value).toBe(0)
  })

  it('honours the coalescing window between deliberate edits', () => {
    const store = fakeStore()
    const history = engineFor(store)

    store.set(1)
    settle()
    store.set(2)
    settle()

    history.undo()
    expect(store.getState().value, 'two clicks are two steps').toBe(1)
  })

  it('clears history when the document epoch moves', () => {
    const store = fakeStore()
    engineFor(store)

    store.set(1)
    settle()
    expect(store.getState().past).toHaveLength(1)

    // A different document was opened; the old steps belong to the old one.
    store.setState({ epoch: 1, value: 50 })
    expect(store.getState().past).toHaveLength(0)
  })

  it('caps how much it remembers', () => {
    const store = fakeStore()
    createHistory<Snapshot, State>({
      store,
      snapshotOf: (s) => ({ value: s.value }),
      changed: (a, b) => a.value !== b.value,
      epochOf: (s) => s.epoch,
      limit: 3,
    })

    for (let i = 1; i <= 10; i++) {
      store.set(i)
      settle()
    }

    expect(store.getState().past.length).toBeLessThanOrEqual(3)
  })
})

describe('undo covers the rest of the design as before', () => {
  it('steps back a wall edit', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    settle()
    const before = useDesignStore.getState().walls

    useDesignStore.getState().addWall({ x: 0, z: 0 }, { x: 1, z: 0 }, { provenance: provenance.manual() })
    settle()

    useDesignStore.getState().undo()
    expect(useDesignStore.getState().walls).toBe(before)
  })

  it('redoes what it undid', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    settle()
    useDesignStore.getState().addWall({ x: 0, z: 0 }, { x: 1, z: 0 }, { provenance: provenance.manual() })
    settle()
    const after = useDesignStore.getState().walls

    useDesignStore.getState().undo()
    useDesignStore.getState().redo()
    expect(useDesignStore.getState().walls).toBe(after)
  })
})
