import { useEffect, useMemo, useState } from 'react'
import { totalFloorArea } from '../plan/rooms'
import { findLooseJoints } from '../plan/repairJoints'
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
        <LooseJointsIndicator />
        <span className="tabular-nums" data-testid="status-wall-count">
          {wallCount} {wallCount === 1 ? 'wall' : 'walls'}
        </span>
      </div>
    </footer>
  )
}

/**
 * Wall joints that look connected and are not, with the offer to close them.
 *
 * ── Why it lives HERE and not in the toolbar ──
 * The status bar already reports derived model state — the floor area and the
 * wall count — and an unconnected joint is the same class of fact. It also
 * sits inches from the number it explains: a plan reading 176 sq ft when it
 * should read 864 does so BECAUSE of these, and putting cause beside symptom
 * is most of the explanation. The toolbar is seven tools wide and its own
 * comments record an overflow that made Blueprint unreachable.
 *
 * It renders nothing when there is nothing to repair, so a healthy plan pays
 * no attention for it.
 */
function LooseJointsIndicator() {
  const walls = useDesignStore((s) => s.walls)
  const readOnly = useDesignStore((s) => s.readOnly)
  const repairJoints = useDesignStore((s) => s.repairJoints)
  const [outcome, setOutcome] = useState<string | null>(null)

  // Same call the canvas paints from, so the count and the markers can never
  // disagree about what is loose.
  const loose = useMemo(() => findLooseJoints(walls), [walls])

  // A new edit supersedes whatever the last repair reported.
  useEffect(() => setOutcome(null), [walls])

  if (readOnly) return null
  if (loose.length === 0) {
    return outcome ? (
      <span role="status" className="text-slate-400" data-testid="joints-outcome">
        {outcome}
      </span>
    ) : null
  }

  const run = () => {
    const moved = repairJoints()
    // Never silently nothing: a button that appears to do nothing is worse
    // than no button. The zero case is reachable if the walls changed between
    // this render and the click.
    setOutcome(moved > 0 ? `Connected ${moved}.` : 'Nothing to connect.')
  }

  return (
    <button
      type="button"
      onClick={run}
      data-testid="repair-joints"
      title={
        `${loose.length} wall end${loose.length === 1 ? '' : 's'} sit close to ` +
        'another wall without being joined to it, so the spaces they should ' +
        'enclose are not counted. They are ringed on the plan. Connecting ' +
        'them moves only those ends, as one undo step.'
      }
      className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700 transition-colors hover:bg-amber-100"
    >
      {loose.length} unjoined {loose.length === 1 ? 'end' : 'ends'} — connect
    </button>
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
      : autosave.kind === 'held-back'
        ? 'The last session did not finish opening, so your draft was left ' +
          'closed rather than reopened into the same crash. It is still saved — ' +
          'reload to try it again.'
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
