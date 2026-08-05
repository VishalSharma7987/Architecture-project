/**
 * A one-slot registry holding the live WebGL canvas.
 *
 * The renderer lives inside react-three-fiber, but exporting an image is
 * plain DOM work triggered from the toolbar. Rather than thread a ref through
 * unrelated components, the scene registers its canvas here on mount and
 * clears it on unmount.
 *
 * The canvas must be created with `preserveDrawingBuffer: true`, otherwise the
 * drawing buffer is cleared as soon as the frame is composited and `toBlob`
 * hands back a blank (or fully transparent) image. That flag is set where the
 * <Canvas> is declared, in SceneCanvas.tsx.
 */
let sceneCanvas: HTMLCanvasElement | null = null

/** Called by the 3D scene on mount, and with null on unmount. */
export function registerSceneCanvas(canvas: HTMLCanvasElement | null): void {
  sceneCanvas = canvas
}

/** The live WebGL canvas, or null when no 3D scene is mounted. */
export function getSceneCanvas(): HTMLCanvasElement | null {
  return sceneCanvas
}
