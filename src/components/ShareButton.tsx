import { useEffect, useRef, useState } from 'react'
import { allFloors, useDesignStore } from '../store/useDesignStore'
import { serializeDesign } from '../persistence/schema'
import { createShareLink } from '../persistence/shareLink'

type State =
  | { kind: 'idle' }
  | { kind: 'ready'; url: string; copied: boolean }
  | { kind: 'error'; message: string }

/**
 * Produces a read-only link containing the whole design.
 *
 * There is no server, so the design travels in the URL fragment — which also
 * means it is never transmitted to us. Long links are a real constraint, so the
 * payload is compressed (see persistence/shareLink.ts).
 */
export function ShareButton() {
  const walls = useDesignStore((s) => s.walls)
  const furniture = useDesignStore((s) => s.furniture)
  const floorMaterial = useDesignStore((s) => s.floorMaterial)
  const units = useDesignStore((s) => s.units)
  const roomLabels = useDesignStore((s) => s.roomLabels)
  const northOffset = useDesignStore((s) => s.northOffset)
  const plot = useDesignStore((s) => s.plot)
  const constructionRate = useDesignStore((s) => s.constructionRate)
  const plotFacing = useDesignStore((s) => s.plotFacing)
  const projectName = useDesignStore((s) => s.projectName)

  const [state, setState] = useState<State>({ kind: 'idle' })
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state.kind === 'idle') return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setState({ kind: 'idle' })
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [state.kind])

  const share = async () => {
    if (walls.length === 0) {
      setState({ kind: 'error', message: 'Draw or generate something first.' })
      return
    }

    // Snapshotted here, not subscribed: `allFloors` allocates, and a selector
    // that returns a new array every call loops zustand's snapshot check.
    const floors = allFloors(useDesignStore.getState())
    try {
      const url = await createShareLink(
        serializeDesign({
          name: projectName ?? 'Shared design',
          walls,
          furniture,
          roomLabels,
          stairs: floors[0].stairs,
          floors,
          plot,
          floorMaterial,
          units,
          constructionRate,
          northOffset,
          plotFacing,
          // A shared design is for viewing, so it opens in 3D.
          viewMode: '3d',
        }),
      )

      let copied = false
      try {
        await navigator.clipboard.writeText(url)
        copied = true
      } catch {
        // Clipboard access needs permission and a secure context; the link is
        // shown in a selectable field either way.
      }
      setState({ kind: 'ready', url, copied })
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not build a link.',
      })
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={share}
        data-testid="share-button"
        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
      >
        Share
      </button>

      {state.kind === 'ready' && (
        <div
          className="absolute right-0 z-20 mt-1.5 w-96 rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
          data-testid="share-panel"
        >
          <p className="mb-2 text-[11px] font-semibold text-slate-700">
            {state.copied ? 'Link copied to clipboard' : 'Read-only link'}
          </p>
          <input
            readOnly
            value={state.url}
            data-testid="share-url"
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-[10px] text-slate-600 outline-none"
          />
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            The whole design is inside the link, so anyone who opens it sees this
            layout in a read-only viewer. Nothing is uploaded.
          </p>
        </div>
      )}

      {state.kind === 'error' && (
        <div
          className="absolute right-0 z-20 mt-1.5 w-64 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 shadow-lg"
          data-testid="share-error"
        >
          {state.message}
        </div>
      )}
    </div>
  )
}
