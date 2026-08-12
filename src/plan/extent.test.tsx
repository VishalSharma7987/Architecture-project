import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FACTOR_THRESHOLD,
  ON_TARGET_TOLERANCE,
  describeDeviation,
  deviationFrom,
  extentOf,
  formatExtent,
} from './extent'
import { drawPlan } from './draw'
import { StatusBar } from '../components/StatusBar'
import { recorder } from '../test/canvasRecorder'
import { resetStore } from '../test/fixtures'
import { resolveRoomsUncached } from '../rooms/resolve'
import { parseDesign, serializeDesign } from '../persistence/schema'
import {
  useDesignStore,
  type RoomLabel,
  type Wall,
} from '../store/useDesignStore'

/**
 * B31 — a stated building size, and room dimensions on the plan.
 *
 * ── The finding ──
 * The reference plan was drawn by hand at 20.5 × 14.5 m against a 9.00 × 11.00
 * target: 299.7 m² against 99 m², every room correct in proportion and three
 * times too big. The status bar was reporting 299.7 m² the whole time and it
 * was USELESS, because nothing in the app knew what the user was aiming at.
 * Every readout was an absolute statement; a 3× error is only visible as a
 * ratio.
 *
 * ── The fixture, and why it can go red ──
 * The reference's own seven rooms, built twice: once at reference size and
 * once at 3×. **Asymmetric in SCALE ALONE** — identical topology, identical
 * room count, identical names, identical proportions. So nothing about the
 * layout can be what fires, and a check that reported the same thing for both
 * is a check that is not looking at size.
 */

const wall = (id: string, ax: number, az: number, bx: number, bz: number): Wall => ({
  id,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  height: 3,
  thickness: 0.2,
  openings: [],
  material: 'white-paint',
})

/**
 * The reference: 9.00 × 11.00 m, three bedrooms, scaled by `k`.
 *
 * Only the coordinates are multiplied — the wall count, the room count and
 * the names are identical at every scale.
 */
function referencePlan(k: number): Wall[] {
  const p = (v: number) => v * k
  return [
    // Shell.
    wall('n', p(0), p(0), p(9), p(0)),
    wall('e', p(9), p(0), p(9), p(11)),
    wall('s', p(9), p(11), p(0), p(11)),
    wall('w', p(0), p(11), p(0), p(0)),
    // Bedroom band across the top, at z = 3.5.
    wall('b1', p(0), p(3.5), p(9), p(3.5)),
    wall('b2', p(3), p(0), p(3), p(3.5)),
    wall('b3', p(6), p(0), p(6), p(3.5)),
    // Kitchen and bedroom 3 across the bottom, at z = 8.
    wall('b4', p(0), p(8), p(9), p(8)),
    wall('b5', p(3), p(8), p(3), p(11)),
    wall('b6', p(6), p(8), p(6), p(11)),
  ]
}

const REFERENCE = { width: 9, depth: 11 }

/* ─── ★ the 3x plan is flagged ───────────────────────────────────────────── */

