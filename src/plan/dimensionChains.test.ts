import { describe, expect, it } from 'vitest'
import { drawPlan } from './draw'
import {
  clearanceExtent,
  dimensionRuns,
  strokeRunInk,
} from './dimensionChains'
import { recorder, type Call } from '../test/canvasRecorder'
import { worldToScreen, type Viewport } from './viewport'
import type { Opening, Wall } from '../store/useDesignStore'

/**
 * B33 — dimension chains.
 *
 * The reference strings dimensions OUTSIDE the building — 3.00/3.00/3.00
 * across the top, 3.00/1.50/3.00/1.50 across the bottom, plus an overall per
 * axis — where the canvas had only a label per wall, thrown INSIDE the plan
 * for interior partitions.
 *
 * ── What makes each fixture able to go red ──
 * ROW (three equal rooms): the smallest plan where a chain differs from wall
 * labels at all — its partitions are 6.00 m walls whose per-wall labels can
 * never read 3.00. ASYMMETRIC (3.00/1.50/3.00/1.50, deliberately NOT equal
 * bays, and different on its two sides): a chain that mis-SORTS its stations
 * reads 3.00/3.00/1.50/1.50, one that conflates its SIDES leaks 4.50/7.50
 * into the top run, and one that mis-groups collinear stems doubles a
 * station — every one of those changes the asserted arrays, where four equal
 * bays would shrug them all off.
 */

const wall = (
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  thickness = 0.23,
  openings: Opening[] = [],
): Wall => ({
  id,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  height: 3,
  thickness,
  type: thickness > 0.17 ? 'shell' : 'partition',
  openings,
  material: 'white-paint',
})

/** Shell rectangle 9 × 6 m, centrelines on 0/9 and 0/6. */
const shellRect = () => [
  wall('n', 0, 0, 9, 0),
  wall('e', 9, 0, 9, 6),
  wall('s', 9, 6, 0, 6),
  wall('w', 0, 6, 0, 0),
]

/** Three equal rooms in a row: partitions at x = 3 and 6, wall to wall. */
const ROW: Wall[] = [
  ...shellRect(),
  wall('p1', 3, 0, 3, 6, 0.115),
  wall('p2', 6, 0, 6, 6, 0.115),
]

const VIEW: Viewport = { center: { x: 4.5, z: 3 }, scale: 44 }

