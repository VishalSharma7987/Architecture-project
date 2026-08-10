import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { allFloors, useDesignStore } from '../store/useDesignStore'
import { serializeDesign } from '../persistence/schema'
import { downloadDesign } from '../persistence/files'
import { bootCompleted, clearAutosave } from '../persistence/storage'

/**
 * The last thing between a render error and a blank page.
 *
 * There was no app-level boundary at all — the only one in the codebase guards
 * the walkthrough figure — so a throw inside any panel unmounted the entire
 * tree to a white screen. That is bad on its own; combined with autosave it was
 * worse. The document that caused the throw had already been persisted, and the
 * restore path reopens it on the next load, so the crash repeated on every
 * reload and there was no way back into the app to rescue anything.
 *
 * The boot guard in `persistence/storage.ts` breaks that loop. This screen
 * covers the other half of the problem: the work that was open is still in
 * memory at the moment of the crash, and this is the last chance to get it out
 * of the tab. Export comes first for that reason — a user who exports has lost
 * nothing, whatever else is wrong.
 */
type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // There is no error reporting in this product, so the console is the only
    // record. Logged rather than swallowed: without it a support conversation
    // has nothing to work from at all.
    console.error('Space Designer crashed during render', error, info.componentStack)
  }

  /**
   * Writes the open design to a file.
   *
   * Wrapped, because the store is by definition in a state that just broke
   * something — serialising it may fail too, and a recovery screen whose
   * recovery button throws is worse than one that admits it cannot help.
   */
  private handleExport = () => {
    try {
      const state = useDesignStore.getState()
      const floors = allFloors(state)
      downloadDesign(
        serializeDesign({
          name: state.projectName ?? 'recovered-design',
          walls: state.walls,
          furniture: state.furniture,
          roomLabels: state.roomLabels,
          stairs: floors[0]?.stairs,
          floors,
          plot: state.plot,
          blueprint: state.blueprint,
          floorMaterial: state.floorMaterial,
          viewMode: state.viewMode,
          units: state.units,
          constructionRate: state.constructionRate,
          northOffset: state.northOffset,
          plotFacing: state.plotFacing,
        }),
      )
    } catch {
      this.setState({
        error: new Error(
          'The open design could not be exported — it is too damaged to write out.',
        ),
      })
    }
  }

  /**
   * Throws the draft away and starts clean.
   *
   * The boot flag is lowered alongside it: with no draft to reopen there is
   * nothing left for the guard to hold back, and leaving it raised would make
   * the next boot decline a draft that no longer exists.
   */
  private handleDiscard = () => {
    clearAutosave()
    bootCompleted()
    reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        data-testid="crash-recovery"
        className="flex h-screen w-screen items-center justify-center bg-slate-50 p-6"
      >
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
          <h1 className="text-base font-semibold text-slate-900">
            Space Designer stopped unexpectedly
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Your work is still in this tab. Export it before anything else —
            that file opens again from the Projects menu.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleExport}
              data-testid="crash-export"
              className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Export the design (.json)
            </button>
            <button
              type="button"
              onClick={reload}
              data-testid="crash-reload"
              className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.handleDiscard}
              data-testid="crash-discard"
              className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              Discard the draft and start fresh
            </button>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            Reloading reopens the saved draft. If it stops again in the same
            place, that draft is the cause — export it, then discard it.
          </p>

          <pre
            data-testid="crash-detail"
            className="mt-4 max-h-32 overflow-auto rounded-md bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-500"
          >
            {error.message}
          </pre>
        </div>
      </div>
    )
  }
}

/** Indirected so the buttons above stay testable without navigating jsdom. */
function reload() {
  window.location.reload()
}
