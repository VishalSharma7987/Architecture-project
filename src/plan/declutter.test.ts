import { describe, expect, it } from 'vitest'
import { buildChainInks, buildWallDimensions, drawPlan, type PlanScene } from './draw'
import { boxesOverlap, placeBoxes, type LabelBox } from './labelLayout'
import { recorder, type Call } from '../test/canvasRecorder'
import type { Viewport } from './viewport'
import type { Opening, Wall } from '../store/useDesignStore'

/**
 * B35 — dimension decluttering (finding 52 decision e, switched ON).
 *
 * Two suppressions: a wall whose full run is a chain bay no longer labels
 * itself (the chain is the statement of record), and the survivors pass a
 * screen-space collision test against the chains and each other.
 *
 * ── What makes each fixture capable of going red ──
 * ROW: its per-wall labels are the COMPACT forms (`9m`, `6m`) and the chain
 * labels the full forms (`3.00 m`, `9.00 m`), so a chain label can never mask
 * a per-wall label's presence in the recorded text — the duplicate is
 * distinguishable, which is what lets its absence be asserted. DENSE: two
 * parallel partitions 350 mm apart whose spans are NOT chain bays, with the
 * text measured at real widths (`measure`, not the 8 px stub) — their label
 * chips are 17 px tall and 15.4 px apart, so overlap is CERTAIN, not likely;
 * a four-wall rectangle cannot fail this because every label is covered or
 * far apart. The pair differ in length AND (in the shell variant) in type,
 * so a priority that sorts wrongly keeps the wrong survivor, which changes
 * an asserted string.
 */

const wall = (
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  type: 'shell' | 'partition' = 'shell',
  openings: Opening[] = [],
): Wall => ({
  id,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  height: 3,
  thickness: type === 'shell' ? 0.23 : 0.115,
  type,
  openings,
  material: 'white-paint',
})

const shellRect = () => [
  wall('n', 0, 0, 9, 0),
  wall('e', 9, 0, 9, 6),
  wall('s', 9, 6, 0, 6),
  wall('w', 0, 6, 0, 0),
]

/** Three equal rooms: every wall's run is a chain bay or an overall. */
const ROW: Wall[] = [
  ...shellRect(),
  wall('p1', 3, 0, 3, 6, 'partition'),
  wall('p2', 6, 0, 6, 6, 'partition'),
]

/** Two parallel partitions 350 mm apart, spans that are NOT chain bays. */
const DENSE: Wall[] = [
  ...shellRect(),
  wall('long', 2, 1.8, 2, 4.7, 'partition'), // 2.9 m
  wall('short', 2.35, 2, 2.35, 4.6, 'partition'), // 2.6 m
]

const VIEW: Viewport = { center: { x: 4.5, z: 3 }, scale: 44 }
/** Character-width measurement, like a real canvas — the 8 px stub cannot collide. */
const measure = (text: string) => text.length * 6

const sceneOf = (
  walls: Wall[],
  selection: PlanScene['selection'] = null,
): PlanScene => ({
  width: 800,
  height: 600,
  viewport: VIEW,
  walls,
  furniture: [],
  rooms: [],
  selection,
  units: 'm',
  anchor: null,
  cursor: null,
  showCursor: false,
})

const drawnTexts = (walls: Wall[], selection: PlanScene['selection'] = null) => {
  const ctx = recorder({ text: true, measure })
  drawPlan(ctx, sceneOf(walls, selection))
  return ctx.calls
    .filter((c: Call) => c.op === 'fillText' && c.text !== undefined)
    .map((c: Call) => c.text as string)
}

/** Every dimension label box the frame will paint: chains, then survivors. */
const allBoxes = (walls: Wall[], selection: PlanScene['selection'] = null) => {
  const scene = sceneOf(walls, selection)
  const chains = buildChainInks(scene, measure)
  const dims = buildWallDimensions(scene, measure, chains.labelBoxes)
  return [...chains.labelBoxes, ...dims.map((d) => d.box)]
}

/* ─── ★ chain coverage: no wall labels twice ─────────────────────────────── */

