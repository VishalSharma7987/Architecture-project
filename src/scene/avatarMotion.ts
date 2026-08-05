import { AVATAR, WALK } from './config'

/**
 * Arms swing less than legs. Matching them exactly reads as marching, which is
 * the single most obvious tell that a walk cycle was not tuned.
 */
const ARM_RATIO = 0.75

/** Peak rise of the body at mid-stride, in metres. */
const BOB_HEIGHT = 0.03

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

/** Limb angles for one instant of the walk cycle, in radians. */
export type StrideLimbs = {
  /** Positive swings the limb forward. Opposite limbs counter-swing. */
  leftLeg: number
  rightLeg: number
  leftArm: number
  rightArm: number
  /** Vertical offset of the body, in metres; peaks twice per cycle. */
  bob: number
}

/** The walk-cycle phase plus the limb angles it produces. */
export type Stride = StrideLimbs & {
  /** Position in the cycle, in radians, within [0, 2π). */
  phase: number
}

/** Limb angles at a given point in the 0..2π walk cycle. */
export function strideLimbs(phase: number): StrideLimbs {
  const swing = Math.sin(phase) * AVATAR.swing

  return {
    rightLeg: swing,
    leftLeg: -swing,
    // The arm opposite the forward leg goes forward, as a real walk does.
    rightArm: -swing * ARM_RATIO,
    leftArm: swing * ARM_RATIO,
    // Two peaks per cycle: the body rises once per footfall, not once per
    // stride, so the bob runs at double the phase.
    bob: Math.abs(Math.sin(phase)) * BOB_HEIGHT,
  }
}

/**
 * Advances the walk-cycle phase by the distance covered, not the time elapsed.
 *
 * `AVATAR.strideRate` is quoted at `WALK.speed`, so the cycle stretches and
 * compresses with the body's actual speed. A figure held still by a wall has
 * speed ~0 and its legs stop, instead of moonwalking on the spot.
 */
export function advanceStridePhase(
  phase: number,
  speed: number,
  delta: number,
): number {
  const cycles = (AVATAR.strideRate / WALK.speed) * speed * delta
  const next = (phase + cycles * TAU) % TAU
  return next < 0 ? next + TAU : next
}

/** The advanced phase and the limbs to pose from it. */
export function advanceStride(
  phase: number,
  speed: number,
  delta: number,
): Stride {
  const next = advanceStridePhase(phase, speed, delta)
  return { phase: next, ...strideLimbs(next) }
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
