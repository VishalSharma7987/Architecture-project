import { useEffect, useMemo, useRef } from 'react'
import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { useDesignStore } from '../store/useDesignStore'
import { followCameraPosition, turnToward, wrapAngle } from './avatarMotion'
import { avatarState, resetAvatarState } from './avatarState'
import {
  clampCameraDistance,
  moveWithCollisions,
  resolveCollisions,
  wallColliders,
} from './collision'
import { AVATAR, SLAB, WALK } from './config'
import { planBounds } from './wallGeometry'
import { clampDelta, dampingFactor, desiredVelocity } from './walkMotion'

type Move = 'forward' | 'back' | 'left' | 'right'

const KEY_MAP: Record<string, Move> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
}

/**
 * Radians of camera swing per pixel of mouse travel. Same rate three.js uses
 * for pointer lock, so switching between the two walk modes feels identical.
 */
const MOUSE_SENSITIVITY = 0.002

/**
 * Camera elevation limits, in radians above the neutral boom. The lower stop
 * keeps the camera off the floor and the upper one well short of overhead —
 * either extreme flips the view and loses the figure.
 */
const PITCH_MIN = -0.42
const PITCH_MAX = 1.1

/** Slightly above level, so the figure sits in frame with the floor visible. */
const PITCH_START = 0.1

/** Closest the camera is ever pulled in to the figure, in metres. */
const MIN_FOLLOW = 0.8

/** Hard floor for the camera, in metres — it must never dip under the slab. */
const MIN_CAMERA_Y = SLAB.top + 0.45

/** Below this speed the velocity is drift and the body keeps its heading. */
const HEADING_EPSILON = 1e-4

type Props = {
  onLockChange: (locked: boolean) => void
}

const clamp = (v: number, low: number, high: number) =>
  Math.min(high, Math.max(low, v))

/**
 * Third-person navigation: the mouse orbits the camera around a human figure,
 * WASD/arrows walk it relative to where the camera is looking, shift runs.
 *
 * The body turns to face the way it is travelling rather than the way the
 * camera points, so the camera can be swung round to look at the figure without
 * it pirouetting on the spot. Movement is resolved against the walls, which is
 * the difference between walking a house and drifting through it.
 */