const draw = (walls: Wall[]) => {
  const ctx = recorder({ text: true })
  drawPlan(ctx, {
    width: 800,
    height: 600,
    viewport: VIEW,
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

/** Every un-rotated fillText, with its text and position. */
const texts = (calls: Call[]) =>
  calls
    .filter((c) => c.op === 'fillText' && c.text !== undefined && c.args.length >= 2)
    .map((c) => ({ text: c.text as string, x: c.args[0], y: c.args[1] }))

/** The setout constants the canvas states in `CHAIN` (draw.ts). Pinned here:
 * the outside-the-building assertions are about these exact distances. */
const OFFSET_PX = 46
const TIER_PX = 24
const TEXT_GAP_PX = 3

describe('★ B33 — a three-room row produces a chain, not three wall labels', () => {
  /**
   * ★ Demonstrated red with `drawDimensionChains` disconnected from
   * `drawPlan` (the pre-B33 canvas): "expected [] to include 3" — the only
   * labels on the plan were the per-wall chips (`9m`, `6m` compact), and not
   * one full-form `3.00 m` bay label existed at any line.
   */
  it('★ strings one run of three 3.00 m bays on a shared line outside the plan', () => {
    const labels = texts(draw(ROW)).filter((t) => t.text === '3.00 m')

    // Three bays per chained side (top and bottom), grouped by line.
    const byLine = new Map<number, number>()
    for (const l of labels) byLine.set(l.y, (byLine.get(l.y) ?? 0) + 1)
    const runs = [...byLine.values()]
    expect(runs).toContain(3)

    // Top chain: all three bay labels share ONE y — a run, not three chips.
    const topY = Math.min(...labels.map((l) => l.y))
    expect(labels.filter((l) => l.y === topY)).toHaveLength(3)
  })

  /**
   * ★ The chain sits OUTSIDE `planBounds` — asserted as a coordinate, not as
   * existence. Demonstrated red the same way: "expected Infinity to be close
   * to 113.94" — with the chains disconnected there is no label above the
   * building at all.
   */
  it('★ the top chain line is set out beyond the clearance edge, above the building', () => {
    const labels = texts(draw(ROW)).filter((t) => t.text === '3.00 m')
    const topY = Math.min(...labels.map((l) => l.y))

    const boundsEdgeY = worldToScreen({ x: 0, z: 0 }, VIEW, 800, 600).y
    const clear = clearanceExtent(ROW, [])!
    const clearEdgeY = worldToScreen(clear.min, VIEW, 800, 600).y

    // Label = line − textGap, line = clearance edge − offset. Exact, so a
    // regression that halves the setout — or measures from the wrong extent —
    // moves a number rather than flipping a boolean.
    expect(topY).toBeCloseTo(clearEdgeY - OFFSET_PX - TEXT_GAP_PX, 6)
    expect(topY).toBeLessThan(boundsEdgeY)
  })

  /**
   * ★ Overall and stations are separate RUNS — the reader sees 9.00 m as the
   * extent and 3.00/3.00/3.00 as its parts, never one merged row. On the
   * shared bottom side the overall takes the next tier out. Demonstrated red
   * disconnected: "expected [] to have a length of 1" — no 9.00 m reading
   * anywhere on the canvas.
   */
  it('★ the overall is its own run, one tier beyond the bottom chain', () => {
    const runs = dimensionRuns(ROW)
    const chains = runs.filter((r) => r.kind === 'chain' && r.axis === 'x')
    const overall = runs.find((r) => r.kind === 'overall' && r.axis === 'x')

    expect(chains.map((c) => c.stations)).toEqual([
      [0, 3, 6, 9],
      [0, 3, 6, 9],
    ])
    expect(overall?.stations).toEqual([0, 9])

    const all = texts(draw(ROW))
    const overallLabel = all.filter((t) => t.text === '9.00 m')
    const bottomBays = all.filter((t) => t.text === '3.00 m')
    const bottomChainY = Math.max(...bottomBays.map((l) => l.y))
    // Exactly one overall reading on the x axis, exactly one tier further out.
    expect(overallLabel).toHaveLength(1)
    expect(overallLabel[0].y).toBeCloseTo(bottomChainY + TIER_PX, 6)
  })

  it('measures the depth overall too, on the left', () => {
    const runs = dimensionRuns(ROW)
    expect(
      runs.find((r) => r.kind === 'overall' && r.axis === 'z'),
    ).toMatchObject({ side: 'min', stations: [0, 6] })
  })
})

describe('B33 — stations are read from the geometry, per side', () => {
  /**
   * The reference's own bottom run: 3.00/1.50/3.00/1.50, deliberately NOT
   * four equal bays, and different from the top run of the same plan.
   */
  const ASYMMETRIC: Wall[] = [
    ...shellRect(),
    wall('full', 3, 0, 3, 6, 0.115), // reaches both sides
    wall('half1', 4.5, 2, 4.5, 6, 0.115), // reaches the bottom only
    wall('half2', 7.5, 2, 7.5, 6, 0.115), // reaches the bottom only
  ]

  it('strings 3.00/1.50/3.00/1.50 across the bottom and 3.00/6.00 across the top', () => {
    const runs = dimensionRuns(ASYMMETRIC)
    const top = runs.find((r) => r.axis === 'x' && r.side === 'min')
    const bottom = runs.find((r) => r.axis === 'x' && r.side === 'max')

    expect(top?.stations).toEqual([0, 3, 9])
    expect(bottom?.stations).toEqual([0, 3, 4.5, 7.5, 9])

    const bays = (stations: number[]) =>
      stations.slice(1).map((s, i) => s - stations[i])
    expect(bays(bottom!.stations)).toEqual([3, 1.5, 3, 1.5])
    expect(bays(top!.stations)).toEqual([3, 6])
  })

  it('merges two collinear stems within the join guard into one station', () => {
    const twin: Wall[] = [
      ...shellRect(),
      wall('a', 3, 4, 3, 6, 0.115),
      // 0.4 mm off the first — float noise, not a second partition.
      wall('b', 3.0004, 2, 3.0004, 6, 0.115),
    ]
    const bottom = dimensionRuns(twin).find(
      (r) => r.axis === 'x' && r.side === 'max',
    )
    expect(bottom?.stations).toHaveLength(3)
  })

  it('counts a stem stopped at the shell FACE as reaching that side', () => {
    // What a user aiming at the drawn edge produces: the stem ends half the
    // shell's thickness short of its centreline, and reads joined on screen.
    const faced: Wall[] = [...shellRect(), wall('stem', 3, 0.115, 3, 4, 0.115)]
    const top = dimensionRuns(faced).find(
      (r) => r.axis === 'x' && r.side === 'min',
    )
    expect(top?.stations).toEqual([0, 3, 9])
  })

  it('dimensions to centrelines, so the chain sums to the stated extent', () => {
    // The 230 mm shell's outer faces sit at −0.115 and 9.115; the run still
    // reads 9.00, because every number this editor states — the B31 target,
    // the areas, the status bar — is centreline-measured and the chain must
    // agree with them. Face dimensioning arrives with composite walls.
    const overall = dimensionRuns(shellRect()).find(
      (r) => r.kind === 'overall' && r.axis === 'x',
    )
    expect(overall?.stations).toEqual([0, 9])
  })

  it('a plain rectangle gets overalls only — a chain with no stations restates them', () => {
    const runs = dimensionRuns(shellRect())
    expect(runs.filter((r) => r.kind === 'chain')).toHaveLength(0)
    expect(runs.filter((r) => r.kind === 'overall')).toHaveLength(2)
  })

  it('draws nothing for no walls', () => {
    expect(dimensionRuns([])).toEqual([])
  })
})

describe('B33 — the setout clears a door swinging off the building', () => {
  it('pushes the south runs beyond the leaf, the sheet rule shared', () => {
    const doored: Wall[] = [
      ...shellRect().filter((w) => w.id !== 's'),
      wall('s', 9, 6, 0, 6, 0.23, [
        {
          id: 'd1',
          type: 'door',
          position: 4,
          width: 0.9,
          height: 2.1,
          sill: 0,
          swing: { hand: 'start', side: 'left' },
        },
      ]),
      wall('p1', 3, 0, 3, 6, 0.115),
      wall('p2', 6, 0, 6, 6, 0.115),
    ]

    const clear = clearanceExtent(doored, [])!
    // The premise first: the swing really does extend the clearance south.
    expect(clear.max.z).toBeGreaterThan(6 + 0.5)

    const labels = texts(draw(doored)).filter((t) => t.text === '3.00 m')
    const bottomY = Math.max(...labels.map((l) => l.y))
    const swingEdgeY = worldToScreen(clear.max, VIEW, 800, 600).y
    // The bottom chain's labels sit below everything the swing reaches.
    expect(bottomY).toBeGreaterThan(swingEdgeY)
  })
})

describe('B33 — strokeRunInk is one implementation, sheet call order preserved', () => {
  it('emits main line, segments in order, one stroke, then labels', () => {
    const ctx = recorder({ text: true })
    strokeRunInk(ctx, {
      a: { x: 0, y: 10 },
      b: { x: 100, y: 10 },
      segments: [
        { from: { x: 0, y: 0 }, to: { x: 0, y: 15 } },
        { from: { x: -4, y: 14 }, to: { x: 4, y: 6 } },
      ],
      labels: [
        { text: 'flat', x: 50, y: 7 },
        { text: 'turned', x: 8, y: 50, angle: -Math.PI / 2 },
      ],
    })

    expect(ctx.calls.map((c) => c.op)).toEqual([
      'beginPath',
      'moveTo',
      'lineTo',
      'moveTo',
      'lineTo',
      'moveTo',
      'lineTo',
      'stroke',
      'fillText',
      'save',
      'translate',
      'rotate',
      'fillText',
      'restore',
    ])
    // The rotated label is drawn at the local origin — position comes from
    // the translate, exactly as the sheet's left overall always did.
    expect(ctx.calls.filter((c) => c.op === 'fillText')[1].args).toEqual([0, 0])
  })
})
