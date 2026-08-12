/**
 * A recording 2D context.
 *
 * jsdom implements no canvas at all and the project takes no canvas
 * dependency, which is fine for what these tests ask: which primitives were
 * emitted, with which numbers — not how they rasterise.
 *
 * Extracted from `casedOpening.test.tsx` for B26, which needs the same
 * recorder to prove the sheet's output did not move. Two copies of it would
 * have been the same mistake B26 exists to fix, one layer down.
 */
export type Call = { op: string; args: number[] }

export function recorder(): CanvasRenderingContext2D & { calls: Call[] } {
  const calls: Call[] = []
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args: args.filter((a) => typeof a === 'number') })
    }

  const ctx = {
    calls,
    canvas: { width: 800, height: 600 },
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    rect: record('rect'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    ellipse: record('ellipse'),
    arcTo: record('arcTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    bezierCurveTo: record('bezierCurveTo'),
    stroke: record('stroke'),
    fill: record('fill'),
    clip: record('clip'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    setTransform: record('setTransform'),
    setLineDash: record('setLineDash'),
    drawImage: record('drawImage'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    measureText: () => ({ width: 8 }),
  }
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] }
}
