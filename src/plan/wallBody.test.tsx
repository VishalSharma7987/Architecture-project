import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { drawPlan } from './draw'
import { renderPlanSheet } from './planSheet'
import { createViewport } from './viewport'
import {
  GLAZING_INSET_RATIO,
  glazingLines,
  sharedEnds,
  wallBodyQuad,
} from './wallBody'
import { pointAlongWall, wallAxis } from '../scene/wallGeometry'
import { recorder, type Call } from '../test/canvasRecorder'
import type { Opening, Point, Wall } from '../store/useDesignStore'

/**
 * B26 — the canvas gets the wall body the PDF sheet already had.
 *
 * ── What was wrong ──
 * STATE.md's three-renderer finding. `plan/draw.ts` stroked a butt-capped
 * centreline and dropped a 2.5 px dot on every vertex to hide the square notch
 * two butting walls leave at a corner; `plan/planSheet.ts` filled a mitred
 * poché quad with real faces. The user saw the WORST renderer while drawing and
 * the BEST one only after exporting a PDF.
 *
 * ── Demonstrated red (SD5) ──
 * The ★ test below could not be written before the change, and that IS the
 * finding rather than an obstacle to it. Against the pre-B26 canvas the
 * recorded calls for one wall are
 *
 *   beginPath · moveTo · lineTo · stroke
 *
 * — a two-point stroke path with no quad in it at all. `quadsFromCalls` finds
 * ZERO wall bodies, and the assertion fails with
 *
 *   expected [] to have a length of 6 but got +0
 *
 * There is nothing to compare a quad TO. The sheet's four corners and the
 * canvas's two endpoints are not two versions of one shape; they are two
 * different shapes, which is what "three fidelity levels with no shared code"
 * means when you try to assert it.
 *
 * ── The other four, each broken deliberately and measured ──
 * | dropping the half-thickness pad | `expected 1.1999… to be close to 1.2400…` — 0.04 m² of wall, which is the two pads on that partition |
 * | nudging the sheet's glazing inset 0.45 → 0.46 | `expected [ …204 ] to deeply equal [ …204 ]` |
 * | canvas glazing back to one centre line | `expected 1 to be 2` |
 * | restoring the 2.5 px vertex dot | `expected [ { op: 'arc' }, …3 ] to have a length of +0 but got 4` |
 *
 * ── And the rule about fixtures ──
 * A fixture SYMMETRIC in the property under test cannot test it (SD25). Every
 * plan below carries a NON-90° wall, because a square-only plan cannot tell a
 * half-thickness pad from any other pad — the notch it fills is the same shape
 * from every direction.
 */

/* ─── fixtures ──────────────────────────────────────────────────────────── */

const wall = (
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  thickness = 0.2,
  openings: Opening[] = [],
): Wall => ({
  id,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  height: 3,
  thickness,
  type: 'shell' as const,
  openings,
  material: 'white-paint',
})

const win = (id: string, position: number): Opening => ({
  id,
  type: 'window',
  position,
  width: 1.2,
  height: 1.4,
  sill: 0.9,
})

const door = (id: string, position: number): Opening => ({
  id,
  type: 'door',
  position,
  width: 0.9,
  height: 2.1,
  sill: 0,
  swing: { hand: 'start', side: 'left' },
})

/**
 * The plan the committed golden was captured from, at the commit BEFORE the
 * extraction. Six walls, two windows, two doors — and `ob` runs at 39.8°, so
 * the pad geometry is asymmetric in the property under test.
 */
const L_JOIN_PLAN: Wall[] = [
  wall('n', 0, 0, 6, 0, 0.2, [win('w1', 1.5), win('w2', 4.5)]),
  wall('e', 6, 0, 6, 4),
  wall('s', 6, 4, 0, 4, 0.2, [door('d1', 3)]),
  wall('w', 0, 4, 0, 0),
  wall('p', 3, 0, 3, 4, 0.115, [door('d2', 2)]),
  wall('ob', 0, 4, 3, 6.5, 0.15),
]

/* ─── reading quads back out of a recorded path ─────────────────────────── */

/**
 * Every closed four-point path that was FILLED, as its four corners.
 *
 * Deliberately structural rather than a count: a test that asserted "six fills
 * happened" would pass against six fills of the wrong shape, and this project
 * has now found ten tests that were green while proving nothing.
 */
