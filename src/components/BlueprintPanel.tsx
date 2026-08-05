import { useRef, useState, useSyncExternalStore } from 'react'
import {
  clearCalibrationPicks,
  getCalibrationPicks,
  isCalibrated,
  markCalibrated,
  subscribeCalibration,
} from '../blueprint/calibration'
import { detectWallSegments, segmentsToWalls } from '../blueprint/detectWalls'
import { detectAndPlaceOpenings } from '../blueprint/detectOpenings'
import { loadBlueprintFromFile } from '../blueprint/load'
import {
  rasterise,
  type Raster,
  type RasterResult,
} from '../blueprint/raster'
import { distance } from '../plan/viewport'
import { BLUEPRINT } from '../scene/config'
import {
  useDesignStore,
  type Point,
} from '../store/useDesignStore'

/** A wall the detector proposed, still waiting for the user to accept it. */
type DetectedWall = { start: Point; end: Point; thickness: number }

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'detecting' }
  | { kind: 'openings' }
  | { kind: 'error'; message: string }
  | { kind: 'note'; message: string }

/**
 * Detection is synchronous and scans every pixel, so it freezes the tab for a
 * frame or two. Two frames plus a macrotask is what it takes for React to
 * commit the "Detecting…" label and for the browser to actually paint it —
 * without this the label appears only after the work it was announcing.
 */
const yieldToPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    )
  })

/**
 * Re-reads the pixels of a blueprint that outlived the panel.
 *
 * The raster is normally kept from the upload, but closing the panel unmounts
 * it while the image stays in the store, and detection would otherwise be
 * dead until the file was chosen again. The object URL belongs to the store,
 * so this deliberately does not release it.
 */
const rasterFromSrc = (src: string) =>
  new Promise<RasterResult>((resolve) => {
    const element = new Image()
    element.onload = () =>
      resolve(
        rasterise({
          element,
          width: element.naturalWidth,
          height: element.naturalHeight,
          release: () => {},
        }),
      )
    element.onerror = () =>
      resolve({ ok: false, error: 'That blueprint image could not be read.' })
    element.src = src
  })

/** "1 px = 1.90 cm", the sanity check that a calibration went the right way. */
const scaleLabel = (metresPerPixel: number) => {
  const cm = metresPerPixel * 100
  return `1 px = ${cm < 1 ? cm.toFixed(3) : cm.toFixed(2)} cm`
}

/**
 * Left-docked panel for tracing a scanned or photographed floor plan.
 *
 * The workflow is deliberately ordered: load the image, calibrate it against a
 * distance you know, then either trace it by hand with the wall tool or let
 * detection propose walls. Detection before calibration would produce a
 * building of the wrong size, so the panel says so rather than hiding it.
 */
