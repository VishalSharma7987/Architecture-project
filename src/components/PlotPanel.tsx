import { useMemo } from 'react'
import {
  PLOT_DEFAULTS,
  useDesignStore,
  type Plot,
} from '../store/useDesignStore'
import { planBounds } from '../scene/wallGeometry'
import {
  buildableRect,
  frontEdge,
  plotAround,
  plotRect,
  rectArea,
  rectDepth,
  rectWidth,
  wallsOutsideBuildable,
} from '../site/plot'
import { formatArea, formatLength } from '../units/length'
import { LengthField } from './LengthField'

const EDGE_LABEL: Record<string, string> = {
  top: 'top of the plan',
  right: 'right of the plan',
  bottom: 'bottom of the plan',
  left: 'left of the plan',
}

type SetbackEdge = keyof Plot['setbacks']

const SETBACKS: { id: SetbackEdge; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'rear', label: 'Rear' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
]

/**
 * The site panel: plot size, setbacks, and whether the building fits.
 *
 * Setbacks are named by their relationship to the road (front, rear, left,
 * right) rather than by page direction, because that is how they arrive from a
 * client and how they appear on a sanction drawing. Which page edge each one
 * lands on follows the plot facing and the north rotation, and is spelled out
 * here so the mapping is never a guess.
 */
