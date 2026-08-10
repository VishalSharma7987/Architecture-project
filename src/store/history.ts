/**
 * The undo/redo recorder, as a thing you can make rather than a thing there is
 * one of.
 *
 * It used to be three mutable variables at module scope beside a bare
 * `store.subscribe(...)`. That worked — there is one store — but it made the
 * engine a process-wide singleton: it could not be created twice, disposed, or
 * exercised without reaching through the real store. The tell was that tests
 * had to reset module state to run in any order.
 *
 * The cost of leaving it there was never the tidiness. It was that the design
 * forecloses anything with two documents in it — a compare view, a preview
 * pane, a second design open beside the first — and each of those will be
 * quoted as a small feature by whoever has not read this file. Nothing about
 * recording an edit is inherently global; it just happened to be written that
 * way. Now the state lives in a closure, one per engine.
 *
 * No behaviour changed in the move: same coalescing window, same limit, same
 * epoch handling, same guard against recording undo's own writes.
 */

/** The parts of a zustand store this needs. Kept minimal so a fake is easy. */
export type HistoryStore<T> = {
  getState: () => T
  setState: (partial: Partial<T>) => void
  subscribe: (listener: (state: T) => void) => () => void
}

export type HistoryConfig<S extends object, T extends S & HistoryFields<S>> = {
  store: HistoryStore<T>
  /** The slice of state that IS the document, as opposed to the view of it. */
  snapshotOf: (state: T) => S
  /** Whether two snapshots differ in a way worth remembering. */
  changed: (a: S, b: S) => boolean
  /**
   * Bumped when a DIFFERENT document is opened — a project load, an import, an
   * autosave restore, a share link, a new design.
   *
   * Deliberately not the same counter as the one views watch to refit the
   * camera: an edit that merely needs reframing — an assistant edit, a floor
   * switch — must stay undoable. Watching the camera's counter here is what
   * used to make an AI result permanent.
   */
  epochOf: (state: T) => number
  limit?: number
  coalesceMs?: number
}

/** What the store holds on the engine's behalf. */
export type HistoryFields<S> = { past: S[]; future: S[] }

export type History = {
  undo: () => void
  redo: () => void
  /** Stops recording. The store keeps whatever `past`/`future` it had. */
  dispose: () => void
}

/** Cap on remembered steps, so a long session cannot grow history unbounded. */
export const HISTORY_LIMIT = 100

/**
 * How long edits keep coalescing into one undo step. A drag fires many updates
 * a frame apart, and they should undo as a single move; deliberate clicks are
 * further apart than this, so they stay separate steps.
 */
export const HISTORY_COALESCE_MS = 200

export function createHistory<S extends object, T extends S & HistoryFields<S>>(
  config: HistoryConfig<S, T>,
): History {
  const {
    store,
    snapshotOf,
    changed,
    epochOf,
    limit = HISTORY_LIMIT,
    coalesceMs = HISTORY_COALESCE_MS,
  } = config

  // `applying` gates the recorder while undo/redo write; `committed` is the
  // baseline the next edit is measured against; `burst` holds a drag open.
  // Closure state, one set per engine — this is the whole point of the factory.
  let applying = false
  let committed: S | null = snapshotOf(store.getState())
  let burst: ReturnType<typeof setTimeout> | null = null
  let lastEpoch = epochOf(store.getState())

  const endBurst = () => {
    if (burst === null) return
    clearTimeout(burst)
    burst = null
  }

  /** Writes without being recorded — used by undo, redo and the epoch reset. */
  const applyQuietly = (partial: Partial<T>) => {
    applying = true
    store.setState(partial)
    applying = false
  }

  const step = (from: 'past' | 'future') => {
    const state = store.getState()
    const stack = state[from]
    if (stack.length === 0) return

    const target = stack[stack.length - 1]
    const current = snapshotOf(state)
    const other = from === 'past' ? 'future' : 'past'

    applyQuietly({
      ...target,
      [from]: stack.slice(0, -1),
      [other]: [...state[other], current],
    } as unknown as Partial<T>)

    committed = target
    endBurst()
  }

  const unsubscribe = store.subscribe((state) => {
    const snap = snapshotOf(state)

    // A different document: adopt it as the new baseline and clear history,
    // rather than leaving an "undo" that would wipe what was just opened.
    if (epochOf(state) !== lastEpoch) {
      lastEpoch = epochOf(state)
      committed = snap
      endBurst()
      applyQuietly({ past: [], future: [] } as unknown as Partial<T>)
      return
    }

    // undo/redo are writing: keep the baseline in step, but record nothing.
    if (applying) {
      committed = snap
      return
    }

    // A view-only change (panel, tool, selection, camera) touches no design
    // field, so there is nothing to record.
    if (committed && !changed(committed, snap)) return

    // First edit of a burst: push the pre-edit state so it can be returned to,
    // and drop the redo branch the new edit diverges from. Later edits in the
    // same burst only extend it; the timer below keeps the burst open.
    if (!burst && committed) {
      const { past } = store.getState()
      const trimmed = past.length >= limit ? past.slice(past.length - limit + 1) : past
      applyQuietly({ past: [...trimmed, committed], future: [] } as unknown as Partial<T>)
    }

    committed = snap
    if (burst) clearTimeout(burst)
    burst = setTimeout(() => {
      burst = null
    }, coalesceMs)
  })

  return {
    undo: () => step('past'),
    redo: () => step('future'),
    dispose: () => {
      endBurst()
      unsubscribe()
    },
  }
}
