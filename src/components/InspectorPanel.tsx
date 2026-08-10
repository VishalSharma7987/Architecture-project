import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_SWING,
  FLOOR_HEIGHT,
  LIMITS,
  OPENING_LABELS,
  STAIR_DEFAULTS,
  useDesignStore,
} from '../store/useDesignStore'
import type {
  Point,
  RoomId,
  RoomLabel,
  RoomType,
  Swing,
  Unit,
  Wall,
} from '../store/useDesignStore'
import { DEFAULT_WALL_MATERIAL } from '../materials/palette'
import { furnitureSize, getFurniture } from '../furniture/catalog'
import { provenance } from '../store/provenance'
import { ROOM_TYPES, getRoomType, roomDisplayName } from '../rooms/catalog'
import { resolveRooms, roomAtPoint, roomSize } from '../rooms/resolve'
import { doorSwing, swingDirection, wallAxis } from '../scene/wallGeometry'
import { formatArea, formatLength, parseLength } from '../units/length'
import { LengthField } from './LengthField'
import { MaterialPicker } from './MaterialPicker'
import { NumberField } from './NumberField'

/**
 * The little plan symbol the swing buttons carry, sized in its own viewBox
 * units so world x is svg x and world z is svg y with no conversion.
 *
 * The wall runs left→right with its START on the left. That is the frame
 * `Swing` is defined in, so showing it is the honest way to make "left" and
 * "right" mean something — see `SwingControls` for why the obvious labels
 * ("left jamb", "opens up") are wrong.
 */
const SWING_ICON = { wallStart: 2, wallEnd: 38, y: 16, jambA: 10, jambB: 22 }

const ICON_WALL: Wall = {
  id: 'swing-icon',
  start: { x: SWING_ICON.wallStart, z: SWING_ICON.y },
  end: { x: SWING_ICON.wallEnd, z: SWING_ICON.y },
  height: 3,
  thickness: 0.2,
  openings: [],
  material: DEFAULT_WALL_MATERIAL,
}

/** Centred in the wall, spanning `jambA`→`jambB`. */
const ICON_DOOR = {
  id: 'swing-icon-door',
  type: 'door' as const,
  position: (SWING_ICON.jambA + SWING_ICON.jambB) / 2 - SWING_ICON.wallStart,
  width: SWING_ICON.jambB - SWING_ICON.jambA,
  height: 2.1,
  sill: 0,
}

/**
 * This swing, drawn as the plan symbol.
 *
 * Geometry comes from `doorSwing` rather than from four hand-written paths, so
 * the icon cannot disagree with what the canvas, the sheet and the 3D leaf
 * actually do — SD14's rule applied to a picture. Get this wrong and the
 * control is worse than no control: it would confidently show the opposite of
 * what the drawing does.
 */
function SwingIcon({ swing }: { swing: Swing }) {
  const s = doorSwing(ICON_WALL, { ...ICON_DOOR, swing })
  const direction = swingDirection(s)
  const tip = {
    x: s.hinge.x + direction.x * ICON_DOOR.width,
    z: s.hinge.z + direction.z * ICON_DOOR.width,
  }

  return (
    <svg viewBox="0 0 40 32" className="h-7 w-9" aria-hidden focusable="false">
      {/* The wall, broken by the opening. */}
      <path
        d={`M ${SWING_ICON.wallStart} ${SWING_ICON.y} H ${SWING_ICON.jambA}
            M ${SWING_ICON.jambB} ${SWING_ICON.y} H ${SWING_ICON.wallEnd}`}
        className="stroke-current"
        strokeWidth={3}
        strokeLinecap="butt"
        fill="none"
      />
      {/* The leaf, shown open — the standard symbol. */}
      <path
        d={`M ${s.hinge.x} ${s.hinge.z} L ${tip.x} ${tip.z}`}
        className="stroke-current"
        strokeWidth={2}
        fill="none"
      />
      {/* The quarter arc it sweeps. `sweep` is +1 anticlockwise in world
          terms, which is svg's sweep-flag 1 because svg y runs down exactly
          as world z does. */}
      <path
        d={`M ${tip.x} ${tip.z} A ${ICON_DOOR.width} ${ICON_DOOR.width} 0 0 ${
          s.sweep > 0 ? 1 : 0
        } ${s.free.x} ${s.free.z}`}
        className="stroke-current"
        strokeWidth={1.25}
        strokeOpacity={0.55}
        fill="none"
      />
    </svg>
  )
}

