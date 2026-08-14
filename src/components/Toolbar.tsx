import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  allFloors,
  useDesignStore,
  type FloorData,
  type Tool,
  type Unit,
  type ViewMode,
  type WalkView,
  type WallType,
} from '../store/useDesignStore'
import { ProjectsMenu } from './ProjectsMenu'
import { ShareButton } from './ShareButton'

const MODES: SegOption<ViewMode>[] = [
  { id: '2d', label: '2D', hint: 'Top-down plan view' },
  { id: '3d', label: '3D', hint: 'Orbit the model in 3D' },
]

const WALK_VIEWS: SegOption<WalkView>[] = [
  {
    id: 'third',
    label: 'Follow',
    hint: 'Follow a person walking the design',
    testId: 'walk-view-third',
  },
  {
    id: 'first',
    label: 'Eyes',
    hint: 'See it through their eyes',
    testId: 'walk-view-first',
  },
]

const UNITS: SegOption<Unit>[] = [
  { id: 'ftin', label: 'ft-in', hint: 'Show lengths in feet and inches', testId: 'units-ftin' },
  { id: 'm', label: 'm', hint: 'Show lengths in metres', testId: 'units-m' },
]

const WALL_TYPES: SegOption<WallType>[] = [
  {
    id: 'shell',
    label: 'Shell',
    hint: 'External and load-bearing walls — 230 mm',
    testId: 'wall-type-shell',
  },
  {
    id: 'partition',
    label: 'Partition',
    hint: 'Internal dividers — 115 mm',
    testId: 'wall-type-partition',
  },
]

const TOOLS: (SegOption<Tool> & { planOnly?: boolean })[] = [
  { id: 'select', label: 'Select', hint: 'Select and edit walls and openings', testId: 'tool-select' },
  { id: 'wall', label: 'Wall', hint: 'Draw walls', planOnly: true, testId: 'tool-wall' },
  { id: 'door', label: 'Door', hint: 'Click a wall to add a door', testId: 'tool-door' },
  { id: 'window', label: 'Window', hint: 'Click a wall to add a window', testId: 'tool-window' },
  // A cased opening — a gap with no leaf and no glass, tagged `O` on a plan.
  // A tool rather than a type selector on the inspector: `updateOpening`'s
  // patch deliberately excludes `type`, so converting an existing opening
  // would mean widening that contract and allowing a door to become a window
  // while keeping its swing. Placing is also the symmetry people expect —
  // every other opening is "pick a tool, click a wall".
  {
    id: 'cased',
    label: 'Opening',
    hint: 'Click a wall to add a cased opening — a gap with no door or window',
    testId: 'tool-cased',
  },
  // Plan-only like Wall: the outline is dragged on the plan, and there is no
  // floor in 3D to drag it across — an open space has no slab under it.
  //
  // A tool rather than a Select-tool gesture: with Select, a left-drag on
  // empty floor already pans the sheet, and taking that over would break the
  // one gesture that works the same on a mouse and a trackpad. It also makes
  // the action FINDABLE, which was the audit's actual complaint — there was no
  // "place a room label here" affordance anywhere in the app.
  {
    id: 'space',
    label: 'Space',
    hint: 'Drag to outline a space no walls enclose — a porch, sitout or balcony',
    planOnly: true,
    testId: 'tool-space',
  },
  // Plan-only for the same reason as Wall: a stair is placed by pointing at a
  // spot on the storey below, which only the plan gives you.
  { id: 'stair', label: 'Stair', hint: 'Click to place a staircase', planOnly: true, testId: 'tool-stair' },
]

/** One side-panel switch. `planOnly` ones drop out of 3D. */
type PanelSwitch = {
  label: string
  title?: string
  open: boolean
  onToggle: () => void
  testId: string
  planOnly?: boolean
}

/** Icon-button styling for Undo/Redo, quiet until disabled makes them quieter. */
const UNDO_CLASS =
  'flex h-7 w-7 items-center justify-center rounded-md text-slate-600 ' +
  'transition-colors hover:bg-slate-100 hover:text-slate-900 ' +
  'disabled:cursor-not-allowed disabled:text-slate-300 ' +
  'disabled:hover:bg-transparent'