function quadsFromCalls(calls: Call[]): Point[][] {
  const quads: Point[][] = []
  let path: Point[] = []
  let closed = false

  for (const call of calls) {
    if (call.op === 'beginPath') {
      path = []
      closed = false
    } else if (call.op === 'moveTo' || call.op === 'lineTo') {
      path.push({ x: call.args[0], z: call.args[1] })
    } else if (call.op === 'closePath') {
      closed = true
    } else if (call.op === 'fill' && closed && path.length === 4) {
      quads.push(path)
      path = []
      closed = false
    }
  }
  return quads
}

function canvasCalls(walls: Wall[]): Call[] {
  const ctx = recorder()
  drawPlan(ctx, {
    width: 800,
    height: 600,
    viewport: createViewport(),
    walls,
    furniture: [],
    rooms: [],
    selection: null,
    units: 'm',
    anchor: null,
    cursor: null,
    showCursor: false,
  })
  return ctx.calls
}

function sheetCalls(walls: Wall[]): Call[] {
  const ctx = recorder()
  renderPlanSheet(ctx, {
    walls,
    furniture: [],
    title: 'b26',
    date: '2026-08-12',
    width: 1190,
    height: 842,
  })
  return ctx.calls
}

/**
 * A quad's area by the shoelace formula, sign discarded.
 *
 * Both renderers emit corners in the same rotational order, but the sheet's
 * projection and the canvas's differ in their y sign, so the winding differs
 * and only the magnitude is comparable.
 */
const quadArea = (q: Point[]) => {
  let sum = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]
    const b = q[(i + 1) % q.length]
    sum += a.x * b.z - b.x * a.z
  }
  return Math.abs(sum) / 2
}

/* ─── ★ one implementation, two renderers ───────────────────────────────── */

describe('★ B26 — the canvas and the sheet draw the same wall body', () => {
  /**
   * ★ THE TEST THAT MATTERS MOST.
   *
   * Asserts the WORLD geometry, not the pixels: both renderers are asked for
   * the same plan, both their outputs are read back as quads, and each quad is
   * divided by its own renderer's scale to recover metres. If either renderer
   * stopped consuming `wallBodyQuad` the two would drift and this fails.
   */
  it('★ produces six bodies of identical world area in both', () => {
    const canvasQuads = quadsFromCalls(canvasCalls(L_JOIN_PLAN))
    const allSheetQuads = quadsFromCalls(sheetCalls(L_JOIN_PLAN))

    // The sheet fills TEN quads: six bodies, then four opening punches, which
    // are also four-point filled paths. `drawWalls` states the ordering — every
    // body is laid down before any opening is punched, so that a neighbouring
    // opening can never erase a swing arc — and the count is asserted here so
    // that if punching changes shape this test says so rather than silently
    // comparing the wrong quads. The canvas punches with a stroke, so it emits
    // six.
    expect(allSheetQuads).toHaveLength(10)
    const sheetQuads = allSheetQuads.slice(0, 6)

    expect(canvasQuads).toHaveLength(6)

    // Each renderer's own uniform scale, recovered from the plan rather than
    // assumed, so this cannot pass by both being wrong in the same way.
    const canvasScale = createViewport().scale
    const sheetScale = Math.sqrt(quadArea(sheetQuads[0]) / quadArea(canvasQuads[0])) * canvasScale

    for (let i = 0; i < 6; i++) {
      const canvasM2 = quadArea(canvasQuads[i]) / canvasScale ** 2
      const sheetM2 = quadArea(sheetQuads[i]) / sheetScale ** 2
      expect(canvasM2).toBeCloseTo(sheetM2, 6)
    }
  })

  /**
   * The areas above would match if both renderers drew the same WRONG shape,
   * so the bodies are also checked against the model directly — in metres,
   * computed here rather than imported from the module under test.
   *
   * Asymmetric in: the pad. `ob` is shared at one end and free at the other,
   * so a bug that padded both ends or neither changes its area and not the
   * shell's.
   */
  it('each body measures (length + pads) x thickness in metres', () => {
    const shared = sharedEnds(L_JOIN_PLAN)
    const quads = quadsFromCalls(canvasCalls(L_JOIN_PLAN))
    const scale = createViewport().scale

    L_JOIN_PLAN.forEach((w, i) => {
      const half = w.thickness / 2
      const pads =
        (shared.has(key(w.start)) ? half : 0) + (shared.has(key(w.end)) ? half : 0)
      const expected = (wallAxis(w).length + pads) * w.thickness

      expect(quadArea(quads[i]) / scale ** 2).toBeCloseTo(expected, 6)
    })
  })
})

