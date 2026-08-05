import { useEffect, useRef } from 'react'
import { allFloors, useDesignStore, type Wall } from '../store/useDesignStore'
import { serializeDesign } from './schema'
import { readAutosave, saveProject, writeAutosave } from './storage'

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

export function useAutosave(
  { enabled = true }: { enabled?: boolean } = {},
  intervalMs = AUTOSAVE_INTERVAL_MS,
) {
  // Identity of the last-persisted walls array. Zustand replaces the array on
  // every mutation, so a reference check is a sufficient dirty flag — no deep
  // compare, no per-action revision counter to keep in sync.
  const savedWallsRef = useRef<Wall[] | null>(null)

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
    })
    savedWallsRef.current = useDesignStore.getState().walls
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    const timer = setInterval(() => {
      const {
        walls,
        projectName,
        viewMode,
        furniture,
        roomLabels,
        plot,
        floorMaterial,
        units,
        constructionRate,
        northOffset,
        plotFacing,
      } =
        useDesignStore.getState()
      if (walls === savedWallsRef.current) return

      // Autosave must capture every storey, not just the one on screen —
      // otherwise a reload after working upstairs loses the floors below.
      const floors = allFloors(useDesignStore.getState())
      const doc = serializeDesign({
        name: projectName ?? 'Untitled',
        walls,
        furniture,
        roomLabels,
        stairs: floors[0].stairs,
        floors,
        plot,
        floorMaterial,
        viewMode,
        units,
        constructionRate,
        northOffset,
        plotFacing,
      })

      // The draft slot always gets the current state, so an unnamed design
      // still survives a reload. A named project is updated alongside it.
      const draft = writeAutosave({ name: projectName, doc })
      if (!draft.ok) return

      if (projectName) {
        const project = saveProject(doc)
        if (!project.ok) return
      }

      savedWallsRef.current = walls
    }, intervalMs)

    return () => clearInterval(timer)
  }, [enabled, intervalMs])
}