const SWING_BUTTON =
  'flex flex-1 flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 ' +
  'text-[10px] font-semibold transition-colors'

/** One two-way swing toggle: an icon of each outcome, and a word under it. */
function SwingChoice<T extends string>({
  field,
  label,
  hint,
  value,
  options,
  iconFor,
  onChange,
}: {
  /**
   * The `Swing` field this toggle writes. Names the test id, deliberately
   * rather than deriving it from `label` — the label is copy and is expected
   * to change as the wording is improved; the model field is the contract.
   */
  field: keyof Swing
  label: string
  hint: string
  value: T
  options: { id: T; caption: string; description: string }[]
  iconFor: (id: T) => Swing
  onChange: (id: T) => void
}) {
  return (
    <div>
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </h4>
      <div className="flex gap-1.5" role="group" aria-label={hint}>
        {options.map((option) => {
          const active = option.id === value
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              aria-pressed={active}
              aria-label={option.description}
              title={option.description}
              data-testid={`swing-${field}-${option.id}`}
              className={`${SWING_BUTTON} ${
                active
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              <SwingIcon swing={iconFor(option.id)} />
              {option.caption}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Which jamb a door hangs on and which way it opens.
 *
 * ── Why the obvious labels are not used ──
 * "Left jamb / right jamb" and "opens up / opens down" both name a SCREEN
 * direction for a fact stored in the WALL's frame, and they are wrong for
 * about half of all walls. A wall drawn east-to-west has its start jamb on the
 * screen's RIGHT; a north-south wall has no up or down side at all, only east
 * and west. Labelling that way would reintroduce, in words, exactly the
 * confusion SD13 keeps out of the data.
 *
 * So each button carries the plan symbol of the outcome, drawn in the wall's
 * own frame and generated by `doorSwing` itself, with the wall-relative word
 * under it and the full sentence in its title and accessible name. The picture
 * is what carries the meaning; the words only have to be honest.
 *
 * The real feedback loop is the drawing: the canvas arc, the sheet arc and the
 * 3D leaf all move as these are clicked, because all four now read one field.
 *
 * ── The absent case ──
 * An `Opening` with no `swing` shows `DEFAULT_SWING` selected, not an empty
 * state. The v3→v4 migration gives every door one, so an absent swing on a
 * door is a BUG rather than a case to design for — but `doorSwing` falls back
 * to the same default, so this shows what is actually being drawn instead of
 * suggesting the door has no swing at all.
 */
function SwingControls({
  swing,
  onChange,
}: {
  swing: Swing | undefined
  onChange: (swing: Swing) => void
}) {
  const current = swing ?? DEFAULT_SWING

  return (
    <section className="space-y-2.5" data-testid="swing-controls">
      <SwingChoice
        field="hand"
        label="Hinge"
        hint="Which jamb the door hangs on"
        value={current.hand}
        options={[
          {
            id: 'start',
            caption: 'Start',
            description: "Hinge at the jamb nearer the wall's start",
          },
          {
            id: 'end',
            caption: 'End',
            description: "Hinge at the jamb nearer the wall's end",
          },
        ]}
        iconFor={(hand) => ({ ...current, hand })}
        onChange={(hand) => onChange({ ...current, hand })}
      />

      <SwingChoice
        field="side"
        label="Opens"
        hint="Which side of the wall the leaf sweeps into"
        value={current.side}
        options={[
          {
            id: 'left',
            caption: 'Left',
            description: "Opens to the wall's left, looking from start to end",
          },
          {
            id: 'right',
            caption: 'Right',
            description: "Opens to the wall's right, looking from start to end",
          },
        ]}
        iconFor={(side) => ({ ...current, side })}
        onChange={(side) => onChange({ ...current, side })}
      />

      <p className="text-[11px] leading-relaxed text-slate-400">
        Each symbol is this door as the plan draws it, on a wall running left to
        right from its start. Left and right are that wall&rsquo;s, not the
        screen&rsquo;s.
      </p>
    </section>
  )
}

/**
 * Right-hand properties panel for the current selection.
 *
 * Every edit writes straight to the store, which both viewports render from —
 * so a height change is visible in 3D as it is typed.
 */
export function InspectorPanel() {
  const selection = useDesignStore((s) => s.selection)
  const walls = useDesignStore((s) => s.walls)
  const updateWall = useDesignStore((s) => s.updateWall)
  const updateOpening = useDesignStore((s) => s.updateOpening)
  const removeWall = useDesignStore((s) => s.removeWall)
  const removeOpening = useDesignStore((s) => s.removeOpening)
  const select = useDesignStore((s) => s.select)

  if (!selection) return null

  // Floor, furniture and rooms have their own panels; only wall/opening use
  // the wall-shaped body below.
  if (selection.kind === 'floor') return <FloorInspector />
  if (selection.kind === 'furniture') {
    return <FurnitureInspector furnitureId={selection.furnitureId} />
  }
  if (selection.kind === 'room') {
    return <RoomInspector roomId={selection.roomId} />
  }
  if (selection.kind === 'space') {
    return <RoomInspector anchor={selection.anchor} />
  }
  if (selection.kind === 'stair') {
    return <StairInspector stairId={selection.stairId} />
  }

  const wall = walls.find((w) => w.id === selection.wallId)
  if (!wall) return null

  const opening =
    selection.kind === 'opening'
      ? wall.openings.find((o) => o.id === selection.openingId)
      : undefined

  const length = wallAxis(wall).length

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white"
      data-testid="inspector"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">
          {opening ? OPENING_LABELS[opening.type] : 'Wall'}
        </h2>
        <button
          type="button"
          onClick={() => select(null)}
          className="text-xs text-slate-400 hover:text-slate-700"
          aria-label="Clear selection"
        >
          Done
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {opening ? (
          <section className="space-y-3">
            <NumberField
              label="Width"
              value={opening.width}
              min={LIMITS.openingWidth.min}
              max={length}
              onCommit={(width) =>
                updateOpening(wall.id, opening.id, { width })
              }
            />
            <NumberField
              label="Height"
              value={opening.height}
              min={LIMITS.openingHeight.min}
              max={wall.height}
              onCommit={(height) =>
                updateOpening(wall.id, opening.id, { height })
              }
            />
            <NumberField
              label="Sill height"
              value={opening.sill}
              min={0}
              max={wall.height}
              onCommit={(sill) => updateOpening(wall.id, opening.id, { sill })}
            />
            <NumberField
              label="Along wall"
              value={opening.position}
              min={0}
              max={length}
              onCommit={(position) =>
                updateOpening(wall.id, opening.id, { position })
              }
            />
            {opening.type === 'door' && (
              <SwingControls
                swing={opening.swing}
                onChange={(swing) =>
                  updateOpening(wall.id, opening.id, { swing })
                }
              />
            )}
            <p className="text-[11px] leading-relaxed text-slate-400">
              Sill 0 puts the opening on the floor. Values are clamped to fit
              the wall.
            </p>
          </section>
        ) : (
          <>
            <section className="space-y-3">
              <NumberField
                label="Height"
                value={wall.height}
                min={LIMITS.wallHeight.min}
                max={LIMITS.wallHeight.max}
                onCommit={(height) => updateWall(wall.id, { height })}
              />
              <NumberField
                label="Thickness"
                value={wall.thickness}
                min={LIMITS.wallThickness.min}
                max={LIMITS.wallThickness.max}
                step={0.05}
                onCommit={(thickness) => updateWall(wall.id, { thickness })}
              />
              <WallLengthField wallId={wall.id} metres={length} />
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Finish
              </h3>
              <MaterialPicker
                surface="wall"
                value={wall.material}
                onChange={(material) => updateWall(wall.id, { material })}
                testId="wall-material"
              />
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Openings ({wall.openings.length})
              </h3>

              {wall.openings.length === 0 ? (
                <p className="text-[11px] text-slate-400">
                  Use the Door or Window tool, then click this wall.
                </p>
              ) : (
                <ul className="space-y-1">
                  {wall.openings.map((o) => (
                    <li key={o.id}>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            select({
                              kind: 'opening',
                              wallId: wall.id,
                              openingId: o.id,
                            })
                          }
                          className="flex-1 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                        >
                          {OPENING_LABELS[o.type]}
                          <span className="ml-2 tabular-nums text-slate-400">
                            {o.width.toFixed(2)} × {o.height.toFixed(2)} m
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeOpening(wall.id, o.id)}
                          className="rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Delete ${o.type}`}
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <footer className="border-t border-slate-200 p-4">
        <button
          type="button"
          data-testid="delete-selected"
          onClick={() =>
            opening
              ? removeOpening(wall.id, opening.id)
              : removeWall(wall.id)
          }
          className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
        >
          Delete {opening ? opening.type : 'wall'}
        </button>
      </footer>
    </aside>
  )
}

const clampLength = (metres: number) =>
  Math.min(LIMITS.wallLength.max, Math.max(LIMITS.wallLength.min, metres))

/**
 * The wall's length, typed in whichever unit the user reads in.
 *
 * Unlike `NumberField` this accepts free text (`12'6"`, `12' 6`, `3.81m`, or a
 * bare number in the current unit), so it has to tell "half-typed" apart from
 * "not a length": an empty box waits quietly, anything else that fails to parse
 * is flagged and left alone until the field is left, at which point the real
 * value comes back. Resizing pivots on the wall's start point.
 */
function WallLengthField({
  wallId,
  metres,
}: {
  wallId: string
  metres: number
}) {
  const units = useDesignStore((s) => s.units)
  const setWallLength = useDesignStore((s) => s.setWallLength)
  const [text, setText] = useState(() => formatLength(metres, units))
  const [editing, setEditing] = useState(false)

  // Follow the model — another viewport may be dragging this very wall — but
  // never while the user is typing into the box.
  useEffect(() => {
    if (!editing) setText(formatLength(metres, units))
  }, [metres, units, editing])

  const typed = parseLength(text, units)
  const clamped = typed === null ? null : clampLength(typed)
  // A blank box, or a number stopped mid-decimal, is someone still typing —
  // flashing an error at `3.` on the way to `3.81` would be nagging.
  const partial = text.trim() === '' || text.trim().endsWith('.')
  const invalid = typed === null && !partial
  const clampNote =
    typed !== null && clamped !== null && clamped !== typed
      ? `Kept to ${formatLength(clamped, units)}`
      : null

  const handleChange = (next: string) => {
    setText(next)
    const parsed = parseLength(next, units)
    if (parsed !== null) setWallLength(wallId, clampLength(parsed))
  }

  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="text-slate-600">Length</span>
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          data-testid="wall-length-input"
          aria-invalid={invalid}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false)
            setText(formatLength(metres, units))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className={`w-28 rounded-md border bg-white px-2 py-1 text-right tabular-nums text-slate-900 outline-none focus:ring-1 ${
            invalid
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500'
          }`}
        />
      </label>
      {invalid && (
        <p
          className="text-right text-[11px] text-red-600"
          data-testid="wall-length-error"
        >
          {units === 'm' ? 'Try 3.81 m' : `Try 12'6"`}
        </p>
      )}
      {!invalid && clampNote && (
        <p className="text-right text-[11px] text-slate-400">{clampNote}</p>
      )}
    </div>
  )
}

/** Shared chrome so the three inspector variants look like one panel. */
function PanelShell({
  title,
  children,
  footer,
}: {
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const select = useDesignStore((s) => s.select)

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white"
      data-testid="inspector"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <button
          type="button"
          onClick={() => select(null)}
          className="text-xs text-slate-400 hover:text-slate-700"
          aria-label="Clear selection"
        >
          Done
        </button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">{children}</div>
      {footer && <footer className="border-t border-slate-200 p-4">{footer}</footer>}
    </aside>
  )
}

function FloorInspector() {
  const floorMaterial = useDesignStore((s) => s.floorMaterial)
  const setFloorMaterial = useDesignStore((s) => s.setFloorMaterial)

  return (
    <PanelShell title="Floor">
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Finish
        </h3>
        <MaterialPicker
          surface="floor"
          value={floorMaterial}
          onChange={setFloorMaterial}
          testId="floor-material"
        />
      </section>
      <p className="text-[11px] leading-relaxed text-slate-400">
        The floor is sized automatically from the walls, so it has no dimensions
        of its own.
      </p>
    </PanelShell>
  )
}

function FurnitureInspector({ furnitureId }: { furnitureId: string }) {
  const item = useDesignStore((s) => s.furniture.find((f) => f.id === furnitureId))
  const updateFurniture = useDesignStore((s) => s.updateFurniture)
  const removeFurniture = useDesignStore((s) => s.removeFurniture)

  if (!item) return null
  const def = getFurniture(item.type)
  const size = furnitureSize(item)
  const degrees = Math.round((item.rotation * 180) / Math.PI)

  return (
    <PanelShell
      title={def.label}
      footer={
        <button
          type="button"
          data-testid="delete-selected"
          onClick={() => removeFurniture(item.id)}
          className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
        >
          Delete {def.label.toLowerCase()}
        </button>
      }
    >
      <section className="space-y-3">
        <NumberField
          label="X"
          value={item.position.x}
          step={0.5}
          onCommit={(x) => updateFurniture(item.id, { position: { ...item.position, x } })}
        />
        <NumberField
          label="Z"
          value={item.position.z}
          step={0.5}
          onCommit={(z) => updateFurniture(item.id, { position: { ...item.position, z } })}
        />
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-600">Rotation</span>
          <div className="flex items-center gap-1.5">
            <span className="w-10 text-right tabular-nums text-slate-400">
              {((degrees % 360) + 360) % 360}°
            </span>
            <button
              type="button"
              data-testid="rotate-furniture"
              onClick={() =>
                updateFurniture(item.id, { rotation: item.rotation + Math.PI / 2 })
              }
              className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
            >
              Rotate 90°
            </button>
          </div>
        </div>
        <NumberField
          label="Width"
          value={size.width}
          min={LIMITS.furnitureSize.min}
          max={LIMITS.furnitureSize.max}
          step={0.1}
          onCommit={(width) => updateFurniture(item.id, { width })}
        />
        <NumberField
          label="Length"
          value={size.depth}
          min={LIMITS.furnitureSize.min}
          max={LIMITS.furnitureSize.max}
          step={0.1}
          onCommit={(depth) => updateFurniture(item.id, { depth })}
        />
      </section>
      <p className="text-[11px] leading-relaxed text-slate-400">
        Drag the piece in the plan view to move it, or set its width and length
        above.
      </p>
    </PanelShell>
  )
}

/**
 * A named space, or a spot waiting to be named: its area, and the name.
 *
 * Nothing here edits a room, because a room is not a thing that can be
 * edited — it is re-derived from the walls every render. What is edited is the
 * `RoomLabel`, and the label is reached by ID. Everything the caller passes in
 * is one of two things: a `roomId` naming a label that exists, or an `anchor`
 * naming a spot that has no label yet.
 *
 * The label is NOT recovered by comparing anchors. It used to be, by float
 * equality on both coordinates, and that only matched selections the schedule
 * panel had made — a plan click carried the click point, missed, and fell back
 * to the enclosure's primary, so renaming an open-plan zone rewrote the wrong
 * name. `rooms/identity.test.tsx` holds that shut.
 */
function RoomInspector({ roomId, anchor }: { roomId?: RoomId; anchor?: Point }) {
  const walls = useDesignStore((s) => s.walls)
  const roomLabels = useDesignStore((s) => s.roomLabels)
  const units = useDesignStore((s) => s.units)
  const nameRoom = useDesignStore((s) => s.nameRoom)
  const select = useDesignStore((s) => s.select)
  const updateRoomLabel = useDesignStore((s) => s.updateRoomLabel)
  const removeRoomLabel = useDesignStore((s) => s.removeRoomLabel)

  // Walks the whole wall graph, so it must not re-run on unrelated state.
  const rooms = useMemo(
    () => resolveRooms(walls, roomLabels),
    [walls, roomLabels],
  )

  const label = roomId ? (roomLabels.find((l) => l.id === roomId) ?? null) : null
  const room = label
    ? roomAtPoint(rooms, label.anchor)
    : anchor
      ? roomAtPoint(rooms, anchor)
      : null

  const setType = (type: RoomType) => {
    if (label) {
      updateRoomLabel(label.id, { type })
      return
    }
    // Naming a bare spot promotes the selection onto the label it just made.
    // Without this the inspector would still be pointing at a point, and the
    // next category click would mint a SECOND label in the same space.
    if (anchor) {
      select({
        kind: 'room',
        roomId: nameRoom(anchor, type, provenance.manual()),
      })
    }
  }

  const clearName = label ? () => removeRoomLabel(label.id) : undefined

  // A name whose walls have opened. It is kept, not dropped (see
  // `detachedLabels`), so this panel has to be a working editor rather than a
  // dead end — the user can still rename it, recategorise it, or delete it
  // deliberately, and it comes back on its own when the loop closes.
  if (!room && label) {
    return (
      <PanelShell title={roomDisplayName(label)} footer={<ClearName onClick={clearName} />}>
        <div className="space-y-5" data-testid="room-inspector">
          <p
            className="rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700"
            data-testid="room-detached"
          >
            {roomDisplayName(label)} is not inside an enclosed space right now —
            a wall moved past it, or the loop is open. Close the walls around it
            and it comes back with its area.
          </p>
          <RoomNameEditor
            label={label}
            onName={(name) => updateRoomLabel(label.id, { name })}
            onType={setType}
          />
        </div>
      </PanelShell>
    )
  }

  if (!room) {
    return (
      <PanelShell title="Room">
        <p
          className="text-[11px] leading-relaxed text-slate-400"
          data-testid="room-inspector"
        >
          This spot is not inside an enclosed space any more — a wall moved
          past it, or the loop is open. Close the walls around it, or click
          inside a room to name that one.
        </p>
      </PanelShell>
    )
  }

  // A merged room keeps its first name and silently drops the others; saying
  // how many are waiting is the only clue that re-drawing the wall gets the
  // other name back.
  const shadowed = roomLabels.filter(
    (other) => other.id !== label?.id && roomAtPoint(rooms, other.anchor) === room,
  ).length

  return (
    <PanelShell
      title={label ? roomDisplayName(label) : 'Room'}
      footer={<ClearName onClick={clearName} />}
    >
      <div className="space-y-5" data-testid="room-inspector">
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Area
          </h3>
          <p
            className="text-2xl font-semibold tabular-nums text-slate-900"
            data-testid="room-area"
          >
            {formatArea(room.area, units)}
          </p>
          <p className="text-[11px] tabular-nums text-slate-400">
            {formatArea(room.area, units === 'ftin' ? 'm' : 'ftin')}
          </p>
        </section>

        {/* The plain "how big is this room" — width across × length down, the
            same order a blueprint writes it, so nobody has to add up the
            per-wall dimension segments to work it out. */}
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Width × Length
          </h3>
          {(() => {
            const size = roomSize(room.polygon)
            return (
              <p
                className="text-lg font-semibold tabular-nums text-slate-900"
                data-testid="room-size"
              >
                {formatLength(size.width, units)} ×{' '}
                {formatLength(size.length, units)}
              </p>
            )
          })()}
          <p className="text-[11px] leading-relaxed text-slate-400">
            Width across × length down, wall to wall — as on a plan.
          </p>
        </section>

        <RoomNameEditor
          label={label}
          onName={(name) => label && updateRoomLabel(label.id, { name })}
          onType={setType}
        />

        {shadowed > 0 && (
          <p
            className="text-[11px] leading-relaxed text-amber-600"
            data-testid="room-shadowed-names"
          >
            Hidden here: {shadowed} other name
            {shadowed === 1 ? '' : 's'} pinned inside this space. Split it
            with a wall to see {shadowed === 1 ? 'it' : 'them'} again.
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-slate-400">
          Areas are measured to the wall centrelines and follow the walls as
          you edit.
        </p>
      </div>
    </PanelShell>
  )
}

/**
 * The room's delete control, or nothing when there is no name to delete.
 *
 * Shared by the resolved and the detached panels, because a detached name is
 * exactly the one a user is most likely to want rid of.
 */
function ClearName({ onClick }: { onClick?: () => void }) {
  if (!onClick) return null
  return (
    <button
      type="button"
      data-testid="room-clear-name"
      onClick={onClick}
      className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
    >
      Clear name
    </button>
  )
}

/**
 * Free-text name plus the category grid — the whole naming surface.
 *
 * Extracted so the detached panel is the SAME editor rather than a read-only
 * apology. `label` is null only when naming a space that has none yet, which
 * is why the text field hides but the categories do not: picking a category is
 * how a name gets created in the first place.
 */
function RoomNameEditor({
  label,
  onName,
  onType,
}: {
  label: RoomLabel | null
  onName: (name: string) => void
  onType: (type: RoomType) => void
}) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label ? 'Name' : 'Name this space'}
      </h3>

      {/* Free-text label, once the space has a type. It overrides the caption
          everywhere; clearing it falls back to the type's name. The category
          buttons below still set the zone colour. */}
      {label && (
        <div className="mb-3">
          <input
            type="text"
            value={label.name ?? ''}
            onChange={(e) => onName(e.target.value)}
            placeholder={getRoomType(label.type).label}
            maxLength={40}
            data-testid="room-custom-name"
            className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Type your own label, or pick a category below.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {ROOM_TYPES.map((type) => {
          const active = type.id === label?.type
          return (
            <button
              key={type.id}
              type="button"
              onClick={() => onType(type.id)}
              aria-pressed={active}
              data-testid={`room-type-${type.id}`}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
                active
                  ? 'border-blue-500 bg-blue-50 text-slate-900 ring-1 ring-blue-500'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {/* The plan's own fill, so the picker previews the zone colours
                  rather than inventing a second palette. */}
              <span
                className="h-5 w-5 shrink-0 rounded border border-black/10"
                style={{ backgroundColor: type.tint }}
                aria-hidden
              />
              <span className="truncate">{type.label}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/**
 * What a flight of `run` metres actually works out to, step by step.
 *
 * The rise is fixed — it is the floor-to-floor height — so the ideal 170 mm
 * riser is only a starting point: the count has to be a whole number, and the
 * true riser falls out of the rounding. A straight flight has one fewer tread
 * than riser, because the top riser arrives at the floor above rather than at
 * another tread, so the run is shared between `risers - 1` goings.
 */
function flightSteps(run: number) {
  const risers = Math.max(
    2,
    Math.round(FLOOR_HEIGHT / STAIR_DEFAULTS.riserHeight),
  )
  const treads = risers - 1
  return { risers, treads, riser: FLOOR_HEIGHT / risers, going: run / treads }
}

/**
 * Rough domestic comfort, in metres — not a building code.
 *
 * Nothing here is enforced; the panel only says which way a flight is
 * uncomfortable and by how much, and leaves the decision to the architect.
 */
const COMFORT = {
  riser: { min: 0.15, max: 0.19 },
  going: { min: 0.25, max: 0.35 },
}

/** Steps are small, so they want more precision than a wall length does. */
const stepLength = (metres: number, units: Unit) =>
  formatLength(metres, units, { decimals: 3, fraction: 8 })

const QUARTER_TURNS = [0, 90, 180, 270]

/** One label-and-figure row, the shape the plot panel uses for its numbers. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-baseline justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium tabular-nums text-slate-800">{value}</span>
    </p>
  )
}

/**
 * A staircase: how wide and how long it is, which way it climbs, and the step
 * geometry that follows from those.
 *
 * The step figures are the point of the panel. Width and run are drawn as a
 * box on the plan and look fine at any size, but they decide a riser and a
 * going that someone has to climb every day, and those are the numbers that
 * say whether the flight is a stair or a ladder.
 */
function StairInspector({ stairId }: { stairId: string }) {
  const stair = useDesignStore((s) => s.stairs.find((x) => x.id === stairId))
  const units = useDesignStore((s) => s.units)
  const updateStair = useDesignStore((s) => s.updateStair)
  const removeStair = useDesignStore((s) => s.removeStair)

  if (!stair) return null

  const step = flightSteps(stair.run)
  const turned = Math.round((stair.rotation * 180) / Math.PI)
  const degrees = ((turned % 360) + 360) % 360

  const notes: string[] = []
  if (step.going < COMFORT.going.min) {
    notes.push(
      `A ${stepLength(step.going, units)} going is too shallow to take a` +
        ` whole foot. ${stepLength(COMFORT.going.min * step.treads, units)}` +
        ' of run would give a comfortable one.',
    )
  } else if (step.going > COMFORT.going.max) {
    notes.push(
      `A ${stepLength(step.going, units)} going breaks stride — the flight` +
        ' is longer than it needs to be.',
    )
  }
  if (step.riser > COMFORT.riser.max) {
    notes.push(
      `Each step rises ${stepLength(step.riser, units)}, which is steep for` +
        ' a house.',
    )
  } else if (step.riser < COMFORT.riser.min) {
    notes.push(
      `Each step rises only ${stepLength(step.riser, units)}, shallow enough` +
        ' to trip on.',
    )
  }

  return (
    <PanelShell
      title="Stair"
      footer={
        <button
          type="button"
          data-testid="stair-delete"
          onClick={() => removeStair(stair.id)}
          className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100"
        >
          Delete stair
        </button>
      }
    >
      <div className="space-y-5" data-testid="stair-inspector">
        {/* A stair sits in the room, not on a wall, so it is moved by its X/Z
            like furniture. Without these the only way to move it was to drag on
            the 2D plan — leaving it stuck in place in the 3D view. */}
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Position
          </h3>
          <div className="space-y-3">
            <NumberField
              label="X"
              value={stair.position.x}
              step={0.5}
              onCommit={(x) =>
                updateStair(stair.id, { position: { ...stair.position, x } })
              }
            />
            <NumberField
              label="Z"
              value={stair.position.z}
              step={0.5}
              onCommit={(z) =>
                updateStair(stair.id, { position: { ...stair.position, z } })
              }
            />
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Flight
          </h3>
          <LengthField
            label="Width"
            metres={stair.width}
            units={units}
            testId="stair-width"
            onCommit={(width) => updateStair(stair.id, { width })}
          />
          <LengthField
            label="Run"
            metres={stair.run}
            units={units}
            testId="stair-run"
            onCommit={(run) => updateStair(stair.id, { run })}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            The run is the length the flight covers on the plan. Widths
            outside {formatLength(0.6, units)}–{formatLength(4, units)}, and
            runs outside {formatLength(1, units)}–{formatLength(12, units)},
            come back trimmed to fit.
          </p>
        </section>

        <section data-testid="stair-rotation">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Direction
          </h3>
          <div className="grid grid-cols-4 gap-1.5">
            {QUARTER_TURNS.map((turn) => {
              const active = degrees === turn
              return (
                <button
                  key={turn}
                  type="button"
                  aria-pressed={active}
                  data-testid={`stair-rotation-${turn}`}
                  onClick={() =>
                    updateStair(stair.id, {
                      rotation: (turn * Math.PI) / 180,
                    })
                  }
                  className={`rounded-md border px-2 py-1.5 text-[11px] tabular-nums transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-50 text-slate-900 ring-1 ring-blue-500'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {turn}°
                </button>
              )
            })}
          </div>
          <div className="mt-2">
            <NumberField
              label="Angle"
              value={degrees}
              min={0}
              max={360}
              step={5}
              unit="°"
              onCommit={(value) =>
                updateStair(stair.id, { rotation: (value * Math.PI) / 180 })
              }
            />
          </div>
        </section>

        <section className="space-y-1">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Steps
          </h3>
          <Figure
            label="Rise to next floor"
            value={stepLength(FLOOR_HEIGHT, units)}
          />
          <Figure label="Risers" value={`${step.risers}`} />
          <Figure label="Riser height" value={stepLength(step.riser, units)} />
          <Figure label="Treads" value={`${step.treads}`} />
          <Figure label="Going" value={stepLength(step.going, units)} />
        </section>

        {notes.length > 0 && (
          <div
            className="space-y-1.5 rounded-md bg-amber-50 p-2.5"
            data-testid="stair-comfort"
          >
            {notes.map((note) => (
              <p key={note} className="text-[11px] leading-relaxed text-amber-700">
                {note}
              </p>
            ))}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-slate-400">
          The riser count is whatever divides the floor-to-floor height
          closest to {stepLength(STAIR_DEFAULTS.riserHeight, units)}, so only
          the run and the width are yours to set. Drag the flight in the plan
          view to move it.
        </p>
      </div>
    </PanelShell>
  )
}
