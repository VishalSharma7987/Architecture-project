import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  buildAreaStatement,
  formatRupees,
  formatRupeesApprox,
} from '../export/statement'
import type { AreaStatement } from '../export/statement'
import { roomDisplayName } from '../rooms/catalog'
import { resolveRooms, roomAtPoint, totalBuiltUpArea } from '../rooms/resolve'
import type { ResolvedRoom } from '../rooms/resolve'
import type { Point } from '../store/useDesignStore'
import { allFloors, useDesignStore } from '../store/useDesignStore'
import { formatArea, formatLength } from '../units/length'
import { planBounds } from '../scene/wallGeometry'

/** Whole square feet, grouped Indian style — the unit a rate is quoted in. */
const SQ_FT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/**
 * Left-docked schedule of every enclosed space and its area.
 *
 * The list is derived from the walls on every render, so areas move as the
 * plan is edited — there is no stored room to go stale. Rows are ordered
 * largest first, which keeps a row in roughly the same place while a wall is
 * being dragged instead of reshuffling under the pointer.
 *
 * The schedule and its total are the OPEN storey. The cost estimate below it
 * is the whole building, because that is the figure a rate is quoted against;
 * both are labelled with their scope so the two areas on screen cannot be read
 * as contradicting each other.
 */
export function RoomSchedulePanel() {
  const walls = useDesignStore((s) => s.walls)
  const roomLabels = useDesignStore((s) => s.roomLabels)
  const units = useDesignStore((s) => s.units)
  const selection = useDesignStore((s) => s.selection)
  const open = useDesignStore((s) => s.roomPanelOpen)
  const setRoomPanelOpen = useDesignStore((s) => s.setRoomPanelOpen)
  const select = useDesignStore((s) => s.select)
  const floors = useDesignStore((s) => s.floors)
  const activeFloor = useDesignStore((s) => s.activeFloor)
  const plot = useDesignStore((s) => s.plot)
  const northOffset = useDesignStore((s) => s.northOffset)
  const plotFacing = useDesignStore((s) => s.plotFacing)
  const rate = useDesignStore((s) => s.constructionRate)
  const setConstructionRate = useDesignStore((s) => s.setConstructionRate)

  // Walks the whole wall graph, so it must not re-run on unrelated state.
  // Detection already returns largest first; sorting again pins the order to
  // this panel rather than to an implementation detail of the detector.
  const rooms = useMemo(
    // Copy before sorting. `resolveRooms` is memoised and hands the SAME array
    // to every consumer, so an in-place sort here would reorder what the plan
    // canvas, the inspector and the Vastu panel are reading. Harmless when each
    // caller owned its own array; not any more.
    () => [...resolveRooms(walls, roomLabels)].sort((a, b) => b.area - a.area),
    [walls, roomLabels],
  )

  // Resolves the rooms on EVERY storey, so it is memoised on exactly what the
  // measurement reads. Furniture and stairs are carried through untouched by
  // `buildAreaStatement`, so they are read off the store rather than
  // subscribed to — a chair being dragged must not re-detect the whole
  // building. Nothing observable can go stale because nothing reads them.
  const statement = useMemo(() => {
    const { furniture, stairs } = useDesignStore.getState()
    return buildAreaStatement({
      // The panel prints neither; the sheet and the CSV supply their own.
      projectName: null,
      date: '',
      floors: allFloors({
        floors,
        activeFloor,
        walls,
        furniture,
        roomLabels,
        stairs,
      }),
      plot,
      northOffset,
      plotFacing,
      constructionRate: rate,
    })
  }, [
    floors,
    activeFloor,
    walls,
    roomLabels,
    plot,
    northOffset,
    plotFacing,
    rate,
  ])

  const floorName = floors[activeFloor]?.name ?? 'this floor'

  if (!open) return null

  const selected =
    selection?.kind === 'room' ? roomAtPoint(rooms, selection.anchor) : null
  const selectedAnchor = selection?.kind === 'room' ? selection.anchor : null
  // One space can now list several rows — the primary name with its area, and
  // an open plan's extra zone names beneath it. This is the single anchor whose
  // row reads as selected: the one the selection points at, or the primary row
  // when the click landed elsewhere inside the space.
  const currentAnchor = currentRowAnchor(selected, selectedAnchor)
  const total = totalBuiltUpArea(rooms)
  // The whole floor's footprint, in plan orientation — width across (X), length
  // down (Z) — so it reads like the overall dimension on a blueprint.
  const bounds = planBounds(walls)

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white"
      data-testid="room-panel"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Room schedule</h2>
        <button
          type="button"
          onClick={() => setRoomPanelOpen(false)}
          className="text-xs text-slate-400 hover:text-slate-700"
          aria-label="Close room schedule"
        >
          Close
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {rooms.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-slate-400">
            No enclosed spaces on {floorName} yet. Close a loop of walls and
            its area appears here.
          </p>
        ) : (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Spaces on {floorName} ({rooms.length})
            </h3>
            <ul className="space-y-1">
              {rooms.map((room, index) => {
                const primaryAnchor = room.label?.anchor ?? room.centroid
                return (
                  <Fragment key={roomKey(room, index)}>
                    <li>
                      <button
                        type="button"
                        onClick={() =>
                          select({ kind: 'room', anchor: primaryAnchor })
                        }
                        data-testid={`room-row-${index}`}
                        aria-current={primaryAnchor === currentAnchor}
                        className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                          primaryAnchor === currentAnchor
                            ? 'border-blue-500 bg-blue-50 text-slate-900 ring-1 ring-blue-500'
                            : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`truncate ${
                            room.label ? 'font-medium' : 'italic text-slate-400'
                          }`}
                        >
                          {room.label ? roomDisplayName(room.label) : 'Unnamed'}
                        </span>
                        <span className="shrink-0 tabular-nums text-[11px] text-slate-500">
                          {formatArea(room.area, units)}
                        </span>
                      </button>
                    </li>
                    {/* Open-plan zones sharing this enclosure: named, but their
                        area lives on the primary row above, so the built-up
                        total counts the space once. Indented to read as its
                        children. */}
                    {room.extraLabels.map((extra) => (
                      <li key={extra.id} className="pl-3">
                        <button
                          type="button"
                          onClick={() =>
                            select({ kind: 'room', anchor: extra.anchor })
                          }
                          aria-current={extra.anchor === currentAnchor}
                          className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                            extra.anchor === currentAnchor
                              ? 'border-blue-500 bg-blue-50 text-slate-900 ring-1 ring-blue-500'
                              : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <span className="truncate font-medium">
                            {roomDisplayName(extra)}
                          </span>
                          <span className="shrink-0 text-[11px] italic text-slate-400">
                            open plan
                          </span>
                        </button>
                      </li>
                    ))}
                  </Fragment>
                )
              })}
            </ul>
            <p className="mt-2 text-[11px] text-slate-400">
              Click a row to select the space, then name it in the panel on
              the right.
            </p>
          </section>
        )}

        {statement.floors.length > 0 && (
          <CostSection
            statement={statement}
            rate={rate}
            floorName={floorName}
            onRateChange={setConstructionRate}
          />
        )}
      </div>

      {rooms.length > 0 && (
        <footer className="border-t border-slate-200 p-4">
          {bounds && (
            <div className="mb-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Floor size · {floorName}
              </h3>
              <p
                className="mt-1 text-lg font-semibold tabular-nums text-slate-900"
                data-testid="floor-size"
              >
                {formatLength(bounds.width, units)} ×{' '}
                {formatLength(bounds.depth, units)}
              </p>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Width across × length down, the overall footprint.
              </p>
            </div>
          )}

          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Built-up area · {floorName}
          </h3>
          <p
            className="mt-1 text-lg font-semibold tabular-nums text-slate-900"
            data-testid="room-total-area"
          >
            {formatArea(total, units)}
          </p>
          <p className="text-[11px] tabular-nums text-slate-400">
            {formatArea(total, units === 'ftin' ? 'm' : 'ftin')}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Measured to the wall centrelines, so shared partitions are
            counted once.
          </p>
        </footer>
      )}
    </aside>
  )
}