const key = (p: Point) => `${Math.round(p.x * 1000)}:${Math.round(p.z * 1000)}`

/* ─── the join itself ───────────────────────────────────────────────────── */

describe('★ B26 — the L-join is mitred, not butted', () => {
  /**
   * ★ Two 200 mm walls meeting at 90° leave a 100 x 100 mm square of paper
   * between their faces when both are drawn to their own centreline extent.
   * The pad fills exactly that square.
   *
   * Asserted as a POSITIVE DELTA against the unpadded computation, never as
   * "the corner looks closed" — the delta is the whole finding and its size is
   * derivable: (t/2)^2 per shared end, which is 10,000 mm^2 at t = 200 mm.
   * Note it is (t/2)^2 and NOT t^2; the brief and an earlier audit both said
   * t^2, and the measurement says otherwise.
   */
  it('★ recovers (t/2)^2 of wall per shared end — 10,000 mm² at 200 mm', () => {
    const corner: Wall[] = [wall('a', 0, 0, 3, 0), wall('b', 3, 0, 3, 3)]
    const shared = sharedEnds(corner)
    const none = new Set<string>()

    for (const w of corner) {
      const padded = quadArea([...wallBodyQuad(w, shared)!])
      const butted = quadArea([...wallBodyQuad(w, none)!])
      const gained = padded - butted

      // One shared end each, so one pad each: half the thickness by the
      // thickness = (t/2) * t. The SQUARE that was missing is (t/2)^2; the
      // other half of the gain lies inside the neighbour and overlaps it.
      expect(gained).toBeCloseTo((0.2 / 2) * 0.2, 9)
    }

    // And the union of the two bodies covers the corner square, which the two
    // butted bodies do not. Measured as an area gain over the butted pair.
    const paddedUnion = corner.reduce((a, w) => a + quadArea([...wallBodyQuad(w, shared)!]), 0)
    const buttedUnion = corner.reduce((a, w) => a + quadArea([...wallBodyQuad(w, none)!]), 0)
    expect(paddedUnion - buttedUnion).toBeCloseTo(2 * (0.2 / 2) * 0.2, 9)
  })

  /**
   * SD25. At 90° a pad along the wall axis and a pad along any other direction
   * that happens to be perpendicular to the neighbour are indistinguishable —
   * exactly the perpendicular-foot trap Session 3a fell into. This corner is
   * oblique, so only a pad taken along the wall's OWN axis gives this answer.
   */
  it('pads along the wall axis at an oblique corner, not toward the neighbour', () => {
    const oblique: Wall[] = [wall('a', 0, 0, 3, 0, 0.3), wall('b', 3, 0, 5, 3, 0.3)]
    const shared = sharedEnds(oblique)
    const quad = wallBodyQuad(oblique[0], shared)!

    // The padded end must sit half a thickness beyond the endpoint ALONG the
    // wall — at x = 3.15, z = 0 — not displaced toward the neighbour's line.
    const { length } = wallAxis(oblique[0])
    const tip = pointAlongWall(oblique[0], length + 0.15)
    expect(tip.x).toBeCloseTo(3.15, 9)
    expect(tip.z).toBeCloseTo(0, 9)

    const farCorners = [quad[1], quad[2]]
    for (const c of farCorners) {
      expect(c.x).toBeCloseTo(3.15, 9)
      expect(Math.abs(c.z)).toBeCloseTo(0.15, 9)
    }
  })

  it('does not pad a free-standing end', () => {
    const lone = [wall('a', 0, 0, 3, 0)]
    const area = quadArea([...wallBodyQuad(lone[0], sharedEnds(lone))!])
    expect(area).toBeCloseTo(3 * 0.2, 9)
  })

  it('emits nothing for a zero-length wall rather than a degenerate quad', () => {
    expect(wallBodyQuad(wall('z', 1, 1, 1, 1), new Set())).toBeNull()
  })
})

/* ─── the sheet must not have moved ─────────────────────────────────────── */

