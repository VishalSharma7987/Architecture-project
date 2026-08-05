import { useEffect, useMemo, useRef } from 'react'
import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import { useDesignStore } from '../store/useDesignStore'
import { avatarState } from './avatarState'
import { WALK } from './config'
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

type Props = {
  onLockChange: (locked: boolean) => void
}

/**
 * First-person navigation: mouse look via pointer lock, WASD/arrows to move,
 * shift to run.
 *
 * Movement is horizontal only — looking up does not fly you upward — and eye
 * height is pinned, so this walks the plan rather than free-floating through it.
 */
export function WalkControls({ onLockChange }: Props) {
  const camera = useThree((s) => s.camera)
  const setWalkMode = useDesignStore((s) => s.setWalkMode)

  const keys = useRef(new Set<Move>())
  const running = useRef(false)
  const velocity = useMemo(() => new Vector3(), [])
  const forward = useMemo(() => new Vector3(), [])
  const desired = useMemo(() => new Vector3(), [])

  // Drop the walker into the middle of the layout at eye height, and put the
  // orbit camera back exactly where it was on the way out — otherwise leaving
  // walk mode leaves the view stranded wherever the walk ended.
  useEffect(() => {
    const previous = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      fov: camera instanceof PerspectiveCamera ? camera.fov : null,
    }

    const bounds = planBounds(useDesignStore.getState().walls)
    camera.position.set(
      bounds?.center.x ?? 0,
      WALK.eyeHeight,
      bounds?.center.z ?? 0,
    )
    camera.rotation.set(0, 0, 0)

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
    // Focus loss never delivers keyup, which would leave a key stuck down.
    const onBlur = () => {
      keys.current.clear()
      running.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [setWalkMode])

  useFrame((_, rawDelta) => {
    const delta = clampDelta(rawDelta)
    const held = keys.current

    camera.getWorldDirection(forward)

    const target = desiredVelocity(forward.x, forward.z, {
      forward: held.has('forward'),
      back: held.has('back'),
      left: held.has('left'),
      right: held.has('right'),
      running: running.current,
    })

    desired.set(target.x, 0, target.z)
    velocity.lerp(desired, dampingFactor(delta))

    camera.position.addScaledVector(velocity, delta)
    // Pinning height keeps this a walk: looking up must not lift you off it.
    camera.position.y = WALK.eyeHeight

    // First-person has no body, but the doors still need to know where the
    // walker is — otherwise they open for the figure and ignore the eyes.
    avatarState.x = camera.position.x
    avatarState.z = camera.position.z
  })

  return (
    <PointerLockControls
      onLock={() => onLockChange(true)}
      onUnlock={() => {
        onLockChange(false)
        // Escape releases the pointer; treat that as leaving walk mode so the
        // user is never stuck in a first-person view with no way back.
        setWalkMode(false)
      }}
    />
  )
}