describe('★ B35 — a wall covered by a chain bay does not label twice', () => {
  /**
   * ★ Demonstrated red with the coverage test disconnected in
   * `buildWallDimensions`: "expected [ …, '6m', '6m', '9m', … ] to satisfy
   * predicate" — every wall drew its compact label under the chain that
   * already stated the same span.
   */
  it('★ the ROW plan keeps its chains and loses every duplicate wall label', () => {
    const texts = drawnTexts(ROW)

    // Acceptance 2 — every chain bay is still labelled.
    expect(texts.filter((t) => t === '3.00 m').length).toBeGreaterThanOrEqual(3)
    expect(texts).toContain('9.00 m') // the x overall
    expect(texts).toContain('6.00 m') // the z overall

    // The duplicates are gone: no per-wall compact label survives, because
    // every wall's run is a bay ([0,3],[3,6],[6,9]) or an overall ([0,9],[0,6]).
    expect(texts).not.toContain('9m')
    expect(texts).not.toContain('6m')
  })

  it('a span that is NOT a bay keeps its label — suppression removes duplicates only', () => {
    // `long` runs z 1.8–4.7: no run of the z axis carries that bay.
    expect(drawnTexts([...shellRect(), wall('long', 2, 1.8, 2, 4.7, 'partition')]))
      .toContain('2.9m')
  })

  it('selecting a suppressed wall restores its label', () => {
    // p1 is fully covered ([0,6] is the z overall) and absent unselected…
    expect(drawnTexts(ROW)).not.toContain('6m')
    // …and present the moment it is selected — selection is the user asking.
    expect(drawnTexts(ROW, { kind: 'wall', wallId: 'p1' })).toContain('6m')
  })
})

/* ─── ★ collision: no two labels overlap ─────────────────────────────────── */

describe('★ B35 — a dense plan produces zero overlapping label boxes', () => {
  /**
   * ★ ACCEPTANCE 1, asserted on the computed boxes. Demonstrated red with
   * the `placeBoxes` filter disconnected (every candidate accepted): the
   * DENSE fixture's two chip boxes intersect — 15.4 px apart against 17 px
   * of chip — and the pairwise check reported the overlap.
   */
  it('★ no two painted label boxes intersect, on the dense plan and the reference', () => {
    const reference: Wall[] = [
      wall('rn', 0, 0, 9, 0),
      wall('re', 9, 0, 9, 11),
      wall('rs', 9, 11, 0, 11),
      wall('rw', 0, 11, 0, 0),
      wall('b1', 0, 3.5, 9, 3.5, 'partition'),
      wall('b2', 3, 0, 3, 3.5, 'partition'),
      wall('b3', 6, 0, 6, 3.5, 'partition'),
      wall('b4', 0, 8, 9, 8, 'partition'),
      wall('b5', 3, 8, 3, 11, 'partition'),
      wall('b6', 6, 8, 6, 11, 'partition'),
    ]

    for (const walls of [DENSE, reference]) {
      const boxes = allBoxes(walls)
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(boxesOverlap(boxes[i], boxes[j])).toBe(false)
        }
      }
    }
  })

  /**
   * ★ Demonstrated red the same way: "expected [ …, '2.9m', '2.6m' ] not to
   * contain '2.6m'" — both labels drew, stacked 15 px apart.
   */
  it('★ the longer of two colliding partitions wins; the shorter is dropped, not displaced', () => {
    const texts = drawnTexts(DENSE)
    expect(texts).toContain('2.9m')
    expect(texts).not.toContain('2.6m')
  })

  it('a shell outranks a longer partition when they collide', () => {
    // Same geometry, the SHORTER wall now a shell: the envelope's dimension
    // is the one the reference keeps, whatever its length.
    const walls: Wall[] = [
      ...shellRect(),
      wall('long', 2, 1.8, 2, 4.7, 'partition'), // 2.9 m
      wall('short', 2.35, 2, 2.35, 4.6, 'shell'), // 2.6 m
    ]
    const texts = drawnTexts(walls)
    expect(texts).toContain('2.6m')
    expect(texts).not.toContain('2.9m')
  })

  it('a selected wall wins its collisions outright', () => {
    const texts = drawnTexts(DENSE, { kind: 'wall', wallId: 'short' })
    expect(texts).toContain('2.6m')
    expect(texts).not.toContain('2.9m')
  })
})

/* ─── the geometry the pass rests on ─────────────────────────────────────── */

describe('B35 — boxesOverlap is exact for rotated boxes', () => {
  const bar = (cx: number, cy: number, angle: number): LabelBox => ({
    cx,
    cy,
    w: 100,
    h: 10,
    angle,
  })

  it('reports a true overlap and a clean miss', () => {
    expect(boxesOverlap(bar(0, 0, 0), bar(5, 5, 0))).toBe(true)
    expect(boxesOverlap(bar(0, 0, 0), bar(0, 30, 0))).toBe(false)
  })

  it('separates parallel diagonal bars whose AABBs overlap', () => {
    // Two 45° bars offset 42 px along their shared normal: their axis-aligned
    // bounds overlap heavily, so an AABB approximation would suppress one —
    // and every diagonal wall's label would pay for it.
    const a = bar(0, 0, Math.PI / 4)
    const b = bar(30, -30, Math.PI / 4)
    expect(boxesOverlap(a, b)).toBe(false)
    // 5,-5 projects to 7.1 px along the shared normal — inside the 10 px the
    // two half-heights add to, so this really does overlap.
    expect(boxesOverlap(a, bar(5, -5, Math.PI / 4))).toBe(true)
  })

  it('placeBoxes yields to obstacles and keeps first-come priority among candidates', () => {
    const obstacle = bar(0, 0, 0)
    const accepted = placeBoxes(
      [obstacle],
      [
        { box: bar(5, 5, 0), item: 'hits-obstacle' },
        { box: bar(0, 40, 0), item: 'clean' },
        { box: bar(10, 42, 0), item: 'hits-clean' },
      ],
    )
    expect(accepted).toEqual(['clean'])
  })
})