/** Hairline between toolbar clusters, so the groups read as groups. */
function Divider() {
  return <span className="h-5 w-px shrink-0 bg-slate-200" aria-hidden />
}

type SegOption<T extends string> = {
  id: T
  label: string
  hint?: string
  testId?: string
}

/**
 * A pick-one pill group. Four of these sit in the bar (tools, walk view, units,
 * 2D/3D); sharing one component keeps them identical by construction rather than
 * by four copies that can drift apart.
 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  padded,
}: {
  options: SegOption<T>[]
  value: T
  onChange: (id: T) => void
  ariaLabel: string
  /** Slightly wider cells — used by the two-letter 2D/3D switch. */
  padded?: boolean
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-100 p-0.5"
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            title={option.hint}
            onClick={() => onChange(option.id)}
            aria-pressed={active}
            data-testid={option.testId}
            className={`rounded-[6px] py-1 text-xs font-semibold transition-colors ${
              padded ? 'px-3' : 'px-2.5'
            } ${
              active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Top application bar: identity and everything that edits on the left, the
 * view controls on the right.
 */
export function Toolbar() {
  const viewMode = useDesignStore((s) => s.viewMode)
  const setViewMode = useDesignStore((s) => s.setViewMode)
  const walkMode = useDesignStore((s) => s.walkMode)
  const setWalkMode = useDesignStore((s) => s.setWalkMode)
  const walkView = useDesignStore((s) => s.walkView)
  const setWalkView = useDesignStore((s) => s.setWalkView)
  const tool = useDesignStore((s) => s.tool)
  const setTool = useDesignStore((s) => s.setTool)
  const aiPanelOpen = useDesignStore((s) => s.aiPanelOpen)
  const setAiPanelOpen = useDesignStore((s) => s.setAiPanelOpen)
  const furniturePanelOpen = useDesignStore((s) => s.furniturePanelOpen)
  const setFurniturePanelOpen = useDesignStore((s) => s.setFurniturePanelOpen)
  const blueprintPanelOpen = useDesignStore((s) => s.blueprintPanelOpen)
  const setBlueprintPanelOpen = useDesignStore((s) => s.setBlueprintPanelOpen)
  const roomPanelOpen = useDesignStore((s) => s.roomPanelOpen)
  const setRoomPanelOpen = useDesignStore((s) => s.setRoomPanelOpen)
  const vastuPanelOpen = useDesignStore((s) => s.vastuPanelOpen)
  const setVastuPanelOpen = useDesignStore((s) => s.setVastuPanelOpen)
  const plotPanelOpen = useDesignStore((s) => s.plotPanelOpen)
  const setPlotPanelOpen = useDesignStore((s) => s.setPlotPanelOpen)
  const setPresentMode = useDesignStore((s) => s.setPresentMode)
  const units = useDesignStore((s) => s.units)
  const setUnits = useDesignStore((s) => s.setUnits)
  const showDimensions = useDesignStore((s) => s.showDimensions)
  const setShowDimensions = useDesignStore((s) => s.setShowDimensions)
  const undo = useDesignStore((s) => s.undo)
  const redo = useDesignStore((s) => s.redo)
  const canUndo = useDesignStore((s) => s.past.length > 0)
  const canRedo = useDesignStore((s) => s.future.length > 0)
  const activeWallType = useDesignStore((s) => s.activeWallType)
  const setActiveWallType = useDesignStore((s) => s.setActiveWallType)

  // Walls are drawn in plan view only, so that tool hides in 3D. Walk mode
  // captures the pointer entirely, so no tool applies there.
  const visibleTools = walkMode
    ? []
    : TOOLS.filter((t) => !t.planOnly || viewMode === '2d')

  const panels: PanelSwitch[] = [
    {
      label: 'AI',
      title: 'Describe a change and let the assistant draw it',
      open: aiPanelOpen,
      onToggle: () => setAiPanelOpen(!aiPanelOpen),
      testId: 'ai-toggle',
    },
    {
      label: 'Finishes',
      title: 'Materials and furnishing for the scene',
      open: furniturePanelOpen,
      onToggle: () => setFurniturePanelOpen(!furniturePanelOpen),
      testId: 'furniture-toggle',
    },
    {
      label: 'Rooms',
      title: 'Name each space and see its area',
      open: roomPanelOpen,
      onToggle: () => setRoomPanelOpen(!roomPanelOpen),
      testId: 'rooms-toggle',
    },
    // Stays in 3D alongside Rooms: the reading is about where a space sits in
    // the plan, which does not change with the camera. The zone grid it can
    // draw is 2D-only, but that is the overlay's own condition.
    {
      label: 'Vastu',
      title: 'Read the plan against Vastu placement guidelines',
      open: vastuPanelOpen,
      onToggle: () => setVastuPanelOpen(!vastuPanelOpen),
      testId: 'vastu-toggle',
    },
    // Plot lines, setbacks and the buildable envelope are drawn on the plan,
    // so like Blueprint the panel would have nothing to sit under in 3D.
    {
      label: 'Plot',
      title: 'Set the plot size and its setbacks, and check the fit',
      open: plotPanelOpen,
      onToggle: () => setPlotPanelOpen(!plotPanelOpen),
      testId: 'plot-toggle',
      planOnly: true,
    },
    // Tracing happens on the plan canvas, so the panel would have nothing to
    // sit under in 3D.
    {
      label: 'Blueprint',
      title: 'Trace walls over an uploaded floor plan image',
      open: blueprintPanelOpen,
      onToggle: () => setBlueprintPanelOpen(!blueprintPanelOpen),
      testId: 'blueprint-toggle',
      planOnly: true,
    },
  ]

  // Loose in the row these now outnumber the tools beside them and stop
  // reading as a set, so they share one tray the way the tools do.
  const visiblePanels = walkMode
    ? []
    : panels.filter((p) => !p.planOnly || viewMode === '2d')

  return (
    // Two tiers, not one crammed row. The top is about the file and how you
    // view it; the bottom is about what you are editing right now. Splitting
    // them stops nine control clusters from fighting for one line — the old
    // single row overflowed in 3D on a laptop and scrolled its own groups out
    // of sight.
    <header className="flex shrink-0 flex-col border-b border-slate-200 bg-white">
      {/* Tier 1 — document & view */}
      <div className="flex h-12 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="h-6 w-6 shrink-0 rounded-md bg-slate-900" aria-hidden />
          <span className="shrink-0 text-[15px] font-semibold tracking-tight text-slate-900">
            Space Designer
          </span>
          <Divider />
          <ProjectsMenu />
          <Divider />
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
              aria-label="Undo"
              data-testid="undo"
              className={UNDO_CLASS}
            >
              <span aria-hidden className="text-base leading-none">
                ↶
              </span>
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (⇧⌘Z)"
              aria-label="Redo"
              data-testid="redo"
              className={UNDO_CLASS}
            >
              <span aria-hidden className="text-base leading-none">
                ↷
              </span>
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {/* Display only — the model stays metric, so this is safe to flip at
              any time and belongs with the other view controls. Walk mode
              shows no dimensions, so it drops out there. */}
          {!walkMode && (
            <Segmented
              options={UNITS}
              value={units}
              onChange={setUnits}
              ariaLabel="Units"
            />
          )}

          {/* One switch for every measurement on the model. Display-only like
              Units, so it sits with the view controls; walk mode shows no
              dimensions, so it drops out there. In 2D it labels wall lengths
              and opening widths; in 3D it labels heights too. */}
          {!walkMode && (
            <button
              type="button"
              onClick={() => setShowDimensions(!showDimensions)}
              aria-pressed={showDimensions}
              title={
                showDimensions
                  ? 'Hide the wall, door and window measurements'
                  : 'Show every wall length, thickness, and door and window size'
              }
              data-testid="dimensions-toggle"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                showDimensions
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:text-slate-900'
              }`}
            >
              Dimensions
            </button>
          )}

          {!walkMode && <ShareButton />}

          {!walkMode && (
            <button
              type="button"
              onClick={() => setPresentMode(true)}
              data-testid="present-button"
              className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
            >
              Present
            </button>
          )}

          <Segmented
            options={MODES}
            value={viewMode}
            onChange={setViewMode}
            ariaLabel="View mode"
            padded
          />
        </div>
      </div>

      {/* Tier 2 — editing context. A lighter strip so it reads as the
          sub-toolbar it is, not a second equal row. */}
      <div className="flex h-11 items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-4">
        {/* Plain buttons, so it is safe to scroll if a narrow window fills the
            row rather than let it run under the walk controls. */}
        <div className="flex min-w-0 items-center gap-2.5 overflow-x-auto">
          {!walkMode && <FloorSelector />}

          {visibleTools.length > 0 && <Divider />}
          {visibleTools.length > 0 && (
            <Segmented
              options={visibleTools}
              value={tool}
              onChange={setTool}
              ariaLabel="Tool"
            />
          )}

          {/*
            Which KIND of wall the pencil draws next. Beside the tool group and
            only while that tool is live, because it is a setting on the tool
            rather than a property of the building — the reference's most
            immediate signal is thick shell against thin partition, and before
            B32 the only way to get it was to draw sixteen identical walls and
            retype a number on each.
          */}
          {tool === 'wall' && viewMode === '2d' && !walkMode && (
            <Segmented
              options={WALL_TYPES}
              value={activeWallType}
              onChange={setActiveWallType}
              ariaLabel="Wall type"
            />
          )}

          {/* A menu rather than a row: six toggles laid out flat pushed
              Blueprint — the only way to load a plan image — off the end of the
              toolbar on an ordinary laptop, where it read as a removed feature. */}
          {visiblePanels.length > 0 && <Divider />}
          {visiblePanels.length > 0 && <PanelsMenu panels={visiblePanels} />}

          {/* When nothing else is in this row (3D walk mode), a word keeps it
              from looking like a broken empty strip. */}
          {walkMode && (
            <span className="text-xs text-slate-400">Walking the model</span>
          )}
        </div>

        {viewMode === '3d' && (
          <div className="flex shrink-0 items-center gap-2.5">
            {/* Offered before the walk starts as well as during it: which body
                you walk in is a choice, not a mid-walk correction. Picking
                "Follow" puts the person in the room straight away, so the
                switch shows its effect without waiting for Walk. */}
            <span className="text-xs text-slate-500">Walk as</span>
            <Segmented
              options={WALK_VIEWS}
              value={walkView}
              onChange={setWalkView}
              ariaLabel="Walkthrough view"
            />
            <button
              type="button"
              onClick={() => setWalkMode(!walkMode)}
              aria-pressed={walkMode}
              data-testid="walk-toggle"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                walkMode
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:text-slate-900'
              }`}
            >
              {walkMode ? 'Exit walk' : 'Walk'}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

/** How much has been drawn on a storey — nothing at all, or something. */
function storeyItems(floor: FloorData) {
  return floor.walls.length + floor.furniture.length + floor.stairs.length
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

// Quiet until it can be used: copying up is an occasional act, not something
// to compete with the storey it sits beside.
const COPY_UP_CLASS =
  'rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-500 ' +
  'transition-colors hover:bg-slate-100 hover:text-slate-900 ' +
  'disabled:cursor-not-allowed disabled:text-slate-300 ' +
  'disabled:hover:bg-transparent'

/** What is on a storey, for its tooltip. */
function describeStorey(floor: FloorData) {
  const parts = [
    floor.walls.length > 0 ? plural(floor.walls.length, 'wall') : null,
    floor.stairs.length > 0 ? plural(floor.stairs.length, 'stair') : null,
    floor.furniture.length > 0 ? plural(floor.furniture.length, 'item') : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : 'empty'
}

/**
 * Storey switch, plus copying a storey up to the one above.
 *
 * Deliberately louder than every other control in the row: which floor is open
 * decides where the next wall lands, and a wall drawn onto the wrong storey is
 * invisible until you go looking for it. So the active floor is a filled dark
 * pill with a caption beside it, not the quiet white pill the tools use, and
 * every storey carries a dot when it has something on it — an empty floor and
 * a drawn one must never look alike.
 */
function FloorSelector() {
  const floors = useDesignStore((s) => s.floors)
  const activeFloor = useDesignStore((s) => s.activeFloor)
  const walls = useDesignStore((s) => s.walls)
  const furniture = useDesignStore((s) => s.furniture)
  const roomLabels = useDesignStore((s) => s.roomLabels)
  const stairs = useDesignStore((s) => s.stairs)
  const setActiveFloor = useDesignStore((s) => s.setActiveFloor)
  const copyToNextFloor = useDesignStore((s) => s.copyToNextFloor)
  const [refused, setRefused] = useState<string | null>(null)

  // `floors` is stale for the storey being edited, so the counts have to come
  // through allFloors — otherwise the open floor would show as empty until it
  // was filed back on the next switch.
  const storeys = useMemo(
    () =>
      allFloors({ floors, activeFloor, walls, furniture, roomLabels, stairs }),
    [floors, activeFloor, walls, furniture, roomLabels, stairs],
  )

  const above = storeys[activeFloor + 1]
  const occupied = above ? above.walls.length + above.furniture.length : 0
  const copyRefusal = !above
    ? 'No floor above this one'
    : occupied > 0
      ? `${above.name} already has work on it — copying would replace it, ` +
        'and that cannot be undone'
      : null

  const copyUp = () => {
    // The store re-checks at click time, and the assistant can draw onto
    // another storey between render and click, so a refusal here is real and
    // gets said out loud rather than reading as a dead button.
    if (copyToNextFloor()) setRefused(null)
    else setRefused(copyRefusal ?? 'That floor already has work on it')
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-xs text-slate-400">Floor</span>
      <div
        className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5"
        role="group"
        aria-label="Floor"
      >
        {storeys.map((floor, index) => {
          const active = index === activeFloor
          const items = storeyItems(floor)
          return (
            <button
              key={floor.id}
              type="button"
              title={`${floor.name} — ${describeStorey(floor)}`}
              onClick={() => {
                setRefused(null)
                setActiveFloor(index)
              }}
              aria-pressed={active}
              data-testid={`floor-${index}`}
              className={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              {floor.name.replace(/ Floor$/, '')}
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  items === 0
                    ? 'bg-transparent'
                    : active
                      ? 'bg-white'
                      : 'bg-slate-400'
                }`}
              />
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={copyUp}
        disabled={copyRefusal !== null}
        title={
          copyRefusal ??
          `Copy this floor's walls, furniture and stairs up to ${above?.name}`
        }
        data-testid="copy-to-next-floor"
        className={COPY_UP_CLASS}
      >
        Copy up
      </button>

      {refused && (
        <span role="status" className="text-xs text-amber-600">
          {refused}
        </span>
      )}
    </div>
  )
}

