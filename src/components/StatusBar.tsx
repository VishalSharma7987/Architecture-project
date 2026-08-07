import { useMemo } from 'react'
import { totalFloorArea } from '../plan/rooms'
import { useDesignStore } from '../store/useDesignStore'
import { formatArea } from '../units/length'

/**
 * Bottom chrome: how much floor the plan encloses, and how many walls draw it.
 *
 * Both unit systems are shown at once whichever one is selected — a plan is
 * usually read by someone who thinks in the other — with the selected one
 * leading.
 */
export function StatusBar() {
  const walls = useDesignStore((s) => s.walls)
  const units = useDesignStore((s) => s.units)

  // totalFloorArea walks the whole wall graph, and the store is written on
  // every pointer move while drawing, so this hangs off the walls array alone.
  const area = useMemo(() => totalFloorArea(walls), [walls])

  const other = units === 'ftin' ? 'm' : 'ftin'
  const wallCount = walls.length

  return (
    <footer
      className="flex h-7 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 text-xs text-slate-500"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-2">
        <span className="text-slate-400">Floor area</span>
        {area > 0 ? (
          // Rooms are measured on wall centrelines, so the figure runs a little
          // over the usable floor. Said out loud rather than hidden.
          <span
            className="tabular-nums"
            title="Measured to wall centrelines"
            data-testid="floor-area"
          >
            <span className="font-semibold text-slate-800">
              {formatArea(area, units)}
            </span>{' '}
            <span className="text-slate-400">({formatArea(area, other)})</span>
          </span>
        ) : (
          <span
            className="text-slate-400"
            title="Close a loop of walls and the area appears here"
            data-testid="floor-area"
          >
            No enclosed area yet
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <AutosaveIndicator />
        <span className="tabular-nums" data-testid="status-wall-count">
          {wallCount} {wallCount === 1 ? 'wall' : 'walls'}
        </span>
      </div>
    </footer>
  )
}

/**
 * What autosave last did.
 *
 * Silent on the happy path — a permanent "Saved" badge is noise, and the
 * absence of a warning is the signal. Loud when it has stopped working: a
 * failed write used to retry every four seconds with no indication at all,
 * so the user kept working in the belief that closing the tab was safe.
 */
function AutosaveIndicator() {
  const autosave = useDesignStore((s) => s.autosave)

  if (autosave.kind === 'idle' || autosave.kind === 'saved') return null

  const message =
    autosave.kind === 'failed'
      ? `Not saving — ${autosave.message} Export to keep this work.`
      : 'This design is open in another tab. Whichever saves last wins — ' +
        'close one, or export from this one.'

  return (
    <span
      role="status"
      title={message}
      data-testid={`autosave-${autosave.kind}`}
      className="max-w-md truncate rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700"
    >
      {message}
    </span>
  )
}
