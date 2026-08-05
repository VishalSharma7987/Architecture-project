import { WALK } from './config'

export type WalkInput = {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  running: boolean
}

export type Velocity2D = { x: number; z: number }

/**
 * Target horizontal velocity, in m/s, for the held keys.
 *
 * `fx`/`fz` are the camera's forward direction flattened onto the floor. The
 * strafe axis is `forward × up`, which for a Y-up right-handed frame is
 * `(-fz, fx)` — facing -Z gives +X on the right, as expected.
 */
export function desiredVelocity(
  fx: number,
  fz: number,
  input: WalkInput,
): Velocity2D {
  const len = Math.hypot(fx, fz)
  if (len === 0) return { x: 0, z: 0 }

  const nx = fx / len
  const nz = fz / len
  const rx = -nz
  const rz = nx

  let x = 0
  let z = 0
  if (input.forward) {
    x += nx
    z += nz
  }
  if (input.back) {
    x -= nx
    z -= nz
  }
  if (input.right) {
    x += rx
    z += rz
  }
  if (input.left) {
    x -= rx
    z -= rz
  }

  // Without normalising, holding two keys would move √2 times faster than one.
  const mag = Math.hypot(x, z)
  if (mag === 0) return { x: 0, z: 0 }

  const speed = input.running ? WALK.runSpeed : WALK.speed
  return { x: (x / mag) * speed, z: (z / mag) * speed }
}

/**
 * Frame-rate independent approach factor for damping toward a target.
 * Clamped at 1 so a long frame eases fully rather than overshooting.
 */
export const dampingFactor = (delta: number) =>
  Math.min(1, WALK.damping * delta)

/** A backgrounded tab resumes with a huge delta; cap it so nobody teleports. */
export const clampDelta = (delta: number) => Math.min(delta, 0.1)
