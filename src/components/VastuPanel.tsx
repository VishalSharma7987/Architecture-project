import { useMemo } from 'react'
import type { RoomVerdict, VastuStatus } from '../vastu/analyse'
import type { ResolvedRoom } from '../rooms/resolve'
import { analyseVastu } from '../vastu/analyse'
import { getRoomType } from '../rooms/catalog'
import { resolveRooms, roomAtPoint } from '../rooms/resolve'
import { useDesignStore } from '../store/useDesignStore'
import { zoneLabel } from '../vastu/ruleset'

/**
 * How each status reads in the list.
 *
 * `word` and `mark` exist so the reading survives a greyscale print and a
 * colour-blind reader — the colour is never the only carrier. `okay` covers
 * both "the table allows it" and "the table is silent", which is why the word
 * is about ranking rather than approval; the sentence underneath says which.
 */
const STATUS: Record<
  VastuStatus,
  { word: string; mark: string; chip: string }
> = {
  good: {
    word: 'Preferred',
    mark: '✓',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  okay: {
    word: 'Not first choice',
    mark: '~',
    chip: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  avoid: {
    word: 'On avoid list',
    mark: '!',
    chip: 'border-red-200 bg-red-50 text-red-700',
  },
  'no-rule': {
    word: 'No rule',
    mark: '–',
    chip: 'border-slate-200 bg-slate-50 text-slate-500',
  },
}

/** Under this share of its own area, a room straddles zones and is hedged. */
const UNCERTAIN_COVERAGE = 0.6

/**
 * Left-docked reading of the plan against the Vastu ruleset.
 *
 * The panel reports and never instructs: a room in a zone the table names as
 * one to avoid is shown as exactly that, and where the table is silent the row
 * says so. Nothing here changes the design — the architect and the client
 * decide what, if anything, to act on.
 */
export function VastuPanel() {
  const walls = useDesignStore((s) => s.walls)
  const roomLabels = useDesignStore((s) => s.roomLabels)
  const northOffset = useDesignStore((s) => s.northOffset)
  const plotFacing = useDesignStore((s) => s.plotFacing)
  const selection = useDesignStore((s) => s.selection)
  const open = useDesignStore((s) => s.vastuPanelOpen)
  const setVastuPanelOpen = useDesignStore((s) => s.setVastuPanelOpen)
  const vastuGrid = useDesignStore((s) => s.vastuGrid)
  const setVastuGrid = useDesignStore((s) => s.setVastuGrid)
  const select = useDesignStore((s) => s.select)

  // Every room polygon is clipped against all nine cells, so this must not run
  // again for a camera move or a furniture drag. Largest first pins the row
  // order to this panel rather than to the detector.
  const report = useMemo(() => {
    // Copy before sorting — the memoised result is shared with every other
    // consumer, and `Array.prototype.sort` mutates in place.
    const rooms = [...resolveRooms(walls, roomLabels)].sort(
      (a, b) => b.area - a.area,
    )
    return analyseVastu(rooms, walls, northOffset, plotFacing)
  }, [walls, roomLabels, northOffset, plotFacing])

  if (!open) return null

  const rooms = report.rooms.map((verdict) => verdict.room)
  const selected =
    selection?.kind === 'room' ? roomAtPoint(rooms, selection.anchor) : null
  const scored = report.counts.good + report.counts.okay + report.counts.avoid

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white"
      data-testid="vastu-panel"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Vastu report</h2>
        <button
          type="button"
          onClick={() => setVastuPanelOpen(false)}
          className="text-xs text-slate-400 hover:text-slate-700"
          aria-label="Close Vastu report"
        >
          Close
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Score
          </h3>
          {report.score === null ? (
            <p
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600"
              data-testid="vastu-no-score"
            >
              {rooms.length === 0
                ? 'Nothing to read yet. Close a loop of walls to make a ' +
                  'space, then name it to check it against this ruleset.'
                : 'No named room this ruleset has a rule for, so there is ' +
                  'nothing to average. Select a space on the plan and name ' +
                  'it to start the report.'}
            </p>
          ) : (
            <>
              <p className="flex items-baseline gap-1">
                <span
                  className="text-3xl font-semibold tabular-nums text-slate-900"
                  data-testid="vastu-score"
                >
                  {report.score}
                </span>
                <span className="text-sm text-slate-400">/ 100</span>
              </p>
              <ul className="mt-2 flex flex-wrap gap-1">
                <CountChip status="good" count={report.counts.good} />
                <CountChip status="okay" count={report.counts.okay} />
                <CountChip status="avoid" count={report.counts.avoid} />
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Averaged over the {scored} room{scored === 1 ? '' : 's'} this
                ruleset has a rule for — preferred counts full, not-first-choice
                counts half
                {report.brahmasthan.clear
                  ? ''
                  : ', less a deduction for the occupied centre'}
                .
                {report.counts.noRule > 0 &&
                  ` ${report.counts.noRule} other space` +
                    `${report.counts.noRule === 1 ? '' : 's'} ` +
                    'take no part in it.'}
              </p>
            </>
          )}
        </section>

        <section className="border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => setVastuGrid(!vastuGrid)}
            aria-pressed={vastuGrid}
            data-testid="vastu-grid-toggle"
            className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              vastuGrid
                ? 'bg-slate-900 text-white hover:bg-slate-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {vastuGrid ? 'Hide zone grid' : 'Show zone grid'}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Draws the nine zones over the plan, turned to the north you set on
            the compass.
          </p>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Plot facing
          </h3>
          <div
            className={`rounded-md border px-3 py-2 ${STATUS[report.entrance.status].chip}`}
            data-testid="vastu-entrance"
          >
            <p className="flex items-center justify-between gap-2 text-xs font-medium">
              <span>Main entrance side</span>
              <StatusChip status={report.entrance.status} />
            </p>
            <p className="mt-1 text-[11px] leading-relaxed">
              {report.entrance.message}
            </p>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            This is the direction the plot faces, not a room. Change it in the
            compass.
          </p>
        </section>

        {rooms.length > 0 && (
          <section className="border-t border-slate-100 pt-4">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Centre (Brahmasthan)
            </h3>
            <div
              className={`rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
                report.brahmasthan.clear
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
              data-testid="vastu-brahmasthan"
            >
              <p className="text-xs font-medium">
                {report.brahmasthan.clear ? '✓ Centre open' : '! Centre used'}
              </p>
              <p className="mt-1">{report.brahmasthan.message}</p>
              {report.brahmasthan.intruders.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {report.brahmasthan.intruders.map((verdict, index) => (
                    <li key={verdictKey(verdict, index)}>
                      {roomName(verdict.room)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Rooms ({report.rooms.length})
          </h3>
          {report.rooms.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-slate-400">
              No enclosed spaces yet. Close a loop of walls and it appears
              here.
            </p>
          ) : (
            <ul className="space-y-1">
              {report.rooms.map((verdict, index) => (
                <li key={verdictKey(verdict, index)}>
                  <button
                    type="button"
                    onClick={() =>
                      select({
                        kind: 'room',
                        anchor: verdict.room.label?.anchor ?? verdict.room.centroid,
                      })
                    }
                    data-testid={`vastu-row-${index}`}
                    aria-current={verdict.room === selected}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      verdict.room === selected
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`truncate ${
                          verdict.room.label
                            ? 'font-medium text-slate-900'
                            : 'italic text-slate-400'
                        }`}
                      >
                        {roomName(verdict.room)}
                      </span>
                      <StatusChip status={verdict.status} />
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      {zoneText(verdict)}
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                      {verdict.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="border-t border-slate-200 px-4 py-3">
        <p className="text-[11px] leading-relaxed text-slate-400">
          Vastu Shastra is a traditional guideline system: this panel reports
          what one written ruleset says, and you and your client decide what to
          follow.
        </p>
      </footer>
    </aside>
  )
}

/** The status word, its mark and its colour — never colour alone. */
function StatusChip({ status }: { status: VastuStatus }) {
  const { word, mark, chip } = STATUS[status]
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${chip}`}
      data-testid={`vastu-status-${status}`}
    >
      <span aria-hidden="true">{mark} </span>
      {word}
    </span>
  )
}

/** One tally in the score breakdown, so a number like 67 is explicable. */
function CountChip({ status, count }: { status: VastuStatus; count: number }) {
  const { word, mark, chip } = STATUS[status]
  return (
    <li
      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${chip}`}
      data-testid={`vastu-count-${status}`}
    >
      <span aria-hidden="true">{mark} </span>
      {count} {word.toLowerCase()}
    </li>
  )
}

/**
 * Where the room sits. Below `UNCERTAIN_COVERAGE` the room straddles zones and
 * the verdict rests on a share barely bigger than the runner-up's, so the
 * fraction is named rather than a coin-flip being printed as a fact.
 */
function zoneText(verdict: RoomVerdict): string {
  const zone = zoneLabel(verdict.zone)
  const share = Math.round(verdict.coverage * 100)
  return verdict.coverage < UNCERTAIN_COVERAGE
    ? `Mostly ${zone} zone — ${share}% of its floor area, so it straddles zones`
    : `${zone} zone`
}

function roomName(room: ResolvedRoom): string {
  return room.label ? getRoomType(room.label.type).label : 'Unnamed space'
}

/**
 * Keyed by the name when there is one, so React keeps a named row's DOM node
 * as the plan is edited and the ordering shifts underneath it.
 */
const verdictKey = (verdict: RoomVerdict, index: number) =>
  verdict.room.label ? verdict.room.label.id : `unnamed-${index}`
