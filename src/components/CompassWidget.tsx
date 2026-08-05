import { useCallback, useEffect, useRef, useState } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import {
  describeNorth,
  FACINGS,
  getFacing,
  normalizeDegrees,
  snapNorth,
} from '../site/orientation'

/** Radius of the compass rose in the widget, in SVG units. */
const R = 34
const SIZE = R * 2 + 16

/**
 * The site compass: which way North points, and which way the plot faces.
 *
 * It floats over the plan rather than living in the toolbar because rotating
 * North is a drawing act — you do it while looking at the walls, matching them
 * to the road or the plot boundary.
 */
export function CompassWidget() {
  const northOffset = useDesignStore((s) => s.northOffset)
  const setNorthOffset = useDesignStore((s) => s.setNorthOffset)
  const plotFacing = useDesignStore((s) => s.plotFacing)
  const setPlotFacing = useDesignStore((s) => s.setPlotFacing)
  const readOnly = useDesignStore((s) => s.readOnly)
  const showCompass = useDesignStore((s) => s.showCompass)
  const setShowCompass = useDesignStore((s) => s.setShowCompass)

  const [dragging, setDragging] = useState(false)
  const roseRef = useRef<SVGSVGElement>(null)

  /** Angle from the rose's centre to a pointer, in degrees clockwise from up. */
  const angleAt = useCallback((clientX: number, clientY: number) => {
    const rect = roseRef.current?.getBoundingClientRect()
    if (!rect) return null
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = clientX - cx
    const dy = clientY - cy
    if (dx === 0 && dy === 0) return null
    return normalizeDegrees((Math.atan2(dx, -dy) * 180) / Math.PI)
  }, [])

  // Tracked on the window, not the SVG: a rotation drag routinely leaves the
  // 68px rose, and losing the pointer mid-turn would strand North half-set.
  useEffect(() => {
    if (!dragging) return

    const onMove = (e: PointerEvent) => {
      const angle = angleAt(e.clientX, e.clientY)
      if (angle === null) return
      // Shift means "give me the exact angle" — otherwise settle onto the
      // eight true directions, which is what almost every plot actually is.
      setNorthOffset(e.shiftKey ? angle : snapNorth(angle))
    }
    const stop = () => setDragging(false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging, angleAt, setNorthOffset])

  const facing = getFacing(plotFacing)
  const locked = readOnly

  // Collapsed: a small round button that restores the widget. Keeps North one
  // click away without the panel covering the corner of the plan.
  if (!showCompass) {
    return (
      <button
        type="button"
        onClick={() => setShowCompass(true)}
        data-testid="compass-show"
        aria-label="Show compass"
        title="Show compass"
        className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 shadow-lg backdrop-blur transition-colors hover:bg-slate-50"
      >
        <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden>
          <circle r={10} className="fill-slate-50 stroke-slate-200" strokeWidth={1} />
          <path d="M 0 -7 L 3 2 L 0 0 L -3 2 Z" className="fill-red-500" />
          <path d="M 0 0 L 3 2 L 0 7 L -3 2 Z" className="fill-slate-400" />
        </svg>
      </button>
    )
  }

  return (
    <div
      data-testid="compass-widget"
      className="pointer-events-auto relative w-44 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur"
    >
      <button
        type="button"
        onClick={() => setShowCompass(false)}
        data-testid="compass-hide"
        aria-label="Hide compass"
        title="Hide compass"
        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <span aria-hidden className="text-sm leading-none">
          ×
        </span>
      </button>
      <div className="flex items-center gap-3">
        <svg
          ref={roseRef}
          width={SIZE}
          height={SIZE}
          viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Compass, ${describeNorth(northOffset)}`}
          data-testid="compass-rose"
          className={locked ? 'cursor-default' : 'cursor-grab touch-none'}
          onPointerDown={(e) => {
            if (locked) return
            e.preventDefault()
            const angle = angleAt(e.clientX, e.clientY)
            if (angle !== null) setNorthOffset(snapNorth(angle))
            setDragging(true)
          }}
        >
          <circle r={R} className="fill-slate-50 stroke-slate-200" strokeWidth={1} />
          <circle r={R - 7} className="fill-none stroke-slate-100" strokeWidth={1} />

          {/* Ticks every 45°, so the eight directions are readable at a glance. */}
          {FACINGS.map((f) => (
            <line
              key={f.id}
              x1={0}
              y1={-R + 2}
              x2={0}
              y2={-R + (f.bearing % 90 === 0 ? 8 : 5)}
              transform={`rotate(${f.bearing + northOffset})`}
              className="stroke-slate-300"
              strokeWidth={f.bearing % 90 === 0 ? 1.5 : 1}
            />
          ))}

          {/* The needle. It carries the whole rotation, so North sits where the
              user put it while the plan underneath stays square on the page. */}
          <g transform={`rotate(${northOffset})`}>
            <path
              d={`M 0 ${-R + 6} L 6 4 L 0 0 L -6 4 Z`}
              className="fill-red-500"
            />
            <path d={`M 0 0 L 6 4 L 0 ${R - 10} L -6 4 Z`} className="fill-slate-400" />
            <text
              y={-R + 1}
              textAnchor="middle"
              className="fill-slate-900 text-[9px] font-bold"
            >
              N
            </text>
          </g>
        </svg>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            North
          </p>
          <p
            className="truncate text-xs font-semibold text-slate-800"
            data-testid="compass-north-readout"
          >
            {Math.round(northOffset)}°
          </p>
          <p className="mt-0.5 text-[10px] leading-tight text-slate-500">
            {describeNorth(northOffset)}
          </p>
        </div>
      </div>

      {!locked && (
        <p className="mt-2 text-[10px] leading-tight text-slate-400">
          Drag the rose to match the plot. Hold Shift for any angle.
        </p>
      )}

      <div className="mt-2 border-t border-slate-100 pt-2">
        <label
          htmlFor="plot-facing"
          className="text-[10px] font-semibold uppercase tracking-wide text-slate-400"
        >
          Plot facing
        </label>
        <select
          id="plot-facing"
          value={plotFacing}
          disabled={locked}
          onChange={(e) => setPlotFacing(e.target.value as typeof plotFacing)}
          data-testid="plot-facing-select"
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
        >
          {FACINGS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <p
          className="mt-1 text-[10px] text-slate-500"
          data-testid="plot-facing-readout"
        >
          Faces {facing.label} ({facing.bearing}°)
        </p>
      </div>
    </div>
  )
}