/**
 * Side-panel switch. Several sit side by side, so they share a shape.
 *
 * The filled active state is kept rather than the tool group's white pill:
 * these are independent toggles, several of which can be lit at once, and the
 * tool group next to them is a pick-one. Looking different says so.
 */
/**
 * The side panels, behind one button.
 *
 * Laid out flat these six ran off the end of the row and became unreachable,
 * which is indistinguishable from being gone. A menu costs one click and
 * always fits; the count of open panels stays on the button so nothing is
 * hidden that is currently doing something.
 */
function PanelsMenu({ panels }: { panels: PanelSwitch[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const openCount = panels.filter((p) => p.open).length

  // The menu is portalled to <body> and positioned in viewport coordinates, so
  // it escapes the toolbar's horizontal-scroll container. That container is
  // `overflow-x: auto`, which forces `overflow-y` to `auto` as well — so an
  // in-flow dropdown was clipped to the toolbar's height and vanished beneath
  // the canvas. Fixed positioning against the button's rect sidesteps it.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 6, left: r.left })
    }
    place()
    window.addEventListener('resize', place)
    // Capture so the toolbar row's own horizontal scroll is followed, not just
    // the page's — otherwise the button slides out from under a fixed menu.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      // The menu now lives outside this component's DOM subtree, so a click on
      // it has to be recognised as "inside" explicitly or it would close before
      // the item's onClick runs.
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="panels-menu"
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
          openCount > 0
            ? 'bg-slate-900 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
        }`}
      >
        Panels
        {openCount > 0 && (
          <span className="rounded bg-white/20 px-1 tabular-nums">{openCount}</span>
        )}
        <span aria-hidden className="text-[9px] opacity-60">
          ▼
        </span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            data-testid="panels-panel"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-50 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
          >
            {panels.map((panel) => (
              <button
                key={panel.testId}
                type="button"
                title={panel.title}
                onClick={panel.onToggle}
                aria-pressed={panel.open}
                data-testid={panel.testId}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                  panel.open
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {panel.label}
                {panel.open && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

