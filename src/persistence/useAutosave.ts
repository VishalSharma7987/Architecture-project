import { useEffect, useRef } from 'react'
import {
  allFloors,
  persistedChanged,
  persistedFingerprint,
  useDesignStore,
  type PersistedFingerprint,
} from '../store/useDesignStore'
import { attachable, serializeDesign } from './schema'
import {
  AUTOSAVE_KEY,
  PROJECTS_KEY,
  readAutosave,
  saveProject,
  writeAutosave,
} from './storage'

export const AUTOSAVE_INTERVAL_MS = 4000

/**
 * Restores the last draft on startup, then writes the design back every few
 * seconds while it is changing.
 *
 * Guarded at module scope rather than with a ref: React StrictMode mounts
 * effects twice in development, and restoring twice would clobber edits made
 * between the two runs.
 */
let restored = false

/** For tests, which need each case to start from a clean module. */
export const __resetRestoredGuard = () => {
  restored = false
}

export function useAutosave(
  { enabled = true }: { enabled?: boolean } = {},
  intervalMs = AUTOSAVE_INTERVAL_MS,
) {
  /**
   * Fingerprint of the last successfully persisted design.
   *
   * This used to be the walls array alone — `if (walls === savedWallsRef.current)
   * return` — so an afternoon spent naming rooms, arranging furniture, setting
   * the plot, rotating north or entering a rate was never written anywhere,
   * while the README promised that closing the tab does not lose work. The
   * fingerprint covers everything `serializeDesign` reads.
   */
  const savedRef = useRef<PersistedFingerprint | null>(null)

  useEffect(() => {
    if (!enabled || restored) return
    restored = true

    const entry = readAutosave()
    if (!entry) return

    // An empty draft is not worth restoring over a fresh session.
    if (entry.doc.walls.length === 0 && !entry.name) return

    useDesignStore.getState().loadDesign({
      name: entry.name,
      walls: entry.doc.walls,
      furniture: entry.doc.furniture,
      roomLabels: entry.doc.rooms,
      plot: entry.doc.plot,
      floors: entry.doc.floors,
      stairs: entry.doc.floors[0]?.stairs,
      floorMaterial: entry.doc.settings.floorMaterial,
      viewMode: entry.doc.settings.viewMode,
      units: entry.doc.settings.units,
      constructionRate: entry.doc.settings.constructionRate,
      northOffset: entry.doc.settings.northOffset,
      plotFacing: entry.doc.settings.plotFacing,
      blueprint: attachable(entry.doc.blueprint),
    })
    savedRef.current = persistedFingerprint(useDesignStore.getState())
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    const timer = setInterval(() => {
      const state = useDesignStore.getState()
      const fingerprint = persistedFingerprint(state)
      if (!persistedChanged(savedRef.current, fingerprint)) return

      // Autosave must capture every storey, not just the one on screen —
      // otherwise a reload after working upstairs loses the floors below.
      const floors = allFloors(state)
      const doc = serializeDesign({
        name: state.projectName ?? 'Untitled',
        walls: state.walls,
        furniture: state.furniture,
        roomLabels: state.roomLabels,
        stairs: floors[0].stairs,
        floors,
        plot: state.plot,
        blueprint: state.blueprint,
        floorMaterial: state.floorMaterial,
        viewMode: state.viewMode,
        units: state.units,
        constructionRate: state.constructionRate,
        northOffset: state.northOffset,
        plotFacing: state.plotFacing,
      })

      // The draft slot always gets the current state, so an unnamed design
      // still survives a reload. A named project is updated alongside it.
      const draft = writeAutosave({ name: state.projectName, doc })
      if (!draft.ok) {
        // Reported, not swallowed. The old code returned here without touching
        // the dirty marker and retried every four seconds in silence, so a full
        // quota looked exactly like a working autosave.
        state.setAutosave({ kind: 'failed', message: draft.error })
        return
      }

      if (state.projectName) {
        const project = saveProject(doc)
        if (!project.ok) {
          state.setAutosave({ kind: 'failed', message: project.error })
          return
        }
      }

      savedRef.current = fingerprint
      state.setAutosave({ kind: 'saved', at: doc.savedAt })
    }, intervalMs)

    return () => clearInterval(timer)
  }, [enabled, intervalMs])

  /**
   * Notices when another tab writes the same slots.
   *
   * Two tabs on one origin both autosave every four seconds into
   * `space-design.autosave.v1` and, if a project is open, the same project key.
   * Whichever writes last wins, and the other tab's work is gone with no sign
   * that anything happened.
   *
   * Merging two divergent designs is not something this app can do, and
   * guessing would be worse than losing one of them. So the honest move is to
   * say it is happening and let the user close a tab or export. The `storage`
   * event fires only in OTHER tabs, which is exactly the audience.
   */
  useEffect(() => {
    if (!enabled) return

    const onStorage = (event: StorageEvent) => {
      if (event.key !== AUTOSAVE_KEY && event.key !== PROJECTS_KEY) return
      useDesignStore.getState().setAutosave({ kind: 'conflict' })
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [enabled])
}
