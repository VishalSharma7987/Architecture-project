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
export type Call = { op: string; args: number[]; text?: string }

/**
 * `text: true` also records the STRING argument of `fillText`/`strokeText`.
 *
 * Off by default, and that default is load-bearing: `wallBody.test.tsx` pins
 * the PDF sheet's whole output call-for-call against a golden captured before
 * B26's extraction, and adding a key to every recorded call would break that
 * comparison — which would mean regenerating the golden, which would destroy
 * the thing it exists to prove.
 *
 * It exists because a test that could not see the strings was green while
 * proving nothing: B29's first field-visibility test passed with the field
 * switched OFF, since the typed field and the measured readout it replaces are
 * one `fillText` at the same coordinates and differ only in their text.
 */
/**
 * `measure` replaces the fixed 8 px `measureText` stub. B35's collision pass
 * suppresses labels by their MEASURED width, and at a constant 8 px almost
 * nothing collides — a suite that could not make labels wide could not make
 * the pass act, which is the B29 text-blindness lesson one axis over.
 */
export function recorder(
  options: { text?: boolean; measure?: (text: string) => number } = {},
): CanvasRenderingContext2D & { calls: Call[] } {
  const calls: Call[] = []
  const record =
    (op: string) =>
    (...args: unknown[]) => {
      const call: Call = { op, args: args.filter((a) => typeof a === 'number') }
      if (options.text) {
        const first = args.find((a) => typeof a === 'string')
        if (first !== undefined) call.text = first as string
      }
      calls.push(call)
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
    measureText: (text: string) => ({
      width: options.measure ? options.measure(text) : 8,
    }),
  }
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] }
}