export function ThirdPersonControls({ onLockChange }: Props) {
  const camera = useThree((s) => s.camera)
  const walls = useDesignStore((s) => s.walls)
  const setWalkMode = useDesignStore((s) => s.setWalkMode)

  const keys = useRef(new Set<Move>())
  const running = useRef(false)
  const yaw = useRef(0)
  const pitch = useRef(PITCH_START)
  const velocity = useMemo(() => new Vector3(), [])
  const desired = useMemo(() => new Vector3(), [])

  // Rebuilt only when the plan changes. Doing this per frame would re-slice
  // every wall around every door sixty times a second for an identical answer.
  const colliders = useMemo(() => wallColliders(walls), [walls])

  // Drop the figure into the middle of the layout, and put the orbit camera
  // back exactly where it was on the way out — otherwise leaving walk mode
  // leaves the view stranded wherever the walk ended.
  useEffect(() => {
    const previous = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      fov: camera instanceof PerspectiveCamera ? camera.fov : null,
    }

    // Read through `getState` rather than the subscribed `walls`, so editing a
    // wall mid-walk does not teleport the figure back to the middle of the plan.
    const current = useDesignStore.getState().walls
    const bounds = planBounds(current)
    // The centre of the plan is often the centre of an internal wall, and a
    // figure spawned inside one has no side to be pushed out toward later.
    const spawn = resolveCollisions(
      bounds?.center.x ?? 0,
      bounds?.center.z ?? 0,
      AVATAR.radius,
      wallColliders(current),
    )

    resetAvatarState(spawn.x, spawn.z)
    yaw.current = 0
    pitch.current = PITCH_START

    if (camera instanceof PerspectiveCamera) {
      camera.fov = WALK.fov
      camera.updateProjectionMatrix()
    }

    return () => {
      camera.position.copy(previous.position)
      camera.quaternion.copy(previous.quaternion)
      if (camera instanceof PerspectiveCamera && previous.fov !== null) {
        camera.fov = previous.fov
        camera.updateProjectionMatrix()
      }
    }
  }, [camera])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // When the pointer is locked the browser handles Escape itself and
      // `onUnlock` exits. This covers the other cases — lock was refused, or
      // the user pressed Walk but never clicked to lock — so Escape always
      // gets you out rather than only sometimes.
      if (e.key === 'Escape' && !document.pointerLockElement) {
        setWalkMode(false)
        return
      }

      const move = KEY_MAP[e.code]
      if (move) {
        keys.current.add(move)
        // Arrow keys would otherwise scroll the page under the canvas.
        e.preventDefault()
      }
      if (e.shiftKey) running.current = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const move = KEY_MAP[e.code]
      if (move) keys.current.delete(move)
      if (!e.shiftKey) running.current = false
    }
    // The camera orbits the figure instead of being the figure, so the pointer
    // deltas are read here rather than left to PointerLockControls to apply.
    const onMouseMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return
      yaw.current = wrapAngle(yaw.current - e.movementX * MOUSE_SENSITIVITY)
      pitch.current = clamp(
        pitch.current + e.movementY * MOUSE_SENSITIVITY,
        PITCH_MIN,
        PITCH_MAX,
      )
    }
    // Focus loss never delivers keyup, which would leave a key stuck down.
    const onBlur = () => {
      keys.current.clear()
      running.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('blur', onBlur)
    }
  }, [setWalkMode])

  useFrame((_, rawDelta) => {
    const delta = clampDelta(rawDelta)
    const held = keys.current
    const angle = yaw.current

    // A Y rotation of `angle` faces (sin, cos), the convention the whole avatar
    // stack shares — so that pair is the camera's forward on the floor plane.
    const target = desiredVelocity(Math.sin(angle), Math.cos(angle), {
      forward: held.has('forward'),
      back: held.has('back'),
      left: held.has('left'),
      right: held.has('right'),
      running: running.current,
    })

    desired.set(target.x, 0, target.z)
    velocity.lerp(desired, dampingFactor(delta))

    const fromX = avatarState.x
    const fromZ = avatarState.z
    // Swept rather than resolved at the destination: at run speed a capped
    // frame covers 0.62 m, which clears a 0.2 m wall entirely, and a body that
    // never overlaps a wall is a body nothing pushes back.
    const moved = moveWithCollisions(
      fromX,
      fromZ,
      fromX + velocity.x * delta,
      fromZ + velocity.z * delta,
      AVATAR.radius,
      colliders,
    )

    avatarState.x = moved.x
    avatarState.z = moved.z
    // Paced by the ground actually covered, not the ground asked for: that is
    // what stops the legs of a body held against a wall.
    avatarState.speed =
      delta > 0 ? Math.hypot(moved.x - fromX, moved.z - fromZ) / delta : 0
    avatarState.moving = target.x !== 0 || target.z !== 0

    // Standing still keeps the last heading, so orbiting the camera around a
    // stationary figure does not spin it to face the lens.
    if (velocity.lengthSq() > HEADING_EPSILON) {
      avatarState.heading = turnToward(
        avatarState.heading,
        Math.atan2(velocity.x, velocity.z),
        delta,
      )
    }

    const reach = AVATAR.cameraDistance * Math.cos(pitch.current)
    const rise = AVATAR.cameraDistance * Math.sin(pitch.current)
    const pulled = clampCameraDistance(
      avatarState,
      angle,
      reach,
      colliders,
      MIN_FOLLOW,
    )
    // Shortening the boom has to shorten its height by the same fraction,
    // otherwise pulling in past a wall slides the camera along the ceiling
    // instead of down toward the figure.
    const shrink = reach > 0 ? pulled / reach : 1
    const spot = followCameraPosition(
      avatarState,
      angle,
      pulled,
      Math.max(MIN_CAMERA_Y, AVATAR.cameraHeight + rise * shrink),
    )

    camera.position.set(spot.x, spot.y, spot.z)
    camera.lookAt(avatarState.x, AVATAR.lookHeight, avatarState.z)
  })

  return (
    <PointerLockControls
      // Neutered: this is here for the lock lifecycle and the click-to-lock
      // handler only. Left at its default it would also steer the camera, and
      // the orbit placed below would fight it every frame.
      pointerSpeed={0}
      onLock={() => onLockChange(true)}
      onUnlock={() => {
        onLockChange(false)
        // Escape releases the pointer; treat that as leaving walk mode so the
        // user is never stuck in a walkthrough with no way back.
        setWalkMode(false)
      }}
    />
  )
}