describe('★ B26 — the sheet is byte-identical', () => {
  /**
   * ★ The sheet was the ONE renderer that was already correct. B26 is a
   * refactor of it, and a silent change to it would be the worst outcome
   * available here — so its entire output is pinned call-for-call against a
   * golden captured from the commit before the extraction.
   *
   * Not a smoke test: 205 recorded calls, every number to full float
   * precision, over six walls including an oblique one, two windows and two
   * doors. It caught a real difference during the change — sharing the glazing
   * arithmetic in world space moved four y-coordinates by 2 ULPs (2.8e-14 px),
   * which is why `planSheet.ts` still computes glazing in sheet pixels and
   * shares only the ratio.
   */
  it('★ renders the golden plan exactly as it did before the extraction', () => {
    const golden = JSON.parse(
      readFileSync('src/plan/__sheet-golden.json', 'utf8'),
    ) as Call[]

    expect(sheetCalls(L_JOIN_PLAN)).toEqual(golden)
  })
})

/* ─── glazing ───────────────────────────────────────────────────────────── */

describe('★ B26 — a window reads as a window', () => {
  const glazed = [wall('n', 0, 0, 6, 0, 0.2, [win('w1', 3)])]

  /**
   * ★ Asserted as a POSITIVE DELTA against a control with no window, never as
   * "two lines were drawn". The control is the same wall carrying a CASED
   * opening — which is punched and jamb-ticked identically and draws no
   * glazing at all — so the difference is the glazing and nothing else.
   */
  it('★ draws two glazing lines where a cased opening draws none', () => {
    const cased = [
      wall('n', 0, 0, 6, 0, 0.2, [{ ...win('w1', 3), type: 'cased' as const }]),
    ]

    const lineCount = (calls: Call[]) => calls.filter((c) => c.op === 'lineTo').length

    // Two lines is four calls: moveTo/lineTo per line.
    expect(lineCount(canvasCalls(glazed)) - lineCount(canvasCalls(cased))).toBe(2)
  })

  /** The pair sits INSIDE the faces, symmetric about the centreline. */
  it('insets the pair from the faces by the shared ratio', () => {
    const [left, right] = glazingLines(glazed[0], glazed[0].openings[0])
    const inset = (0.2 / 2) * GLAZING_INSET_RATIO

    // The wall runs due east, so the offset is purely in z.
    expect(left[0].z).toBeCloseTo(-inset, 9)
    expect(right[0].z).toBeCloseTo(inset, 9)
    expect(Math.abs(left[0].z)).toBeLessThan(0.2 / 2)

    // Spanning the opening, not the wall.
    expect(left[0].x).toBeCloseTo(3 - 0.6, 9)
    expect(left[1].x).toBeCloseTo(3 + 0.6, 9)
  })

  /**
   * The sheet keeps its own sheet-pixel arithmetic to stay byte-identical, so
   * the two forms could drift apart unnoticed. This pins them together: the
   * world-space offset and the sheet's `half * RATIO` must describe the same
   * distance.
   */
  it('agrees with the sheet-space form the sheet still uses', () => {
    const w = glazed[0]
    const [left] = glazingLines(w, w.openings[0])
    const centre = pointAlongWall(w, w.openings[0].position - w.openings[0].width / 2)
    const worldOffset = Math.hypot(left[0].x - centre.x, left[0].z - centre.z)

    const sheetForm = (w.thickness / 2) * GLAZING_INSET_RATIO
    expect(worldOffset).toBeCloseTo(sheetForm, 9)
  })
})

/* ─── the dot is gone ───────────────────────────────────────────────────── */

describe('★ B26 — the vertex dot is deleted', () => {
  /**
   * The 2.5 px dot existed only to mask the notch the pad now fills. Asserted
   * as a delta in ARC calls against a control, not as the absence of a token:
   * B23's first attempt at an absence check found the vertex dots instead of
   * the swing arc it meant to count, which is how that lesson was learned.
   *
   * A door draws one arc, so a plan with a door and no dots emits exactly one.
   */
  it('draws no full circles at wall ends', () => {
    const calls = canvasCalls([wall('a', 0, 0, 3, 0), wall('b', 3, 0, 3, 3)])
    const arcs = calls.filter((c) => c.op === 'arc')
    expect(arcs).toHaveLength(0)

    // Control: the recorder DOES see arcs when something draws one.
    const withDoor = canvasCalls([wall('a', 0, 0, 3, 0, 0.2, [door('d', 1.5)])])
    expect(withDoor.filter((c) => c.op === 'arc').length).toBeGreaterThan(0)
  })
})