/**
 * Keyed by the name when there is one, so React keeps a named row's DOM node
 * as the plan is edited and the ordering shifts underneath it.
 */
const roomKey = (room: ResolvedRoom, index: number) =>
  room.label ? room.label.id : `unnamed-${index}`

/**
 * Which of a space's rows should read as selected — returned by reference, so
 * a row highlights when its own anchor is the answer.
 *
 * A space that lists open-plan zones has several rows; the selection points at
 * one anchor. That anchor's row wins when it is one of them, and the primary
 * row wins otherwise — a plan click lands anywhere inside the space, not on a
 * particular zone's anchor, and the space still needs to read as chosen.
 */
function currentRowAnchor(
  room: ResolvedRoom | null,
  selectedAnchor: Point | null,
): Point | null {
  if (!room) return null

  const primaryAnchor = room.label?.anchor ?? room.centroid
  if (!selectedAnchor) return primaryAnchor

  const anchors = [primaryAnchor, ...room.extraLabels.map((e) => e.anchor)]
  return (
    anchors.find(
      (a) => a.x === selectedAnchor.x && a.z === selectedAnchor.z,
    ) ?? primaryAnchor
  )
}

type CostSectionProps = {
  statement: AreaStatement
  rate: number
  /** The storey the schedule above is showing, named so the scopes differ. */
  floorName: string
  onRateChange: (rupeesPerSqFt: number) => void
}

