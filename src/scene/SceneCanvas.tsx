import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { NoToneMapping, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { floorElevation, useDesignStore } from '../store/useDesignStore'
import { FURNITURE_DRAG_TYPE } from '../components/FurniturePanel'
import { isFurnitureType } from '../furniture/catalog'
import { CharacterAvatar } from './CharacterAvatar'
import { Building } from './Building'
import { Controls } from './Controls'
import { FrameBuilding } from './FrameBuilding'
import { Ground } from './Ground'
import { Lighting } from './Lighting'
import { ThirdPersonControls } from './ThirdPersonControls'
import { WalkControls } from './WalkControls'
import { registerSceneCanvas } from './canvasRegistry'
import { CAMERA, SLAB } from './config'

// Shown once per session: after the user has orbited, they know how, and the
// hint would only get in the way of every later trip into 3D.
let orbitHintSeen = false

/**
 * The 3D viewport. Everything inside <Canvas> is three.js; everything outside
 * it is regular DOM, so UI panels stay plain React and Tailwind.
 */
export function SceneCanvas() {
  const walkMode = useDesignStore((s) => s.walkMode)
  const walkView = useDesignStore((s) => s.walkView)
  const activeFloor = useDesignStore((s) => s.activeFloor)
  const [locked, setLocked] = useState(false)
  // Navigation is not obvious — scrolling zooms, but rotating needs a drag, and
  // on a trackpad that is easy to miss. So orbit mode gets the same kind of
  // hint the plan view has, until the user drags for themselves.
  const [showOrbitHint, setShowOrbitHint] = useState(!orbitHintSeen)

  /** Finished floor level of the storey being edited, in metres. */
  const elevation = floorElevation(activeFloor)

  const thirdPerson = walkMode && walkView === 'third'
  // The figure appears only once a walk actually starts — a person standing in
  // the middle of the room the whole time you are modelling reads as clutter.
  // "Walk as: Figure" chooses which body the walk uses; pressing Walk is what
  // brings it into the scene.
  const showFigure = thirdPerson
  // The live camera, captured on Canvas creation so DOM-level drop handling
  // (which sits outside the R3F tree) can raycast with it.
  const cameraRef = useRef<PerspectiveCamera | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Leaving walk mode by any route clears the prompt overlay's state.
  useEffect(() => {
    if (!walkMode) setLocked(false)
  }, [walkMode])

  // Retire the hint a few seconds after it appears even if the user never
  // drags — it has been read by then, and a permanent label would nag.
  useEffect(() => {
    if (!showOrbitHint) return
    const timer = window.setTimeout(dismissOrbitHint, 6000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOrbitHint])

  const dismissOrbitHint = () => {
    orbitHintSeen = true
    setShowOrbitHint(false)
  }

  // The registry hands the live canvas to the PNG export, which runs outside
  // the R3F tree. Clearing it on unmount stops the export writing a snapshot
  // of a WebGL context that has already been torn down.
  useEffect(() => () => registerSceneCanvas(null), [])

  /** Drops furniture where the cursor meets the floor plane. */
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const type = event.dataTransfer.getData(FURNITURE_DRAG_TYPE)
    const camera = cameraRef.current
    const wrap = wrapRef.current
    if (!isFurnitureType(type) || !camera || !wrap) return

    const rect = wrap.getBoundingClientRect()
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )

    const raycaster = new Raycaster()
    raycaster.setFromCamera(ndc, camera)

    // Intersect the floor plane directly rather than the slab mesh: the drop
    // should work over open ground too, and the plane always has a hit unless
    // the camera is looking at the horizon. The plane sits at the open storey's
    // level, so dropping onto a first floor lands where the cursor is rather
    // than somewhere out on the ground beyond the building.
    const hit = new Vector3()
    const floor = new Plane(new Vector3(0, 1, 0), -(elevation + SLAB.top))
    if (!raycaster.ray.intersectPlane(floor, hit)) return

    const { addFurniture, select } = useDesignStore.getState()
    select({
      kind: 'furniture',
      furnitureId: addFurniture(type, { x: hit.x, z: hit.z }),
    })
  }

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(FURNITURE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <Canvas
        shadows
        // Cap the pixel ratio at 2 — beyond that the extra pixels cost frames
        // without a visible gain on retina displays.
        dpr={[1, 2]}
        // R3F defaults to ACES filmic tone mapping, which is built for photographic
        // HDR content and desaturates these flat UI-ish colours into grey. The
        // lighting in <Lighting /> is tuned to sum to ~1 on the floor instead.
        // `preserveDrawingBuffer` keeps the rendered frame readable after the
        // draw call, which is what lets "Export 3D view" produce an image
        // rather than a blank PNG. It costs a little memory, nothing else.
        gl={{
          antialias: true,
          toneMapping: NoToneMapping,
          preserveDrawingBuffer: true,
        }}
        camera={{
          position: [...CAMERA.position],
          fov: CAMERA.fov,
          near: CAMERA.near,
          far: CAMERA.far,
        }}
        // Fires when a click hits nothing in the scene — clicking empty space
        // clears the selection, as it does in the plan view.
        onPointerMissed={() => useDesignStore.getState().select(null)}
        onCreated={({ camera, gl }) => {
          cameraRef.current = camera as PerspectiveCamera
          registerSceneCanvas(gl.domElement)
        }}
      >
        <color attach="background" args={['#f7f8fa']} />

        <Lighting />
        <Ground />
        <Building />

        {/* The figure stands on the storey being edited, for the same reason
            its furniture does. The walk cameras are still anchored to ground
            level, so a walkthrough of an upper floor is not yet honest. */}
        {showFigure && (
          <group position={[0, elevation, 0]}>
            <CharacterAvatar />
          </group>
        )}

        {/* Exactly one control scheme is mounted at a time; each grabs the
            same pointer events and they would fight if they overlapped.
            Dismiss the hint the moment the user actually starts navigating —
            OrbitControls' own start event, not a bubbled pointerdown, which
            fires spuriously as the canvas settles. */}
        {!walkMode && <Controls onStart={showOrbitHint ? dismissOrbitHint : undefined} />}
        {walkMode && !thirdPerson && <WalkControls onLockChange={setLocked} />}
        {thirdPerson && <ThirdPersonControls onLockChange={setLocked} />}

        {/* Frames the building for orbit; must sit AFTER Controls so the
            OrbitControls instance it targets already exists. */}
        {!walkMode && <FrameBuilding />}
      </Canvas>

      {!walkMode && showOrbitHint && (
        <div
          // z-10 like the compass and the structure banner: without an explicit
          // layer the WebGL canvas composites over a plain sibling, so the hint
          // renders but never shows.
          className="pointer-events-none absolute bottom-5 left-1/2 z-10 -translate-x-1/2"
          data-testid="orbit-hint"
        >
          {/* Dark, like the walk hint: a white pill washes out against the
              near-white 3D background. */}
          <div className="rounded-lg bg-slate-900/85 px-4 py-2 text-xs text-slate-200 shadow-lg backdrop-blur">
            <span className="font-semibold text-white">Drag</span> to rotate
            around the building ·{' '}
            <span className="font-semibold text-white">Scroll</span> to zoom ·{' '}
            <span className="font-semibold text-white">Right-drag</span> to pan
          </div>
        </div>
      )}

      {walkMode && !locked && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg bg-slate-900/85 px-5 py-3 text-center text-sm text-white shadow-lg">
            <p className="font-medium">
              {thirdPerson ? 'Click to take control' : 'Click to look around'}
            </p>
            <p className="mt-1 text-xs text-slate-300">
              {thirdPerson ? 'Mouse to steer · ' : ''}WASD to move · Shift to run ·{' '}
              <kbd className="rounded border border-slate-500 px-1">Esc</kbd> to
              exit
            </p>
          </div>
        </div>
      )}

      {walkMode && locked && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-1.5 w-1.5 rounded-full bg-slate-900/60 ring-1 ring-white/70" />
        </div>
      )}
    </div>
  )
}
