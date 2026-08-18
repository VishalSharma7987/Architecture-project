import { useEffect, useRef, useState } from 'react'
import { AI_UNAVAILABLE_MESSAGE, isAiConfigured } from '../ai/endpoint'
import { useDesignStore } from '../store/useDesignStore'
import { buildWallsFromBlueprint } from './buildStructure'
import {
  analyseBlueprint,
  applyPlanScale,
  placeFurniture,
  placeOpenings,
  placeRooms,
  type AnalyseResult,
  type ScaleSource,
} from './detectOpenings'

export type StructurePhase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'building' }
  | {
      kind: 'built'
      walls: number
      /** Near-miss joints the ingest weld closed on the way in (B36). */
      welded: number
      openings: number
      dropped: number
      rooms: number
      furniture: number
      scale: ScaleSource
    }
  | { kind: 'walls-only'; walls: number; welded: number; reason: string }
  /**
   * A plausibility gate refused, so NOTHING was built.
   *
   * Its own phase rather than folding into `none`: "no walls found" and "this
   * image cannot be read accurately enough to try" are different facts, and
   * the second one tells the user what to do about it. `gate` names which
   * check failed so the message can never degrade to "detection failed".
   */
  | { kind: 'refused'; gate: string; message: string }
  | { kind: 'none' }

/**
 * Turns a traced blueprint into a faithful 3D structure the moment the user
 * asks to see it in 3D.
 *
 * The order matters and is the whole point of this hook:
 *   1. read the plan once — its real dimensions AND its openings, in one call;
 *   2. size the blueprint to those dimensions, so the walls come out true-size
 *      rather than at the default guess;
 *   3. build the walls at that scale;
 *   4. place the doors and windows on them.
 *
 * It runs once per image — keyed on the blueprint's own URL — so toggling 2D/3D
 * afterwards, or deleting the built walls, does not keep rebuilding them.
 *
 * The returned phase carries how the scale was decided and how many openings
 * landed versus dropped, because a guessed size and a measured one are
 * different claims, and a silently-empty wall is worse than one the user is
 * told about.
 */
export function useBlueprintStructure(): StructurePhase {
  const viewMode = useDesignStore((s) => s.viewMode)
  const blueprintSrc = useDesignStore((s) => s.blueprint?.src ?? null)
  const blueprintVisible = useDesignStore((s) => s.blueprint?.visible ?? false)

  const [phase, setPhase] = useState<StructurePhase>({ kind: 'idle' })
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (viewMode !== '3d' || !blueprintSrc || !blueprintVisible) return
    if (handled.current === blueprintSrc) return

    if (useDesignStore.getState().walls.length > 0) {
      handled.current = blueprintSrc
      return
    }

    handled.current = blueprintSrc
    let live = true

    void (async () => {
      // 1. Read the plan: dimensions + openings in one vision call. If that
      // fails (no key, out of credit), fall back to walls alone at the default
      // scale so the conversion still produces something.
      //
      // Skipped outright when the build has no AI backend: the request would
      // 404 against a static host, and spending a second on a round trip that
      // cannot succeed only delays the walls the deterministic detector is
      // about to build anyway.
      const analysis: AnalyseResult = isAiConfigured()
        ? await (async () => {
            setPhase({ kind: 'reading' })
            return analyseBlueprint()
          })()
        : { ok: false, error: AI_UNAVAILABLE_MESSAGE }
      if (!live) return

      // 2. Size the blueprint to its real dimensions, before the walls inherit
      // the scale. Guessed when the plan carried no legible dimension.
      const scale: ScaleSource = analysis.ok
        ? applyPlanScale(analysis.analysis)
        : { kind: 'guess' }
      if (!live) return

      // 3. Build the walls at that scale.
      setPhase({ kind: 'building' })
      const walls = await buildWallsFromBlueprint()
      if (!live) return
      if (!walls.ok) {
        // A refusal is reported, never swallowed. Falling back to `idle` here
        // would leave the 3D view empty with no explanation, which is exactly
        // the "detection failed" non-message this session exists to replace.
        if (walls.reason === 'implausible' && walls.gate) {
          setPhase({
            kind: 'refused',
            gate: walls.gate.gate,
            message: walls.gate.message,
          })
          return
        }
        setPhase({ kind: walls.reason === 'none-found' ? 'none' : 'idle' })
        return
      }

      // 4. Place the openings the read already found. No second call — the
      // list came back with the dimensions.
      if (!analysis.ok) {
        setPhase({
          kind: 'walls-only',
          walls: walls.count,
          welded: walls.welded,
          reason: analysis.error,
        })
        return
      }
      const placed = placeOpenings(analysis.analysis.openings)
      // 5. Name the rooms and drop in the furniture the same read found. Rooms
      // resolve against the walls just built, so this has to follow them.
      const rooms = placeRooms(analysis.analysis.rooms)
      const furniture = placeFurniture(analysis.analysis.furniture)
      if (!live) return
      setPhase({
        kind: 'built',
        walls: walls.count,
        welded: walls.welded,
        openings: placed.added,
        dropped: placed.dropped,
        rooms: rooms.named,
        furniture: furniture.placed,
        scale,
      })
    })()

    return () => {
      live = false
    }
  }, [viewMode, blueprintSrc, blueprintVisible])

  // The final notices are transient; clear them a few seconds after they
  // appear so the 3D view is not permanently captioned.
  useEffect(() => {
    if (
      phase.kind !== 'built' &&
      phase.kind !== 'none' &&
      phase.kind !== 'walls-only'
    ) {
      return
    }
    const timer = setTimeout(
      () => setPhase({ kind: 'idle' }),
      phase.kind === 'built' ? 6500 : 8000,
    )
    return () => clearTimeout(timer)
  }, [phase])

  return phase
}
