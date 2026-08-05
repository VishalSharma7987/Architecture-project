import type { Point } from '../store/useDesignStore'

/**
 * Maps the world floor plane (metres) onto the 2D canvas (pixels).
 *
 * `center` is the world point sitting at the middle of the canvas; `scale` is
 * pixels per metre. World +z maps to screen +y (downward), which is the usual
 * convention for a plan viewed from above.
 */
export type Viewport = {
  center: Point
  scale: number
}

export const ZOOM_LIMITS = { min: 6, max: 220 }

export const createViewport = (): Viewport => ({
  center: { x: 0, z: 0 },
  scale: 44,
})

export function worldToScreen(
  p: Point,
  vp: Viewport,
  width: number,
  height: number,
) {
  return {
    x: (p.x - vp.center.x) * vp.scale + width / 2,
    y: (p.z - vp.center.z) * vp.scale + height / 2,
  }
}

export function screenToWorld(
  sx: number,
  sy: number,
  vp: Viewport,
  width: number,
  height: number,
): Point {
  return {
    x: (sx - width / 2) / vp.scale + vp.center.x,
    z: (sy - height / 2) / vp.scale + vp.center.z,
  }
}

/** The world-space rectangle currently visible, used to bound grid drawing. */
export function visibleBounds(vp: Viewport, width: number, height: number) {
  const halfW = width / 2 / vp.scale
  const halfH = height / 2 / vp.scale
  return {
    left: vp.center.x - halfW,
    right: vp.center.x + halfW,
    top: vp.center.z - halfH,
    bottom: vp.center.z + halfH,
  }
}

/**
 * Centres and zooms the viewport so a world-space box fills the canvas with a
 * little breathing room. Mutates `vp`.
 */
export function fitToBounds(
  vp: Viewport,
  bounds: { center: Point; width: number; depth: number },
  canvasWidth: number,
  canvasHeight: number,
  padding = 1.25,
) {
  vp.center.x = bounds.center.x
  vp.center.z = bounds.center.z

  // A single wall has zero extent on one axis; fall back to the default zoom
  // rather than dividing by zero and producing an infinite scale.
  const width = Math.max(bounds.width, 0.001)
  const depth = Math.max(bounds.depth, 0.001)
  const scale = Math.min(canvasWidth / width, canvasHeight / depth) / padding

  vp.scale = Math.min(
    ZOOM_LIMITS.max,
    Math.max(ZOOM_LIMITS.min, Number.isFinite(scale) ? scale : vp.scale),
  )
}

export const snapToGrid = (p: Point, step: number): Point => ({
  x: Math.round(p.x / step) * step,
  z: Math.round(p.z / step) * step,
})

/**
 * Zooms about a fixed screen position, keeping the world point under the
 * cursor pinned there. Mutates `vp`.
 */
export function zoomAt(
  vp: Viewport,
  sx: number,
  sy: number,
  factor: number,
  width: number,
  height: number,
) {
  const before = screenToWorld(sx, sy, vp, width, height)
  vp.scale = Math.min(
    ZOOM_LIMITS.max,
    Math.max(ZOOM_LIMITS.min, vp.scale * factor),
  )
  const after = screenToWorld(sx, sy, vp, width, height)
  vp.center.x += before.x - after.x
  vp.center.z += before.z - after.z
}

export const distance = (a: Point, b: Point) =>
  Math.hypot(b.x - a.x, b.z - a.z)
