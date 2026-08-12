import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDesignStore, type Point, type Tool } from '../store/useDesignStore'
import { provenance } from '../store/provenance'
import {
  clearCalibrationPicks,
  getCalibrationPicks,
  setCalibrationPicks,
  subscribeCalibration,
} from '../blueprint/calibration'
import { FURNITURE_DRAG_TYPE } from '../components/FurniturePanel'
import { isFurnitureType } from '../furniture/catalog'
import {
  resolveRooms,
  roomSelectionAt,
  type ResolvedRoom,
} from '../rooms/resolve'
import {
  pickFurniture,
  pickOpening,
  pickWall,
  planBounds,
  projectOntoWall,
} from '../scene/wallGeometry'
import { GRID_STEP } from '../units/length'
import {
  SNAP_RADIUS_PX,
  resolveWallPoint,
  type SnapResult,
  type SnapTarget,
} from './snap'
import {
  entryLength,
  keyToAction,
  typedEndpoint,
  type NumericEntry,
} from './numericEntry'
import { vastuZones, type ZoneCell } from '../vastu/zones'
import { drawPlan, pickStair } from './draw'
import { findLooseJoints, type LooseJoint } from './repairJoints'
import {
  createViewport,
  fitToBounds,
  screenToWorld,
  snapToGrid,
  zoomAt,
  type Viewport,
} from './viewport'

/** Click slop for hitting walls and openings, in screen pixels. */
const HIT_TOLERANCE_PX = 7

/**
 * The four corners of the rectangle two opposite corners describe, wound so
 * the shoelace area is positive whichever way the drag went.
 *
 * Winding matters: `containsPoint` and `ringArea` are sign-agnostic, but a
 * ring that flips direction depending on which way the user dragged is a ring
 * two identical spaces disagree about, and `spaceId` hashes the vertex order.
 */
const rectangleRing = (a: Point, b: Point): Point[] => {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minZ = Math.min(a.z, b.z)
  const maxZ = Math.max(a.z, b.z)
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ]
}

/**
 * Top-down floor plan editor.
 *
 * Left-click places points; each one closes a wall against the previous point
 * and commits it straight to the store, so what you see is always the model
 * rather than a staged copy. Escape or double-click ends the chain.
 *
 * Everything that changes per-frame (cursor, viewport, chain anchor) lives in
 * refs and is painted imperatively — a React re-render per mousemove would be
 * wasted work when the output is a canvas.
 */