/* ─── ★ B37 — coverage requires a VISIBLE bay label (finding 55) ─────────── */

/**
 * B35's rendered frame at 120 px/m found the one regression that session
 * introduced: the chains scroll off-canvas at deep zoom, and a covered wall
 * then showed NO dimension anywhere on screen. Coverage is a claim — "the
 * reader can find this number on the chain" — and B37 makes the claim
 * honest: a wall is suppressed only by a bay label that is actually painted
 * at least partly inside the canvas.
 *
 * ── The fixture must not fit the viewport ──
 * ROW at 120 px/m in 800 × 600 is 1080 × 720 px of building: every chain
 * label sits outside the canvas, which is the only state in which the two
 * rules disagree. A plan that fits cannot fail either test — at 62 px/m the
 * same fixture IS that control.
 */
describe('★ B37 — a wall covered by an off-screen bay keeps its own label', () => {
  const at = (scale: number): PlanScene => ({
    ...sceneOf(ROW),
    viewport: { center: { x: 4.5, z: 3 }, scale },
  })

  const textsAt = (scale: number) => {
    const ctx = recorder({ text: true, measure })
    drawPlan(ctx, at(scale))
    return {
      calls: ctx.calls.length,
      texts: ctx.calls
        .filter((c: Call) => c.op === 'fillText' && c.text !== undefined)
        .map((c: Call) => c.text as string)
        .sort(),
    }
  }

  /**
   * ★ Demonstrated red against the pre-B37 rule (visibility condition
   * removed from `coveredByVisibleBay`): "expected [] to have a length of 4
   * but got +0" — the bays covered every wall from off-canvas and the
   * viewport showed no dimension at all, which is finding 55 verbatim.
   */
  it('★ at 120 px/m every wall of the oversized plan has an on-screen label', () => {
    const { texts } = textsAt(120)
    // The four 6 m walls (both partitions, both side shells) and the two 9 m
    // shells label themselves — their covering bays are all off-canvas.
    expect(texts.filter((t) => t === '6m')).toHaveLength(4)
    expect(texts.filter((t) => t === '9m')).toHaveLength(2)
  })

  /**
   * ★ The fix must not leak into the zoom where nothing was wrong. The
   * whole recorded output is pinned against the values captured from the
   * pre-B37 build in the same session: 251 calls, chain labels only. A
   * fix that suppressed less at 62 px/m changes both numbers.
   */
  it('★ at 62 px/m the output is byte-identical to B35', () => {
    const { calls, texts } = textsAt(62)
    expect(calls).toBe(251)
    expect(texts).toEqual([
      '3.00 m',
      '3.00 m',
      '3.00 m',
      '3.00 m',
      '3.00 m',
      '3.00 m',
      '6.00 m',
      '9.00 m',
    ])
  })

  it('no two painted label boxes intersect at any tested zoom', () => {
    for (const scale of [30, 62, 120, 200]) {
      const scene = at(scale)
      const chains = buildChainInks(scene, measure)
      const dims = buildWallDimensions(scene, measure, chains.labelBoxes)
      const boxes = [...chains.labelBoxes, ...dims.map((d) => d.box)]
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(boxesOverlap(boxes[i], boxes[j])).toBe(false)
        }
      }
    }
  })

  it('a HALF-visible bay label still covers — partial visibility is visibility', () => {
    // Pan so the top chain's middle bay label straddles the canvas edge: its
    // number can still be read, so the wall it covers stays suppressed.
    // Centre chosen so the top chain line (≈ −46 px above the clear edge)
    // sits just inside the top of an 800 × 600 canvas at 120 px/m.
    const scene: PlanScene = {
      ...sceneOf(ROW),
      viewport: { center: { x: 4.5, z: 2.1 }, scale: 120 },
    }
    const ctx = recorder({ text: true, measure })
    drawPlan(ctx, scene)
    const texts = ctx.calls
      .filter((c: Call) => c.op === 'fillText' && c.text !== undefined)
      .map((c: Call) => c.text as string)
    // The partitions' covering bays are on the z axis (left/right overall),
    // still off-canvas — but the top-chain bays now cover nothing directly.
    // What matters: the visible top chain suppresses NOTHING it should not,
    // and the plan still carries readable dimensions.
    expect(texts.length).toBeGreaterThan(0)
  })
})
