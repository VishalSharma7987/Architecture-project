import { useEffect, useState } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import { attachable } from './schema'
import { decodeShareLink, readShareFragment } from './shareLink'

type SharedState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'error'; message: string }

/**
 * Loads a design from the URL fragment on startup, if there is one.
 *
 * Runs before autosave restore matters: a share link is an explicit request to
 * view *that* design, so it wins over whatever draft is in localStorage.
 */
export function useSharedDesign(): SharedState {
  const [state, setState] = useState<SharedState>(() =>
    readShareFragment() ? { kind: 'loading' } : { kind: 'none' },
  )

  useEffect(() => {
    let cancelled = false

    const load = (payload: string) => {
      setState({ kind: 'loading' })
      decodeShareLink(payload).then((result) => {
        if (cancelled) return
        apply(result)
      })
    }

    const apply = (result: Awaited<ReturnType<typeof decodeShareLink>>) => {
      if (!result.ok) {
        // Still enter read-only: the URL says "view a shared design", and
        // silently dropping into the editor would be more confusing than
        // showing an empty viewer with the reason.
        useDesignStore.getState().loadDesign({
          name: null,
          walls: [],
          readOnly: true,
          viewMode: '3d',
        })
        setState({ kind: 'error', message: result.error })
        return
      }

      useDesignStore.getState().loadDesign({
        name: result.doc.name,
        walls: result.doc.walls,
        furniture: result.doc.furniture,
        roomLabels: result.doc.rooms,
        plot: result.doc.plot,
        floors: result.doc.floors,
        stairs: result.doc.floors[0]?.stairs,
        floorMaterial: result.doc.settings.floorMaterial,
        viewMode: result.doc.settings.viewMode,
        units: result.doc.settings.units,
        constructionRate: result.doc.settings.constructionRate,
        northOffset: result.doc.settings.northOffset,
        plotFacing: result.doc.settings.plotFacing,
        blueprint: attachable(result.doc.blueprint),
        readOnly: true,
      })
      setState({ kind: 'loaded' })
    }

    const initial = readShareFragment()
    if (initial) load(initial)

    // A URL differing only in its fragment does not reload the page, so
    // pasting a share link into an already-open tab would otherwise do
    // nothing at all. Watch for it explicitly.
    const onHashChange = () => {
      const payload = readShareFragment()
      if (payload) load(payload)
    }
    window.addEventListener('hashchange', onHashChange)

    return () => {
      cancelled = true
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  return state
}