export function FloorPlanEditor() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const viewportRef = useRef<Viewport>(createViewport())
  const cursorRef = useRef<Point | null>(null)
  const anchorRef = useRef<Point | null>(null)
  /** The snap target under the cursor, drawn as the indicator. */
  const snapRef = useRef<SnapTarget | null>(null)
  /** The typed-length buffer, or null when no numeric entry is in progress. */
  const entryRef = useRef<NumericEntry>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const frameRef = useRef<number | null>(null)
  const panRef = useRef<{
    sx: number
    sy: number
    cx: number
    cz: number
  } | null>(null)
  /**
   * The object being dragged. Furniture and stairs drag freely across the floor
   * (an offset from their centre to the grab point); a door or window instead
   * slides along its own wall, so it carries the wall it belongs to and the
   * offset between where it sits on that wall and where it was grabbed.
   */
  const dragRef = useRef<
    | { kind: 'furniture' | 'stair'; id: string; dx: number; dz: number }
    | { kind: 'opening'; wallId: string; openingId: string; tOffset: number }
    | null
  >(null)
  /** The traced image, once decoded. Null while it loads, or when there is none. */
  const imageRef = useRef<HTMLImageElement | null>(null)
  /** Mirrors the memoised resolve, for the imperative paint and the hit test. */
  const roomsRef = useRef<ResolvedRoom[]>([])
  /** Mirrors the memoised loose-joint scan, for the imperative paint. */
  const looseRef = useRef<LooseJoint[]>([])
  /** Mirrors the memoised zone grid, for the imperative paint. */
  const vastuRef = useRef<ZoneCell[]>([])
  /** Space held: the universal "pan with any tool" modifier. */
  const spaceRef = useRef(false)
  /**
   * The corner the Space tool's outline was started from, or null.
   *
   * Named for the DRAG, not the tool, because `spaceRef` above is the space
   * BAR — two different things one letter apart, and holding the space bar
   * while the Space tool is active is a combination a user will actually hit.
   */
  const spaceDragRef = useRef<Point | null>(null)

  // Mirrors `anchorRef` for the hint text only; the canvas never reads it.
  const [isDrawing, setIsDrawing] = useState(false)
  // Drives the grab cursor while space-to-pan is armed.
  const [spacePanning, setSpacePanning] = useState(false)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const { width, height } = sizeRef.current
    if (!ctx || !width || !height) return

    const { blueprint } = useDesignStore.getState()
    const image = imageRef.current

    drawPlan(ctx, {
      width,
      height,
      viewport: viewportRef.current,
      // Read through getState so the paint always sees current state without
      // this callback needing to be rebuilt on every store change.
      walls: useDesignStore.getState().walls,
      furniture: useDesignStore.getState().furniture,
      stairs: useDesignStore.getState().stairs,
      rooms: roomsRef.current,
      vastuCells: vastuRef.current,
      // The site layer is cheap to derive and is read straight from the store,
      // so a setback edit repaints the buildable zone with no memo in between.
      plot: useDesignStore.getState().plot,
      plotFacing: useDesignStore.getState().plotFacing,
      northOffset: useDesignStore.getState().northOffset,
      selection: useDesignStore.getState().selection,
      units: useDesignStore.getState().units,
      showDimensions: useDesignStore.getState().showDimensions,
      anchor: anchorRef.current,
      // Hidden while a length is being typed. The indicator means "the
      // endpoint lands here", and that stops being true the moment a number
      // overrides the distance — the snapped point still supplies the
      // DIRECTION, which the draft line shows by pointing through it.
      snap: entryRef.current ? null : snapRef.current,
      typed: entryRef.current?.text ?? null,
      spaceCorner: spaceDragRef.current,
      looseJoints: looseRef.current,
      cursor: cursorRef.current,
      // Only the tools that place on the grid want the snap marker; the rest
      // target walls. Calibration wants it too, since it is an aiming task.
      showCursor:
        useDesignStore.getState().tool === 'wall' ||
        useDesignStore.getState().tool === 'stair' ||
        useDesignStore.getState().tool === 'space' ||
        useDesignStore.getState().blueprintCalibrating,
      blueprint:
        blueprint && image && blueprint.visible
          ? {
              image,
              origin: blueprint.origin,
              width: blueprint.width,
              height: blueprint.height,
              metresPerPixel: blueprint.metresPerPixel,
              opacity: blueprint.opacity,
            }
          : null,
      calibration: getCalibrationPicks(),
    })
  }, [])

  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      draw()
    })
  }, [draw])

  const endChain = useCallback(() => {
    if (!anchorRef.current) return
    anchorRef.current = null
    entryRef.current = null
    setIsDrawing(false)
    requestDraw()
  }, [requestDraw])

  /** Canvas-relative pointer position in world metres, unsnapped. */
  const worldAt = useCallback((clientX: number, clientY: number): Point => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { width, height } = sizeRef.current
    return screenToWorld(
      clientX - rect.left,
      clientY - rect.top,
      viewportRef.current,
      width,
      height,
    )
  }, [])

  /** As `worldAt`, but snapped to the drawing grid. */
  const snappedAt = useCallback(
    (clientX: number, clientY: number): Point =>
      snapToGrid(
        worldAt(clientX, clientY),
        GRID_STEP[useDesignStore.getState().units].cell,
      ),
    [worldAt],
  )

  /**
   * Where a WALL endpoint goes: an existing wall's geometry if one is in
   * range, otherwise the grid.
   *
   * ── Snap beats grid, and returns the target EXACTLY ──
   * No grid rounding is applied to a snapped point. Rounding it would defeat
   * the entire feature: the target is only worth snapping to because landing
   * on it makes two walls share a coordinate bit-for-bit, and the grid would
   * move it by up to half a cell — 76 mm, which is the middle of the 1–152 mm
   * band Session 1 measured as the reason rooms fail to close.
   *
   * ── Wall tool only ──
   * `snappedAt` is deliberately left alone. Stairs and unenclosed spaces place
   * on the grid because they stand IN a room rather than joining anything;
   * openings never touch either function, since they project onto the wall
   * they are dropped on and so cannot be loose; and furniture wants to meet a
   * wall's FACE, which is a different target set and a different session.
   * Walls are the only elements that have to JOIN, and joining is the finding.
   *
   * ── Alt suppresses ──
   * Alt is the only unclaimed modifier: Ctrl/Cmd is wheel-zoom and undo,
   * Shift is the compass's free-rotate and the walker's run. It is also the
   * conventional "ignore snapping for a moment" key, and holding it falls back
   * to grid rather than to nothing — an unsnapped free coordinate is exactly
   * the state this session exists to stop producing.
   */
  const wallPointAt = useCallback(
    (clientX: number, clientY: number, suppressed: boolean): SnapResult => {
      return resolveWallPoint({
        walls: useDesignStore.getState().walls,
        world: worldAt(clientX, clientY),
        grid: snappedAt(clientX, clientY),
        // Screen pixels to world metres: the radius is constant on screen, so
        // it behaves the same at every zoom.
        radius: SNAP_RADIUS_PX / viewportRef.current.scale,
        suppressed,
      })
    },
    [snappedAt, worldAt],
  )

  // Wheel handling, Figma-style: two-finger scroll pans the canvas, and pinch
  // (or Ctrl/Cmd + scroll) zooms about the cursor. This is a NATIVE listener
  // because React registers `onWheel` as passive, so it cannot `preventDefault`
  // — which is exactly what stops a pinch from zooming the whole browser page.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const { width, height } = sizeRef.current
      const vp = viewportRef.current

      if (e.ctrlKey || e.metaKey) {
        zoomAt(
          vp,
          e.clientX - rect.left,
          e.clientY - rect.top,
          Math.exp(-e.deltaY * 0.0015),
          width,
          height,
        )
      } else {
        // Scroll moves the world under the cursor: content follows the fingers,
        // which is what makes it feel like sliding the sheet rather than the map.
        vp.center.x += e.deltaX / vp.scale
        vp.center.z += e.deltaY / vp.scale
      }

      cursorRef.current = snappedAt(e.clientX, e.clientY)
      requestDraw()
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [snappedAt, requestDraw])

  // Size the backing store to the device pixel ratio, or lines render blurry.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const previous = sizeRef.current

      // The viewport is centred on the canvas, so a width change would slide
      // the whole plan sideways — very visible when the inspector opens and
      // takes 288px away. Shifting the centre by half the delta keeps the
      // drawing pinned where it is on screen.
      if (previous.width > 0 && previous.height > 0) {
        const vp = viewportRef.current
        vp.center.x += (rect.width - previous.width) / (2 * vp.scale)
        vp.center.z += (rect.height - previous.height) / (2 * vp.scale)
      }

      sizeRef.current = { width: rect.width, height: rect.height }
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)

      requestDraw()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [requestDraw])

  // Repaint whenever the model changes (including edits from elsewhere).
  useEffect(() => useDesignStore.subscribe(requestDraw), [requestDraw])

  // Rooms are derived from the walls, so they are re-resolved whenever the
  // walls or the names change and never in between. The resolve walks the
  // whole wall graph — running it inside the paint would put a graph traversal
  // on every pointer move.
  // Named `roomWalls` rather than `walls` on purpose: the click handlers read
  // their own `walls` out of `getState`, and one name for two bindings is how
  // a handler ends up quietly working from the previous render.
  const roomWalls = useDesignStore((s) => s.walls)
  const roomLabels = useDesignStore((s) => s.roomLabels)
  const rooms = useMemo(
    () => resolveRooms(roomWalls, roomLabels),
    [roomWalls, roomLabels],
  )
  useEffect(() => {
    // The store subscription above has already queued a frame, but it fires
    // before React re-renders, so that frame can still be holding the previous
    // resolve. Asking for another one is what guarantees a painted result.
    roomsRef.current = rooms
    requestDraw()
  }, [rooms, requestDraw])

  // The zone grid is derived the same way and for the same reason: it takes the
  // plan's bounds in a rotated frame, which is a walk of every wall, and that
  // has no business happening inside a paint. Off means an empty array rather
  // than a null, so the paint has one shape to handle either way.
  const vastuGrid = useDesignStore((s) => s.vastuGrid)
  const northOffset = useDesignStore((s) => s.northOffset)
  const vastuCells = useMemo(
    () => (vastuGrid ? vastuZones(roomWalls, northOffset) : []),
    [vastuGrid, roomWalls, northOffset],
  )
  useEffect(() => {
    vastuRef.current = vastuCells
    requestDraw()
  }, [vastuCells, requestDraw])

  // Loose joints are derived from the walls alone and are O(endpoints^2), so
  // like the rooms they are memoised on the wall array rather than recomputed
  // inside the paint. The status bar runs the same call on the same input, so
  // the count it offers and the rings drawn here cannot disagree.
  const looseJoints = useMemo(() => findLooseJoints(roomWalls), [roomWalls])
  useEffect(() => {
    looseRef.current = looseJoints
    requestDraw()
  }, [looseJoints, requestDraw])

  // …and whenever the calibration picks change, which the store never sees.
  useEffect(() => subscribeCalibration(requestDraw), [requestDraw])

  // The traced image is decoded here rather than in the panel because the
  // canvas paints synchronously and cannot wait on a load event.
  const blueprintSrc = useDesignStore((s) => s.blueprint?.src ?? null)
  useEffect(() => {
    imageRef.current = null
    requestDraw()
    if (!blueprintSrc) return

    const image = new Image()
    let live = true
    image.onload = () => {
      if (!live) return
      imageRef.current = image

      // Frame the image the moment it appears. It is placed around the world
      // origin, but the viewport may be panned somewhere else entirely, and a
      // 27 m plan overflows the screen at any normal zoom — so a freshly
      // uploaded blueprint would land off in a corner with no obvious way back
      // to it. Fitting to its bounds puts it centred and whole on screen.
      const bp = useDesignStore.getState().blueprint
      const { width, height } = sizeRef.current
      if (bp && width > 0 && height > 0) {
        const w = bp.width * bp.metresPerPixel
        const d = bp.height * bp.metresPerPixel
        fitToBounds(
          viewportRef.current,
          { center: { x: bp.origin.x + w / 2, z: bp.origin.z + d / 2 }, width: w, depth: d },
          width,
          height,
        )
      }
      requestDraw()
    }
    image.src = blueprintSrc

    return () => {
      // A load that lands after the blueprint changed would otherwise paint
      // the old image against the new placement.
      live = false
    }
  }, [blueprintSrc, requestDraw])

  // Starting a measurement abandons any half-drawn chain, exactly as switching
  // tools does — the next click belongs to the calibration, not the wall.
  const calibrating = useDesignStore((s) => s.blueprintCalibrating)
  useEffect(() => {
    if (calibrating) endChain()
  }, [calibrating, endChain])

  // Switching tools abandons any half-drawn chain, so a pending segment cannot
  // be completed by a click meant for a different tool.
  const tool = useDesignStore((s) => s.tool)
  useEffect(() => {
    endChain()
  }, [tool, endChain])

  // When the whole design is replaced (project load, import, new), frame it.
  // A design drawn far from the origin would otherwise open on empty grid and
  // look like it failed to load.
  const viewEpoch = useDesignStore((s) => s.viewEpoch)
  useEffect(() => {
    if (viewEpoch === 0) return

    const bounds = planBounds(useDesignStore.getState().walls)
    const { width, height } = sizeRef.current
    if (bounds && width > 0 && height > 0) {
      fitToBounds(viewportRef.current, bounds, width, height)
    } else {
      viewportRef.current = createViewport()
    }
    requestDraw()
  }, [viewEpoch, requestDraw])

  useEffect(() => {
    const typingInField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return (
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.isContentEditable === true
      )
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const state = useDesignStore.getState()

      /* ── typed length, B29 ──────────────────────────────────────────────
       * Only while a chain is ACTIVE. The first click of a chain has no
       * anchor and therefore no direction, and a length with no direction is
       * not a segment — so typing before the chain starts is left alone and
       * whatever else was listening still gets the key.
       *
       * Modifier combinations are skipped so Ctrl/Cmd+Z stays undo rather
       * than becoming the digit `z`, and a focused text field always wins.
       */
      if (
        state.tool === 'wall' &&
        anchorRef.current &&
        !typingInField(e.target) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const action = keyToAction(entryRef.current, e.key)

        if (action.kind === 'update') {
          entryRef.current = { text: action.text }
          e.preventDefault()
          requestDraw()
          return
        }
        if (action.kind === 'cancel') {
          // Escape backs out of the ENTRY without ending the chain — one rung
          // above the ladder below, and the reason this block runs first.
          entryRef.current = null
          e.preventDefault()
          requestDraw()
          return
        }
        if (action.kind === 'commit') {
          const anchor = anchorRef.current
          const metres = entryLength(action.text, state.units)
          const end =
            metres === null || !cursorRef.current
              ? null
              : typedEndpoint(anchor, cursorRef.current, metres)

          if (end) {
            state.addWall(anchor, end, { provenance: provenance.manual() })
            anchorRef.current = end
            cursorRef.current = end
            snapRef.current = null
          }
          // Unparseable text is dropped rather than committed: there is no
          // sensible wall to build from "12''", and building the pointed
          // length instead would silently ignore what was typed.
          entryRef.current = null
          e.preventDefault()
          requestDraw()
          return
        }
      }

      if (e.key !== 'Escape') return
      // Escape backs out one step at a time: drop a calibration first, then
      // finish the chain, and only clear the selection once neither is live.
      if (state.blueprintCalibrating || getCalibrationPicks().length > 0) {
        state.setBlueprintCalibrating(false)
        clearCalibrationPicks()
      } else if (anchorRef.current) endChain()
      else state.select(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [endChain, requestDraw])

  // Space held pans with any tool, the way every canvas app does it — the one
  // gesture that works the same on a mouse and a trackpad. Ignored while typing
  // in a field so the space bar still types a space.
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return (
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.isContentEditable === true
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target) || spaceRef.current) return
      spaceRef.current = true
      setSpacePanning(true)
      // Otherwise the page scrolls under the canvas on every space.
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceRef.current = false
      setSpacePanning(false)
    }
    // A lost focus never delivers keyup, which would wedge pan mode on.
    const onBlur = () => {
      spaceRef.current = false
      setSpacePanning(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  useEffect(
    () => () => {
      if (frameRef.current === null) return
      cancelAnimationFrame(frameRef.current)
      // Must reset, not just cancel: `requestDraw` treats a non-null ref as
      // "a frame is already queued". Leaving the stale id here latches that
      // guard on permanently, and the canvas never paints again after a
      // remount (StrictMode's double-mount, or any 2D↔3D toggle).
      frameRef.current = null
    },
    [],
  )

  /** Starts a pan from the current pointer, capturing the viewport centre. */
  const beginPan = (clientX: number, clientY: number) => {
    const vp = viewportRef.current
    panRef.current = { sx: clientX, sy: clientY, cx: vp.center.x, cz: vp.center.z }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.setPointerCapture(e.pointerId)

    // Middle or right button pans, matching the 3D view's right-drag pan.
    // Space + any button pans too, the universal canvas gesture — the one that
    // is actually usable on a trackpad, where a right-drag is awkward.
    if (e.button === 1 || e.button === 2 || spaceRef.current) {
      beginPan(e.clientX, e.clientY)
      return
    }
    if (e.button !== 0) return

    const { tool, blueprintCalibrating } = useDesignStore.getState()

    if (blueprintCalibrating) {
      pickCalibrationPoint(e.clientX, e.clientY)
      return
    }

    // The outline for a space no walls enclose, dragged as a rectangle.
    //
    // A rectangle rather than a polygon tool: every unenclosed space in every
    // reference drawing — porch, sitout, wash area, balcony — is rectangular,
    // it snaps to the same grid the walls do so it aligns with the building it
    // abuts, it is one undo step, and the two numbers it produces are exactly
    // the `width x length` pair the references print under the name. A polygon
    // tool needs vertex editing, close detection and partial-state undo, which
    // is drafting work (Phase 4), not this.
    if (tool === 'space') {
      spaceDragRef.current = snappedAt(e.clientX, e.clientY)
      requestDraw()
      return
    }

    if (tool === 'wall') {
      // The SAME function the pointer-move indicator used, so what is drawn
      // before the click is what the click commits. Anything else would be a
      // preview that lies.
      const { point, target } = wallPointAt(e.clientX, e.clientY, e.altKey)
      snapRef.current = target
      // A click is a pointing gesture, so it commits where it points and
      // abandons anything half-typed — the AutoCAD behaviour, and the only one
      // that does not need the user to remember which of two inputs is live.
      entryRef.current = null
      const anchor = anchorRef.current

      // A zero-length segment is rejected by the store, which is what makes the
      // second click of a double-click harmless.
      if (anchor) {
        useDesignStore
          .getState()
          .addWall(anchor, point, { provenance: provenance.manual() })
      }

      anchorRef.current = point
      cursorRef.current = point
      setIsDrawing(true)
      requestDraw()
      return
    }

    // A staircase stands in the room rather than on a wall, so it places on the
    // grid like a wall does — and on the same grid, or a flight would land
    // half a step off the walls it is boxed in by.
    if (tool === 'stair') {
      const { addStair, select } = useDesignStore.getState()
      const id = addStair(snappedAt(e.clientX, e.clientY), provenance.manual())
      select({ kind: 'stair', stairId: id })
      return
    }

    handleWallTargetedClick(tool, e.clientX, e.clientY)

    // With the Select tool the click above has done any selecting. If it did
    // not grab a piece to move, arm a pan so the same left-drag slides the mat
    // — the tool has no drag-to-draw action to collide with, so a plain drag
    // on the plan is free to mean "move around it", which is what people reach
    // for first.
    if (tool === 'select' && !dragRef.current) beginPan(e.clientX, e.clientY)
  }

  /**
   * Records one end of the known distance being measured on the blueprint.
   *
   * The raw world point is used, never the snapped one: rounding to the 0.5 m
   * grid would quantise the very measurement the scale is derived from, and on
   * an uncalibrated image a grid cell can be metres of real building.
   */
  const pickCalibrationPoint = (clientX: number, clientY: number) => {
    const picks = getCalibrationPicks()
    const point = worldAt(clientX, clientY)

    // A third click restarts rather than extends — two points is the whole
    // measurement, so there is nothing to add to.
    if (picks.length >= 2) {
      setCalibrationPicks([point])
      return
    }

    const next = [...picks, point]
    setCalibrationPicks(next)
    if (next.length === 2) {
      useDesignStore.getState().setBlueprintCalibrating(false)
    }
  }

  /**
   * Click behaviour for the tools that act on an existing wall rather than the
   * grid: select, add door, add window.
   */
  const handleWallTargetedClick = (
    // Everything the grid tools handle before this is called. Narrowed by
    // exclusion so that adding an opening type reaches `addOpening` for free,
    // and adding a grid tool is a compile error here until it is handled above.
    tool: Exclude<Tool, 'wall' | 'stair' | 'space'>,
    clientX: number,
    clientY: number,
  ) => {
    const point = worldAt(clientX, clientY)
    const { walls, select, addOpening, setTool } = useDesignStore.getState()

    // Hit tolerance is a constant number of pixels, converted to metres, so
    // targets stay equally easy to hit at every zoom level.
    const tolerance = HIT_TOLERANCE_PX / viewportRef.current.scale

    if (tool === 'select') {
      // Furniture sits inside rooms, away from walls, so testing it first
      // costs nothing and makes pieces near a wall still selectable.
      const hitFurniture = pickFurniture(
        useDesignStore.getState().furniture,
        point,
      )
      if (hitFurniture) {
        select({ kind: 'furniture', furnitureId: hitFurniture.id })
        // Remember the grab offset so the piece doesn't snap its centre to
        // the cursor the moment you start dragging it.
        dragRef.current = {
          kind: 'furniture',
          id: hitFurniture.id,
          dx: hitFurniture.position.x - point.x,
          dz: hitFurniture.position.z - point.z,
        }
        return
      }

      // Stairs sit inside rooms too, and under the furniture — so they are
      // tested straight after it, and for the same reason.
      const hitStair = pickStair(useDesignStore.getState().stairs, point)
      if (hitStair) {
        select({ kind: 'stair', stairId: hitStair.id })
        dragRef.current = {
          kind: 'stair',
          id: hitStair.id,
          dx: hitStair.position.x - point.x,
          dz: hitStair.position.z - point.z,
        }
        return
      }

      // Openings sit on top of walls and are smaller, so they win ties.
      const hitOpening = pickOpening(walls, point, tolerance)
      if (hitOpening) {
        select({
          kind: 'opening',
          wallId: hitOpening.wall.id,
          openingId: hitOpening.opening.id,
        })
        // Arm a slide along the wall. The offset keeps the door under the grab
        // point instead of jumping its centre to the cursor.
        const grab = projectOntoWall(hitOpening.wall, point)
        dragRef.current = {
          kind: 'opening',
          wallId: hitOpening.wall.id,
          openingId: hitOpening.opening.id,
          tOffset: hitOpening.opening.position - grab.t,
        }
        return
      }

      const hitWall = pickWall(walls, point, tolerance)
      if (hitWall) {
        select({ kind: 'wall', wallId: hitWall.wall.id })
        return
      }

      // Last, so everything built keeps priority: a click that has missed the
      // furniture, the openings and the walls has landed on open floor, and
      // open floor inside a loop is a space the user can name. A named zone
      // resolves to its label's id; unnamed floor keeps the clicked point, so
      // the name lands where it was pointed at rather than at the centre.
      select(roomSelectionAt(roomsRef.current, point))
      return
    }

    const target = pickWall(walls, point, tolerance)
    if (!target) {
      select(null)
      return
    }

    const openingId = addOpening(
      target.wall.id,
      tool,
      target.projection.t,
      provenance.manual(),
    )
    if (openingId) {
      select({ kind: 'opening', wallId: target.wall.id, openingId })
      // Drop back to Select so the door just placed can be nudged along the
      // wall or edited straight away. Left on the Door tool, the next click
      // dropped a second door on top of it instead of selecting this one —
      // which read as "the new door can't be changed".
      setTool('select')
    } else {
      select({ kind: 'wall', wallId: target.wall.id })
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (drag) {
      const point = worldAt(e.clientX, e.clientY)
      const store = useDesignStore.getState()

      // A door or window slides along its wall: project the cursor onto that
      // wall and set the opening's distance-from-start. The store clamps it so
      // the opening never runs off either end.
      if (drag.kind === 'opening') {
        const wall = store.walls.find((w) => w.id === drag.wallId)
        if (wall) {
          const t = projectOntoWall(wall, point).t + drag.tOffset
          store.updateOpening(drag.wallId, drag.openingId, { position: t })
        }
        return
      }

      const position = snapToGrid(
        { x: point.x + drag.dx, z: point.z + drag.dz },
        GRID_STEP[store.units].cell,
      )

      if (drag.kind === 'stair') store.updateStair(drag.id, { position })
      else store.updateFurniture(drag.id, { position })
      return
    }

    const pan = panRef.current
    if (pan) {
      const vp = viewportRef.current
      vp.center.x = pan.cx - (e.clientX - pan.sx) / vp.scale
      vp.center.z = pan.cz - (e.clientY - pan.sy) / vp.scale
    }

    // The calibration rubber-band has to track the pointer exactly, or the
    // preview would disagree with the point the click actually records.
    const { blueprintCalibrating, tool: activeTool } = useDesignStore.getState()
    if (blueprintCalibrating) {
      // The calibration rubber-band has to track the pointer exactly, or the
      // preview would disagree with the point the click actually records.
      cursorRef.current = worldAt(e.clientX, e.clientY)
      snapRef.current = null
    } else if (activeTool === 'wall') {
      const { point, target } = wallPointAt(e.clientX, e.clientY, e.altKey)
      cursorRef.current = point
      snapRef.current = target
    } else {
      cursorRef.current = snappedAt(e.clientX, e.clientY)
      snapRef.current = null
    }
    requestDraw()
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const corner = spaceDragRef.current
    if (corner) {
      spaceDragRef.current = null
      const opposite = snappedAt(e.clientX, e.clientY)
      const { nameOpenSpace, select } = useDesignStore.getState()
      // Named `balcony` to start with: it is the one `RoomType` that already
      // means an unenclosed space, so the caption reads sensibly the instant
      // the drag ends and the user retypes it in the inspector like any other
      // room. Picking a type before drawing would be a modal step for a
      // decision that is one click to change afterwards.
      const id = nameOpenSpace(
        rectangleRing(corner, opposite),
        'balcony',
        provenance.manual(),
      )
      // Null for a click rather than a drag — no outline, nothing to select.
      if (id) select({ kind: 'room', roomId: id })
      requestDraw()
    }

    panRef.current = null
    dragRef.current = null
    canvasRef.current?.releasePointerCapture(e.pointerId)
  }

  const onPointerLeave = () => {
    cursorRef.current = null
    requestDraw()
  }

  /** Accepts furniture dragged from the catalogue onto the plan. */
  const onDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const type = e.dataTransfer.getData(FURNITURE_DRAG_TYPE)
    if (!isFurnitureType(type)) return

    const { addFurniture, select } = useDesignStore.getState()
    const id = addFurniture(
      type,
      worldAt(e.clientX, e.clientY),
      provenance.manual(),
    )
    select({ kind: 'furniture', furnitureId: id })
  }

  const onDragOver = (e: React.DragEvent<HTMLCanvasElement>) => {
    if (!e.dataTransfer.types.includes(FURNITURE_DRAG_TYPE)) return
    // Without preventDefault the browser refuses the drop entirely.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 ${
          spacePanning
            ? 'cursor-grab'
            : tool === 'select' && !calibrating
              ? 'cursor-default'
              : 'cursor-crosshair'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={endChain}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onContextMenu={(e) => e.preventDefault()}
      />

      <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-slate-200 bg-white/90 px-3 py-2 text-xs text-slate-600 shadow-sm">
        {calibrating && (
          <>
            Click the two ends of a known distance on the blueprint ·{' '}
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-sans">
              Esc
            </kbd>{' '}
            to cancel
          </>
        )}
        {!calibrating && tool === 'wall' && isDrawing && (
          <>
            Click to continue the wall ·{' '}
            <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-sans">
              Esc
            </kbd>{' '}
            or double-click to finish
          </>
        )}
        {!calibrating && tool === 'wall' && !isDrawing && (
          <>Click on the grid to start drawing a wall</>
        )}
        {!calibrating && tool === 'select' && (
          <>Click to select · drag to move around · or name a room</>
        )}
        {!calibrating && tool === 'stair' && (
          <>Click where the staircase should stand</>
        )}
        {!calibrating && tool === 'space' && (
          <>
            Drag to outline a space no walls enclose — a porch, sitout or
            balcony. Name it in the panel on the right.
          </>
        )}
        {!calibrating && tool === 'door' && <>Click a wall to place a door</>}
        {!calibrating && tool === 'window' && <>Click a wall to place a window</>}
        {!calibrating && tool === 'cased' && (
          <>Click a wall to place a cased opening — no door, no window</>
        )}
        <span className="ml-2 text-slate-400">
          Scroll to move · pinch or Ctrl-scroll to zoom · Space or drag to pan
        </span>
      </div>
    </div>
  )
}
