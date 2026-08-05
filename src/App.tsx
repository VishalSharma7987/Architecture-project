import { AIPanel } from './components/AIPanel'
import { useBlueprintStructure } from './blueprint/useBlueprintStructure'
import { BlueprintPanel } from './components/BlueprintPanel'
import { CompassWidget } from './components/CompassWidget'
import { FurniturePanel } from './components/FurniturePanel'
import { InspectorPanel } from './components/InspectorPanel'
import { PlotPanel } from './components/PlotPanel'
import { PresentOverlay } from './components/PresentOverlay'
import { RoomSchedulePanel } from './components/RoomSchedulePanel'
import { SharedBanner } from './components/SharedBanner'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { VastuPanel } from './components/VastuPanel'
import { useDeleteShortcut } from './components/useDeleteShortcut'
import { useUndoShortcut } from './components/useUndoShortcut'
import { useAutosave } from './persistence/useAutosave'
import { useSharedDesign } from './persistence/useSharedDesign'
import { FloorPlanEditor } from './plan/FloorPlanEditor'
import { SceneCanvas } from './scene/SceneCanvas'
import { useDesignStore } from './store/useDesignStore'

/**
 * App shell.
 *
 * Three layouts share one tree — present mode and read-only hide chrome rather
 * than swapping to a different structure. That is deliberate: rendering the
 * viewport from a different branch would unmount the canvas, tearing down the
 * WebGL context and rebuilding the whole scene just to hide a toolbar.
 */
export default function App() {
  const viewMode = useDesignStore((s) => s.viewMode)
  const walkMode = useDesignStore((s) => s.walkMode)
  const aiPanelOpen = useDesignStore((s) => s.aiPanelOpen)
  const furniturePanelOpen = useDesignStore((s) => s.furniturePanelOpen)
  const blueprintPanelOpen = useDesignStore((s) => s.blueprintPanelOpen)
  const roomPanelOpen = useDesignStore((s) => s.roomPanelOpen)
  const vastuPanelOpen = useDesignStore((s) => s.vastuPanelOpen)
  const plotPanelOpen = useDesignStore((s) => s.plotPanelOpen)
  const presentMode = useDesignStore((s) => s.presentMode)
  const readOnly = useDesignStore((s) => s.readOnly)

  const shared = useSharedDesign()
  // Switching to 3D with a freshly traced blueprint builds its walls, so the
  // plan image becomes a structure you can orbit rather than a flat underlay.
  const structure = useBlueprintStructure()
  useDeleteShortcut()
  useUndoShortcut()
  // A shared design is someone else's; autosaving it would overwrite the
  // viewer's own draft the moment they opened the link.
  useAutosave({ enabled: !readOnly })

  const chrome = !presentMode
  const editing = chrome && !readOnly

  if (shared.kind === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Opening shared design…
      </div>
    )
  }

  return (
    <div className="relative flex h-screen w-screen flex-col bg-slate-50">
      {chrome &&
        (readOnly ? (
          <SharedBanner error={shared.kind === 'error' ? shared.message : null} />
        ) : (
          <Toolbar />
        ))}

      <div className="flex min-h-0 flex-1">
        {editing && aiPanelOpen && !walkMode && <AIPanel />}
        {editing && furniturePanelOpen && !walkMode && <FurniturePanel />}
        {/* Rooms are derived from the walls, so the schedule is as true in 3D
            as it is in plan — no viewMode condition here. */}
        {editing && roomPanelOpen && !walkMode && <RoomSchedulePanel />}
        {/* Same reasoning: the reading is about where a room sits in the plan,
            which the camera does not change, so it stays in 3D too. Gated on
            open rather than left to the panel's own guard so the analysis —
            every room polygon clipped against nine zones — never runs while
            the panel is shut. */}
        {editing && vastuPanelOpen && !walkMode && <VastuPanel />}
        {/* The plot line, its setbacks and the buildable envelope are drawn on
            the plan canvas, so the panel that sets them follows them there. */}
        {editing && plotPanelOpen && viewMode === '2d' && <PlotPanel />}
        {/* Tracing is a plan-view act — the underlay only exists on the 2D
            canvas, so the panel follows it there. */}
        {editing && blueprintPanelOpen && viewMode === '2d' && <BlueprintPanel />}

        <main className="relative min-w-0 flex-1">
          {viewMode === '2d' && !presentMode ? <FloorPlanEditor /> : <SceneCanvas />}

          {/* Over the drawing, not in the toolbar: setting North is something
              you do while looking at the walls, turning the rose until it
              matches the road or the plot boundary. Walk mode is full-immersion,
              and a shared design still wants to show which way it faces. */}
          {chrome && !walkMode && (
            <div className="pointer-events-none absolute right-4 top-4 z-10">
              <CompassWidget />
            </div>
          )}

          {/* Reports what building the 3D structure from a blueprint did — a
              silently empty scene would read as the app failing rather than the
              image being untraceable. */}
          {viewMode === '3d' && structure.kind !== 'idle' && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2">
              <div className="max-w-md rounded-lg bg-slate-900/85 px-4 py-2 text-center text-xs text-white shadow-lg">
                {structure.kind === 'reading' &&
                  'Reading the plan — scale, openings, rooms and furniture…'}
                {structure.kind === 'building' && 'Building the walls to scale…'}
                {structure.kind === 'built' &&
                  `${
                    structure.scale.kind === 'calibrated'
                      ? `Sized to ${structure.scale.feet}′ from the drawing. `
                      : 'Sized by best guess — no dimension was legible; calibrate in 2D. '
                  }Built ${structure.walls} walls and placed ${
                    structure.openings
                  } door${structure.openings === 1 ? '' : 's'} and windows${
                    structure.dropped > 0
                      ? `, ${structure.dropped} could not be placed`
                      : ''
                  }${
                    structure.rooms > 0
                      ? `, named ${structure.rooms} room${structure.rooms === 1 ? '' : 's'}`
                      : ''
                  }${
                    structure.furniture > 0
                      ? ` and set out ${structure.furniture} furnishing${structure.furniture === 1 ? '' : 's'}`
                      : ''
                  }. Fix any misses with the Door and Window tools.`}
                {structure.kind === 'walls-only' &&
                  `Built ${structure.walls} walls, but the doors and windows could not be read (${structure.reason}). Add them from the Blueprint panel or by hand.`}
                {structure.kind === 'none' &&
                  'Could not read walls from this image automatically — trace them in 2D.'}
              </div>
            </div>
          )}
        </main>

        {/* Walk mode is full-immersion; a properties panel would just be in
            the way, and the pointer is captured anyway. */}
        {editing && !walkMode && <InspectorPanel />}
      </div>

      {/* Chrome, not an editing control: a read-only viewer wants to know how
          big the place is as much as its author does. */}
      {chrome && <StatusBar />}

      {presentMode && <PresentOverlay />}
    </div>
  )
}