export function BlueprintPanel() {
  const blueprint = useDesignStore((s) => s.blueprint)
  const calibrating = useDesignStore((s) => s.blueprintCalibrating)
  const setBlueprintPanelOpen = useDesignStore((s) => s.setBlueprintPanelOpen)
  const setBlueprintCalibrating = useDesignStore(
    (s) => s.setBlueprintCalibrating,
  )
  const updateBlueprint = useDesignStore((s) => s.updateBlueprint)
  const picks = useSyncExternalStore(subscribeCalibration, getCalibrationPicks)

  const fileRef = useRef<HTMLInputElement>(null)
  /** Kept from the upload so detection never re-decodes the file. */
  const rasterRef = useRef<Raster | null>(null)

  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [detected, setDetected] = useState<DetectedWall[] | null>(null)
  const [knownLength, setKnownLength] = useState('')

  const calibrated = blueprint ? isCalibrated(blueprint.src) : false
  const busy =
    status.kind === 'loading' ||
    status.kind === 'detecting' ||
    status.kind === 'openings'
  const measured = picks.length === 2 ? distance(picks[0], picks[1]) : 0

  const loadFile = async (file: File | undefined) => {
    if (!file) return

    setStatus({ kind: 'loading' })
    setDetected(null)
    clearCalibrationPicks()

    const result = await loadBlueprintFromFile(file)
    if (!result.ok) {
      setStatus({ kind: 'error', message: result.error })
      return
    }

    rasterRef.current = result.raster

    setKnownLength('')
    setStatus({ kind: 'idle' })
  }

  const startCalibration = () => {
    clearCalibrationPicks()
    setKnownLength('')
    setBlueprintCalibrating(true)
  }

  const cancelCalibration = () => {
    setBlueprintCalibrating(false)
    clearCalibrationPicks()
    setKnownLength('')
  }

  const applyCalibration = () => {
    const typed = Number(knownLength)
    if (!blueprint || measured <= 0) return
    if (!Number.isFinite(typed) || typed <= 0) {
      setStatus({ kind: 'error', message: 'Type the real length in metres.' })
      return
    }

    const metresPerPixel = Math.min(
      BLUEPRINT.maxMetresPerPixel,
      Math.max(
        BLUEPRINT.minMetresPerPixel,
        blueprint.metresPerPixel * (typed / measured),
      ),
    )
    // The factor that was actually applied, after clamping — using the raw
    // ratio here would slide the image whenever a limit bit.
    const factor = metresPerPixel / blueprint.metresPerPixel
    const anchor = picks[0]

    updateBlueprint({
      metresPerPixel,
      // The first point clicked is what the user aimed at, so the image grows
      // or shrinks around it rather than wandering off under the cursor.
      origin: {
        x: anchor.x - (anchor.x - blueprint.origin.x) * factor,
        z: anchor.z - (anchor.z - blueprint.origin.z) * factor,
      },
    })

    markCalibrated(blueprint.src)
    clearCalibrationPicks()
    setKnownLength('')
    // Anything already detected was measured at the old scale.
    setDetected(null)
    setStatus({ kind: 'idle' })
  }

  const detect = async () => {
    if (!blueprint) return

    setStatus({ kind: 'detecting' })
    setDetected(null)

    let raster = rasterRef.current
    if (!raster) {
      const result = await rasterFromSrc(blueprint.src)
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error })
        return
      }
      raster = result.raster
      rasterRef.current = raster
    }

    await yieldToPaint()

    const segments = detectWallSegments(raster.image)
    const walls = segmentsToWalls(segments, {
      // Detection runs on the downscaled raster, whose pixels are bigger than
      // the source pixels the calibration is expressed in.
      metresPerPixel: blueprint.metresPerPixel / raster.scale,
      origin: blueprint.origin,
    })

    setDetected(walls)
    setStatus({ kind: 'idle' })
  }

  const addDetected = () => {
    if (!detected) return

    const { addWall } = useDesignStore.getState()
    let added = 0
    for (const wall of detected) {
      if (addWall(wall.start, wall.end, { thickness: wall.thickness })) {
        added += 1
      }
    }

    setDetected(null)
    setStatus({
      kind: 'note',
      message:
        `Added ${added} wall${added === 1 ? '' : 's'}. They are ordinary ` +
        'walls now — select them to add doors, or delete the wrong ones.',
    })
  }

  const findOpenings = async () => {
    if (useDesignStore.getState().walls.length === 0) {
      setStatus({
        kind: 'error',
        message: 'Add the walls first — doors and windows are placed on them.',
      })
      return
    }
    setStatus({ kind: 'openings' })
    const result = await detectAndPlaceOpenings()
    if (!result.ok) {
      setStatus({ kind: 'error', message: result.error })
      return
    }
    const extras = [
      result.roomsNamed > 0
        ? `named ${result.roomsNamed} room${result.roomsNamed === 1 ? '' : 's'}`
        : null,
      result.furniturePlaced > 0
        ? `placed ${result.furniturePlaced} furnishing${result.furniturePlaced === 1 ? '' : 's'}`
        : null,
    ].filter(Boolean)
    const extraNote = extras.length > 0 ? ` Also ${extras.join(' and ')}.` : ''

    setStatus({
      kind: 'note',
      message:
        result.added > 0
          ? `Placed ${result.added} of ${result.found} openings the model ` +
            `found${
              result.dropped > 0
                ? ` (${result.dropped} landed on no wall and were skipped)`
                : ''
            }.${extraNote} Check them against the image and fix any that are off.`
          : `The model found no doors or windows it could place on these walls.${extraNote} ` +
            'Add openings by hand with the Door and Window tools.',
    })
  }

  const removeBlueprint = () => {
    useDesignStore.getState().setBlueprint(null)
    setBlueprintCalibrating(false)
    clearCalibrationPicks()
    rasterRef.current = null
    setDetected(null)
    setKnownLength('')
    setStatus({ kind: 'idle' })
  }

  return (
    <aside
      className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white"
      data-testid="blueprint-panel"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Trace a blueprint</h2>
        <button
          type="button"
          onClick={() => setBlueprintPanelOpen(false)}
          className="text-xs text-slate-400 hover:text-slate-700"
          aria-label="Close blueprint panel"
        >
          Close
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Image
          </h3>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="blueprint-file"
            onChange={(e) => {
              void loadFile(e.target.files?.[0])
              // Cleared so re-picking the same file still fires a change.
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            data-testid="blueprint-upload"
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {status.kind === 'loading'
              ? 'Reading image…'
              : blueprint
                ? 'Replace image'
                : 'Choose an image'}
          </button>

          {blueprint ? (
            <p className="truncate text-[11px] text-slate-500" title={blueprint.fileName}>
              {blueprint.fileName} · {blueprint.width} × {blueprint.height} px
            </p>
          ) : (
            <p className="text-[11px] text-slate-400">
              A scan, photo, or PNG export of a plan. It sits under the drawing
              so you can trace over it.
            </p>
          )}
        </section>

        {blueprint && (
          <>
            <section className="space-y-2 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Appearance
                </h3>
                <button
                  type="button"
                  onClick={() => updateBlueprint({ visible: !blueprint.visible })}
                  data-testid="blueprint-visible"
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
                >
                  {blueprint.visible ? 'Hide' : 'Show'}
                </button>
              </div>
              <label
                htmlFor="blueprint-opacity"
                className="flex items-center gap-2 text-[11px] text-slate-500"
              >
                Opacity
                <input
                  id="blueprint-opacity"
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={blueprint.opacity}
                  onChange={(e) =>
                    updateBlueprint({ opacity: Number(e.target.value) })
                  }
                  data-testid="blueprint-opacity"
                  className="flex-1 accent-slate-900"
                />
                <span className="w-8 text-right tabular-nums text-slate-400">
                  {Math.round(blueprint.opacity * 100)}%
                </span>
              </label>
            </section>

            <section className="space-y-2 border-t border-slate-100 pt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Scale
              </h3>
              <p className="text-[11px] tabular-nums text-slate-600">
                {scaleLabel(blueprint.metresPerPixel)} · image is{' '}
                {(blueprint.width * blueprint.metresPerPixel).toFixed(2)} m wide
              </p>

              {!calibrated && (
                <p className="text-[11px] text-amber-600">
                  Not calibrated yet — this is the default guess, not a
                  measurement.
                </p>
              )}

              {picks.length < 2 && !calibrating && (
                <button
                  type="button"
                  onClick={startCalibration}
                  data-testid="blueprint-calibrate"
                  className="w-full rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200"
                >
                  {calibrated ? 'Calibrate again' : 'Calibrate the scale'}
                </button>
              )}

              {calibrating && (
                <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
                  <p className="text-[11px] leading-relaxed text-violet-800">
                    {BLUEPRINT.calibrationHint} Click the two ends of something
                    you know the length of — a dimension line, a door, a wall.
                    {picks.length === 1 && ' One end picked; click the other.'}
                  </p>
                  <button
                    type="button"
                    onClick={cancelCalibration}
                    className="text-[11px] font-medium text-violet-700 hover:text-violet-900"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {picks.length === 2 && (
                <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
                  <label
                    htmlFor="blueprint-length"
                    className="block text-[11px] leading-relaxed text-violet-800"
                  >
                    That span currently reads {measured.toFixed(2)} m. How long
                    is it really?
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="blueprint-length"
                      type="number"
                      min={0}
                      step="any"
                      value={knownLength}
                      autoFocus
                      onChange={(e) => setKnownLength(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') applyCalibration()
                      }}
                      data-testid="blueprint-length"
                      className="w-20 rounded-md border border-violet-300 bg-white px-2 py-1 text-xs outline-none focus:border-violet-500"
                    />
                    <span className="text-[11px] text-violet-800">metres</span>
                    <button
                      type="button"
                      onClick={applyCalibration}
                      disabled={knownLength.trim().length === 0}
                      data-testid="blueprint-apply-scale"
                      className="ml-auto rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300"
                    >
                      Set scale
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={cancelCalibration}
                    className="text-[11px] font-medium text-violet-700 hover:text-violet-900"
                  >
                    Discard measurement
                  </button>
                </div>
              )}
            </section>

            <section className="space-y-2 border-t border-slate-100 pt-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Detect walls
              </h3>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Finds straight, solid, horizontal and vertical walls. Doors and
                windows come from a separate AI step below.
              </p>

              {!calibrated && (
                <p className="text-[11px] text-amber-600">
                  Calibrate first, or the walls will come in at the wrong size.
                </p>
              )}

              <button
                type="button"
                onClick={() => void detect()}
                disabled={busy}
                data-testid="blueprint-detect"
                className="w-full rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {status.kind === 'detecting' ? 'Detecting…' : 'Detect walls'}
              </button>

              {detected && detected.length > 0 && (
                <div
                  className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"
                  data-testid="blueprint-found"
                >
                  <p className="text-[11px] leading-relaxed text-emerald-800">
                    Found {detected.length} wall
                    {detected.length === 1 ? '' : 's'}. Check them against the
                    image before you commit.
                  </p>
                  <button
                    type="button"
                    onClick={addDetected}
                    data-testid="blueprint-add-walls"
                    className="w-full rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
                  >
                    Add these walls
                  </button>
                </div>
              )}

              {detected && detected.length === 0 && (
                <p
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800"
                  data-testid="blueprint-none"
                >
                  No walls found. This only works on drawings with solid,
                  axis-aligned walls — hatched, outlined, or angled ones are
                  invisible to it. Trace over the image with the wall tool
                  instead.
                </p>
              )}
            </section>

            <section className="border-t border-slate-100 pt-4">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Doors &amp; windows (AI)
              </h3>
              <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
                A vision model reads the door arcs and window marks off the
                image and places them on the walls above. Approximate — check
                each one and fix the misses.
              </p>
              <button
                type="button"
                onClick={() => void findOpenings()}
                disabled={busy}
                data-testid="blueprint-openings"
                className="w-full rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                {status.kind === 'openings'
                  ? 'Reading the plan…'
                  : 'Detect doors & windows'}
              </button>
            </section>

            <section className="border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={removeBlueprint}
                data-testid="blueprint-remove"
                className="text-[11px] font-medium text-slate-400 hover:text-red-600"
              >
                Remove blueprint
              </button>
            </section>
          </>
        )}

        {status.kind === 'error' && (
          <p
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700"
            data-testid="blueprint-error"
          >
            {status.message}
          </p>
        )}

        {status.kind === 'note' && (
          <p
            className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600"
            data-testid="blueprint-note"
          >
            {status.message}
          </p>
        )}
      </div>
    </aside>
  )
}
