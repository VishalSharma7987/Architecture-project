import { AVATAR } from './config'

const TAU = Math.PI * 2

/** Folds any angle into (-π, π], the range every shortest-arc test assumes. */
export function wrapAngle(angle: number): number {
  const wrapped = (angle + Math.PI) % TAU
  return wrapped < 0 ? wrapped + Math.PI : wrapped - Math.PI
}

/**
 * Damped rotation of the body's heading toward `target`, frame-rate
 * independent, always taking the shorter arc.
 *
 * Turning from 3.0 to -3.0 rad is a 0.28 rad step across the ±π seam, not a
 * 6.0 rad step the long way round — without the wrap the figure pirouettes
 * every time it crosses due south.
 */
export function turnToward(
  current: number,
  target: number,
  delta: number,
): number {
  const step = Math.min(1, AVATAR.turnSpeed * delta)
  return wrapAngle(current + wrapAngle(target - current) * step)
}

/**
 * Where the third-person camera sits: `distance` metres behind a subject
 * facing `yaw`, at `height` above the floor.
 *
 * A Y rotation of `yaw` points the figure's local +Z along (sin yaw, cos yaw),
 * so behind it is the negation of that — the same convention
 * `clampCameraDistance` marches along.
 */
export function followCameraPosition(
  subject: { x: number; z: number },
  yaw: number,
  distance: number,
  height: number,
): { x: number; y: number; z: number } {
  return {
    x: subject.x - Math.sin(yaw) * distance,
    y: height,
    z: subject.z - Math.cos(yaw) * distance,
  }
}