describe('★ B31 — a plan drawn 3× too big is flagged as 3× too big', () => {
  it('★ reports on target at reference size and 3.0× over at three times it', () => {
    const atSize = extentOf(referencePlan(1))!
    const atThree = extentOf(referencePlan(3))!

    // The fixture really is asymmetric in scale alone.
    expect(referencePlan(1)).toHaveLength(referencePlan(3).length)
    expect(atSize).toEqual(REFERENCE)
    expect(atThree).toEqual({ width: 27, depth: 33 })

    const good = deviationFrom(atSize, REFERENCE)!
    expect(good.onTarget).toBe(true)
    expect(describeDeviation(good)).toBe('on target')

    const bad = deviationFrom(atThree, REFERENCE)!
    expect(bad.onTarget).toBe(false)
    expect(bad.over).toBe(true)
    expect(describeDeviation(bad)).toBe('3.0× over')
  })

  /**
   * The real numbers from the drawing that produced this session, so the
   * readout is pinned to the case it exists for rather than to a round one.
   */
  it('★ reports the drawn plan — 20.5 × 14.5 against 9 × 11 — as over', () => {
    const deviation = deviationFrom({ width: 20.5, depth: 14.5 }, REFERENCE)!

    expect(deviation.over).toBe(true)
    // sqrt((20.5/9) x (14.5/11)) = 1.73 — the factor every wall is out by.
    expect(deviation.factor).toBeCloseTo(1.733, 3)
    expect(describeDeviation(deviation)).toBe('1.7× over')
  })

  /** Under-target reads as its own size, not as a fraction to invert. */
  it('says "2.0× under", never "0.5× over"', () => {
    const half = deviationFrom({ width: 4.5, depth: 5.5 }, REFERENCE)!
    expect(half.over).toBe(false)
    expect(describeDeviation(half)).toBe('2.0× under')
  })

  /**
   * Ratio far from 1, percentage near it. Asymmetric in: the same function,
   * two magnitudes, two different FORMS — a single form would make one of
   * these unreadable, which is the argument the module states.
   */
  it('switches to a percentage inside half-again, where a factor stops reading', () => {
    const small = deviationFrom({ width: 9.7, depth: 11.9 }, REFERENCE)!
    expect(small.factor).toBeLessThan(FACTOR_THRESHOLD)
    expect(describeDeviation(small)).toBe('8% over')

    const big = deviationFrom({ width: 13.5, depth: 16.5 }, REFERENCE)!
    expect(describeDeviation(big)).toBe('1.5× over')
  })

  /**
   * The tolerance is the centreline-versus-face ambiguity, so a plan that is
   * right to within a wall thickness must not be nagged.
   */
  it('stays silent inside the measurement convention it uses', () => {
    const edge = deviationFrom(
      { width: 9 * (1 + ON_TARGET_TOLERANCE * 0.9), depth: 11 },
      REFERENCE,
    )!
    expect(edge.onTarget).toBe(true)
  })

  it('has nothing to say without walls or without a target', () => {
    expect(extentOf([])).toBeNull()
    expect(deviationFrom({ width: 9, depth: 11 }, { width: 0, depth: 11 })).toBeNull()
  })
})

/* ─── the status bar ─────────────────────────────────────────────────────── */

describe('★ B31 — the status bar says it, and only when asked', () => {
  beforeEach(() => {
    resetStore()
    useDesignStore.setState({ walls: referencePlan(3), targetExtent: null })
  })

  /**
   * ACCEPTANCE 2. Asserted as a byte-identical DOM string, in the manner of
   * B26's sheet golden: someone sketching without a target must see exactly
   * what they saw before this session.
   */
  it('★ is byte-identical with no target set', () => {
    const { container } = render(<StatusBar />)
    const withoutTarget = container.innerHTML

    expect(screen.queryByTestId('extent-check')).toBeNull()
    expect(withoutTarget).toContain('Floor area')

    // And the SAME markup once a target is set and then cleared again.
    useDesignStore.getState().setTargetExtent(REFERENCE)
    useDesignStore.getState().setTargetExtent(null)
    const { container: after } = render(<StatusBar />)
    expect(after.innerHTML).toBe(withoutTarget)
  })

  /** ACCEPTANCE 1: the actual, the target, and the factor — on the string. */
  it('★ reads the actual, the target and 3.0× over', () => {
    useDesignStore.setState({ walls: referencePlan(3), targetExtent: REFERENCE })
    useDesignStore.getState().setUnits('m')

    render(<StatusBar />)
    const check = screen.getByTestId('extent-check')

    expect(check.textContent).toContain('27.00 m × 33.00 m')
    expect(check.textContent).toContain('target 9.00 m × 11.00 m')
    expect(screen.getByTestId('extent-deviation').textContent).toBe('3.0× over')
  })

  it('says so when the plan is right', () => {
    useDesignStore.setState({ walls: referencePlan(1), targetExtent: REFERENCE })
    render(<StatusBar />)
    expect(screen.getByTestId('extent-deviation').textContent).toBe('on target')
  })
})

/* ─── ★ the caption carries the size ─────────────────────────────────────── */