/**
 * The construction rate and what it comes to across the building.
 *
 * Every figure here spans all measured storeys, which is why the heading and
 * the line under it say so: the total above this section is one floor, and two
 * different areas on one panel need their scopes spelled out or they read as a
 * mistake. Storeys with nothing enclosed are absent from the statement, so the
 * breakdown never lists a floor at zero.
 */
function CostSection({
  statement,
  rate,
  floorName,
  onRateChange,
}: CostSectionProps) {
  const { cost } = statement
  const approx = cost ? formatRupeesApprox(cost.total) : null
  const storeys = statement.floors.length

  return (
    <section
      data-testid="cost-estimate"
      className="border-t border-slate-200 pt-4"
    >
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Cost estimate · whole building
      </h3>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
        {SQ_FT.format(statement.totalBuiltUpSqFt)} sq ft across{' '}
        {storeys === 1 ? '1 storey' : `${storeys} storeys`}. The schedule
        above is {floorName} only, so this figure does not change when you
        switch floors.
      </p>

      <RateInput rate={rate} onChange={onRateChange} />

      {cost === null ? (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Enter a rate above to estimate the cost. Builders in most Indian
          cities quote a per-square-foot figure for the finished shell.
        </p>
      ) : (
        <>
          <p
            className="mt-3 text-lg font-semibold tabular-nums text-slate-900"
            data-testid="cost-total"
          >
            {formatRupees(cost.total)}
          </p>
          {approx && (
            <p className="text-[11px] tabular-nums text-slate-400">{approx}</p>
          )}
        </>
      )}

      {/* Listed with or without a rate, so the storeys the total covers are
          on screen before anyone types a number into the box. */}
      <ul className="mt-3 space-y-1 border-t border-slate-200 pt-2">
        {statement.floors.map((floor, index) => (
          <li
            key={`${floor.name}-${index}`}
            className="flex items-baseline gap-2 text-[11px]"
          >
            <span className="flex-1 truncate text-slate-600">
              {floor.name}
            </span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {SQ_FT.format(floor.builtUpSqFt)} sq ft
            </span>
            {floor.cost !== null && (
              <span className="w-20 shrink-0 text-right tabular-nums text-slate-700">
                {formatRupees(floor.cost)}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Indicative only — built-up area × rate, measured to wall centrelines.
        Not a quotation.
      </p>
    </section>
  )
}

type RateInputProps = {
  rate: number
  onChange: (rupeesPerSqFt: number) => void
}

/**
 * The construction rate, in rupees per square foot.
 *
 * Empty rather than `0` when nothing is set: the store reads 0 as "no rate",
 * and a 0 sitting in the box would invite the reader to treat it as a quoted
 * one. The field keeps its own text while focused so that clearing it to type
 * a new number does not clamp under the user's fingers — and clearing it drops
 * the estimate rather than leaving yesterday's total on screen.
 */
function RateInput({ rate, onChange }: RateInputProps) {
  const [text, setText] = useState(rate > 0 ? String(rate) : '')
  const [editing, setEditing] = useState(false)

  // Follow the store when it changes underneath us — a loaded project, a
  // shared link — but never while the user is mid-edit.
  useEffect(() => {
    if (!editing) setText(rate > 0 ? String(rate) : '')
  }, [rate, editing])

  const handleChange = (next: string) => {
    setText(next)
    const parsed = Number.parseFloat(next)
    onChange(Number.isFinite(parsed) ? parsed : 0)
  }

  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="text-slate-600">Rate</span>
      <span className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
          ₹
        </span>
        <input
          type="number"
          min={0}
          step={50}
          inputMode="numeric"
          value={text}
          placeholder="1800"
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false)
            setText(rate > 0 ? String(rate) : '')
          }}
          aria-label="Construction rate in rupees per square foot"
          data-testid="construction-rate"
          className="w-32 rounded-md border border-slate-300 bg-white py-1 pl-5 pr-12 text-right tabular-nums text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
          /sq ft
        </span>
      </span>
    </label>
  )
}
