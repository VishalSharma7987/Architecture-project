import { useDesignStore } from '../store/useDesignStore'
import { clearShareFragment } from '../persistence/shareLink'

/**
 * Header for a design opened from a share link.
 *
 * Replaces the editing toolbar entirely — a read-only viewer that still showed
 * Save, AI, and the drawing tools would be lying about what it can do.
 */
export function SharedBanner({ error }: { error: string | null }) {
  const projectName = useDesignStore((s) => s.projectName)
  const viewMode = useDesignStore((s) => s.viewMode)
  const setViewMode = useDesignStore((s) => s.setViewMode)
  const walkMode = useDesignStore((s) => s.walkMode)
  const setWalkMode = useDesignStore((s) => s.setWalkMode)
  const setPresentMode = useDesignStore((s) => s.setPresentMode)
  const wallCount = useDesignStore((s) => s.walls.length)

  /** Drops the read-only flag and the fragment, turning this into your design. */
  const editCopy = () => {
    clearShareFragment()
    useDesignStore.setState({ readOnly: false, projectName: null })
  }

  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4"
      data-testid="shared-banner"
    >
      <div className="flex items-center gap-2.5">
        <div className="h-6 w-6 rounded-md bg-slate-900" aria-hidden />
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">
          {projectName ?? 'Shared design'}
        </span>
        <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Read only
        </span>
        {error && (
          <span className="text-xs text-red-600" data-testid="shared-error">
            {error}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs tabular-nums text-slate-500" data-testid="wall-count">
          {wallCount} {wallCount === 1 ? 'wall' : 'walls'}
        </span>

        {viewMode === '3d' && (
          <button
            type="button"
            onClick={() => setWalkMode(!walkMode)}
            data-testid="walk-toggle"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              walkMode
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {walkMode ? 'Exit walk' : 'Walk'}
          </button>
        )}

        <div
          className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5"
          role="group"
          aria-label="View mode"
        >
          {(['2d', '3d'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={`rounded-[6px] px-3 py-1 text-xs font-semibold transition-colors ${
                viewMode === mode
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setPresentMode(true)}
          data-testid="present-button"
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          Present
        </button>

        <button
          type="button"
          onClick={editCopy}
          data-testid="edit-copy"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Edit a copy
        </button>
      </div>
    </header>
  )
}