describe('★ B31 — the room caption carries its dimensions', () => {
  const label = (id: string, x: number, z: number): RoomLabel => ({
    id,
    type: 'bedroom',
    anchor: { x, z },
    provenance: { source: 'manual', createdAt: '2026-08-12T00:00:00.000Z', confidence: 1 },
  })

  const draw = (walls: Wall[], labels: RoomLabel[], scale: number) => {
    const ctx = recorder({ text: true })
    drawPlan(ctx, {
      width: 900,
      height: 800,
      viewport: { center: { x: 4.5, z: 5.5 }, scale },
      walls,
      furniture: [],
      rooms: resolveRoomsUncached(walls, labels),
      selection: null,
      units: 'm',
      anchor: null,
      cursor: null,
      showCursor: false,
    })
    return ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.text ?? '')
  }

  /**
   * ★ A POSITIVE DELTA on the drawn STRING — B29's lesson, where a test that
   * could not see the text passed with the feature switched off.
   *
   * Asymmetric in: the room is 3.00 × 3.50, so its dimensions and its area
   * (10.5 m²) are different numbers in different forms. A square room would
   * let a caption showing only the area pass this.
   */
  it('★ shows 3.00 m × 3.50 m for a 3.00 × 3.50 room', () => {
    const texts = draw(referencePlan(1), [label('r1', 1.5, 1.75)], 60)

    expect(texts).toContain('3.00 m × 3.50 m')
    expect(texts).toContain('Bedroom')
  })

  /**
   * ACCEPTANCE 3's second half. A 1.5 × 2.4 bath at low zoom has room for one
   * line and nothing else — it must fall to it rather than stack three lines
   * through its own walls.
   *
   * Asymmetric in: the SAME room at two zooms. If the ladder were ignored both
   * would show the size; if the size were never added, neither would.
   *
   * ── What this can and cannot see ──
   * The recorder's `measureText` returns a CONSTANT 8 for every string, so the
   * horizontal half of the ladder cannot discriminate here and this exercises
   * the VERTICAL half only: 3 lines need 74 px of clear span, 2 need 53, 1
   * needs 32, and a 2.4 m room supplies 2.4 × scale. The zooms below are
   * chosen from those numbers rather than by trial. Said out loud so nobody
   * reads a pass here as proof that a long caption is measured for width.
   */
  it('degrades to one line in a room too small for the stack', () => {
    const bath: Wall[] = [
      wall('a', 0, 0, 1.5, 0),
      wall('b', 1.5, 0, 1.5, 2.4),
      wall('c', 1.5, 2.4, 0, 2.4),
      wall('d', 0, 2.4, 0, 0),
    ]
    const labels = [{ ...label('b1', 0.75, 1.2), type: 'toilet' as const }]

    const roomy = draw(bath, labels, 150) // 2.2 m clear x 150 = 330 px: three lines fit
    const tight = draw(bath, labels, 20) // 44 px: only one line fits

    expect(roomy.some((t) => t.includes('×'))).toBe(true)
    // Tight: no dimensions, and nothing overlapping — a name or nothing.
    expect(tight.some((t) => t.includes('×'))).toBe(false)
    expect(tight.length).toBeLessThan(roomy.length)
    // Still says WHICH room it is — the caption degraded, it did not vanish.
    expect(tight.length).toBeGreaterThan(0)
  })
})

/* ─── persistence and undo ───────────────────────────────────────────────── */

describe('B31 — the target survives a save and an undo', () => {
  beforeEach(() => resetStore())

  /** ACCEPTANCE 4. A file written before B31 has no target and must not gain one. */
  it('round-trips through the schema, and defaults to null when absent', () => {
    const saved = serializeDesign({
      walls: referencePlan(1),
      targetExtent: REFERENCE,
    } as Parameters<typeof serializeDesign>[0])
    const parsed = parseDesign(JSON.parse(JSON.stringify(saved)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.doc.targetExtent).toEqual(REFERENCE)

    const legacy = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>
    delete legacy.targetExtent
    const old = parseDesign(legacy)
    expect(old.ok).toBe(true)
    if (old.ok) expect(old.doc.targetExtent).toBeNull()
  })

  it('is refused rather than half-stated when a dimension is missing', () => {
    useDesignStore.getState().setTargetExtent({ width: 9, depth: 0 })
    expect(useDesignStore.getState().targetExtent).toBeNull()
  })

  it('is in the undo snapshot', () => {
    useDesignStore.setState({ walls: referencePlan(1) })
    useDesignStore.getState().setTargetExtent(REFERENCE)
    expect(useDesignStore.getState().targetExtent).toEqual(REFERENCE)

    useDesignStore.getState().undo()
    expect(useDesignStore.getState().targetExtent).toBeNull()
  })
})

/* ─── the extent itself ──────────────────────────────────────────────────── */

describe('B31 — formatting', () => {
  it('reads as an extent in the active unit', () => {
    expect(formatExtent(REFERENCE, 'm')).toBe('9.00 m × 11.00 m')
    expect(formatExtent(REFERENCE, 'ftin')).toContain('×')
  })
})