export function PlotPanel() {
  const plot = useDesignStore((s) => s.plot)
  const setPlot = useDesignStore((s) => s.setPlot)
  const updatePlot = useDesignStore((s) => s.updatePlot)
  const setSetback = useDesignStore((s) => s.setSetback)
  const setPlotPanelOpen = useDesignStore((s) => s.setPlotPanelOpen)
  const walls = useDesignStore((s) => s.walls)
  const units = useDesignStore((s) => s.units)
  const target = useDesignStore((s) => s.targetExtent)
  const setTargetExtent = useDesignStore((s) => s.setTargetExtent)
  const plotFacing = useDesignStore((s) => s.plotFacing)
  const northOffset = useDesignStore((s) => s.northOffset)

  const analysis = useMemo(() => {
    if (!plot) return null
    const outer = plotRect(plot)
    const inner = buildableRect(plot, plotFacing, northOffset)
    return {
      outer,
      inner,
      violations: wallsOutsideBuildable(walls, inner),
      front: frontEdge(plotFacing, northOffset),
    }
  }, [plot, plotFacing, northOffset, walls])

  const createPlot = () => {
    const bounds = planBounds(walls)
    const width = PLOT_DEFAULTS.width
    const depth = PLOT_DEFAULTS.depth
    setPlot({
      width,
      depth,
      // Centred on whatever is already drawn, so the boundary lands around the
      // building rather than off at the world origin.
      origin: plotAround(bounds, width, depth),
      setbacks: {
        front: PLOT_DEFAULTS.setback,
        rear: PLOT_DEFAULTS.setback,
        left: PLOT_DEFAULTS.setback,
        right: PLOT_DEFAULTS.setback,
      },
    })
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Plot &amp; setbacks</h2>
        <button
          type="button"
          onClick={() => setPlotPanelOpen(false)}
          className="text-xs font-medium text-slate-400 hover:text-slate-700"
        >
          Close
        </button>
      </header>

      {!plot || !analysis ? (
        <div className="p-4">
          <p className="text-xs leading-relaxed text-slate-500">
            Set a plot boundary to design against real site limits. You can type
            exact dimensions and setbacks, and the buildable zone is drawn on the
            plan.
          </p>
          <button
            type="button"
            onClick={createPlot}
            data-testid="plot-create"
            className="mt-3 w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
          >
            Add a {formatLength(PLOT_DEFAULTS.width, units)} ×{' '}
            {formatLength(PLOT_DEFAULTS.depth, units)} plot
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {/*
            The BUILDING's intended size, beside the SITE's — the two are
            different things and are shown as such. A house meant to be
            9 x 11 m can sit on a 30 x 40 ft plot; folding the target into
            `Plot` would make it mean whichever the document happened to have.
            Blank is the normal state and keeps the status bar silent.
          */}
          <section className="mb-5">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Target building size
            </h3>
            <LengthField
              label="Width"
              metres={target?.width ?? 0}
              units={units}
              testId="target-width"
              onCommit={(width) =>
                setTargetExtent(
                  width > 0 ? { width, depth: target?.depth ?? width } : null,
                )
              }
            />
            <LengthField
              label="Depth"
              metres={target?.depth ?? 0}
              units={units}
              testId="target-depth"
              onCommit={(depth) =>
                setTargetExtent(
                  depth > 0 ? { width: target?.width ?? depth, depth } : null,
                )
              }
            />
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              {target
                ? 'The status bar shows how far the plan is from this.'
                : 'Set this and the status bar will say how far off the plan is.'}
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Plot size
            </h3>
            <LengthField
              label="Width"
              metres={plot.width}
              units={units}
              testId="plot-width"
              onCommit={(width) => updatePlot({ width })}
            />
            <LengthField
              label="Depth"
              metres={plot.depth}
              units={units}
              testId="plot-depth"
              onCommit={(depth) => updatePlot({ depth })}
            />
            <p className="mt-2 flex items-baseline justify-between text-xs">
              <span className="text-slate-500">Plot area</span>
              <span
                className="font-semibold text-slate-900"
                data-testid="plot-area"
              >
                {formatArea(rectArea(analysis.outer), units)}
              </span>
            </p>
          </section>

          <section className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Setbacks
            </h3>
            <p className="mb-2 text-[11px] leading-tight text-slate-500">
              Facing {plotFacing}, so the front is the{' '}
              <span className="font-medium text-slate-700">
                {EDGE_LABEL[analysis.front]}
              </span>
              . Left and right are as seen from the front, looking in.
            </p>
            {SETBACKS.map((edge) => (
              <LengthField
                key={edge.id}
                label={edge.label}
                metres={plot.setbacks[edge.id]}
                units={units}
                testId={`setback-${edge.id}`}
                onCommit={(value) => setSetback(edge.id, value)}
              />
            ))}
          </section>

          <section className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Buildable area
            </h3>
            {analysis.inner ? (
              <>
                <p className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-500">Size</span>
                  <span className="font-medium text-slate-800 tabular-nums">
                    {formatLength(rectWidth(analysis.inner), units)} ×{' '}
                    {formatLength(rectDepth(analysis.inner), units)}
                  </span>
                </p>
                <p className="mt-1 flex items-baseline justify-between text-xs">
                  <span className="text-slate-500">Area</span>
                  <span
                    className="text-sm font-semibold text-emerald-700"
                    data-testid="buildable-area"
                  >
                    {formatArea(rectArea(analysis.inner), units)}
                  </span>
                </p>
              </>
            ) : (
              <p
                className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700"
                data-testid="buildable-none"
              >
                The setbacks meet — there is nothing left to build on.
              </p>
            )}
          </section>

          <section className="mt-4 border-t border-slate-100 pt-3">
            {analysis.violations.length === 0 ? (
              <p
                className="rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700"
                data-testid="plot-ok"
              >
                {walls.length === 0
                  ? 'Nothing drawn yet.'
                  : 'Every wall is inside the buildable area.'}
              </p>
            ) : (
              <p
                className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] leading-relaxed text-red-700"
                data-testid="plot-violations"
              >
                <span className="font-semibold">
                  {analysis.violations.length}{' '}
                  {analysis.violations.length === 1 ? 'wall crosses' : 'walls cross'}{' '}
                  the setback line.
                </span>{' '}
                Worst overhang{' '}
                {formatLength(
                  Math.max(...analysis.violations.map((v) => v.overhang)),
                  units,
                )}
                , measured to the outer face.
              </p>
            )}
          </section>

          <button
            type="button"
            onClick={() => setPlot(null)}
            data-testid="plot-remove"
            className="mt-4 w-full rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-red-50 hover:text-red-600"
          >
            Remove plot
          </button>
        </div>
      )}
    </aside>
  )
}
