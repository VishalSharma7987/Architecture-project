/**
 * Screen-space label collision — which annotation labels may be drawn.
 *
 * ── The finding this closes (B35, finding 52 decision e) ──
 * Until B35 the only suppression in `draw.ts` was "does this label fit its
 * own wall run" — no label knew any other existed. On a real plan the
 * uncovered interior partitions crowd one region (3'3", 6'7", 9'10", 11'6"
 * in the owner's screenshots) and their labels stack. This module is the
 * missing pass: every surviving label is a rotated box in screen pixels, and
 * a box that intersects an already-accepted one is DROPPED.
 *
 * ── Dropped, not displaced ──
 * A displaced dimension points at something it does not measure, and this
 * product is for people who bill by the drawing and cannot survive a wrong
 * dimension (§0). Displacement done honestly needs a leader line, which is
 * annotation machinery (§6 v6), not a collision pass. Dropping follows the
 * rule `draw.ts` already states for a label wider than its own run: better
 * to say nothing than to stack text. What the user can still do: select the
 * wall (its dimension always draws), read the inspector, or zoom in — the
 * pass runs in screen space, so room that does not exist at this zoom exists
 * at the next one and the label returns by itself.
 *
 * ── Deterministic (L6) ──
 * Candidates arrive pre-sorted by the caller's priority and are accepted
 * greedily. Same input, same order, same survivors — no measurement of
 * "which drop is prettier", which would move labels between frames.
 */

/** A label's footprint: a rectangle centred on (cx, cy), rotated by `angle`. */
export type LabelBox = {
  cx: number
  cy: number
  w: number
  h: number
  /** Radians, the same rotation the text is painted with. */
  angle: number
}

type Vec = { x: number; y: number }

const cornersOf = (b: LabelBox): Vec[] => {
  const c = Math.cos(b.angle)
  const s = Math.sin(b.angle)
  const ex = { x: (c * b.w) / 2, y: (s * b.w) / 2 }
  const ey = { x: (-s * b.h) / 2, y: (c * b.h) / 2 }
  return [
    { x: b.cx + ex.x + ey.x, y: b.cy + ex.y + ey.y },
    { x: b.cx + ex.x - ey.x, y: b.cy + ex.y - ey.y },
    { x: b.cx - ex.x - ey.x, y: b.cy - ex.y - ey.y },
    { x: b.cx - ex.x + ey.x, y: b.cy - ex.y + ey.y },
  ]
}

/** Interval of `points` projected onto `axis`. */
const projectOnto = (points: Vec[], axis: Vec): [number, number] => {
  let lo = Infinity
  let hi = -Infinity
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y
    if (d < lo) lo = d
    if (d > hi) hi = d
  }
  return [lo, hi]
}

/**
 * Whether two rotated boxes intersect — separating axis over the four edge
 * normals. Exact for rectangles; an axis-aligned approximation would
 * over-suppress every diagonal wall's label, which is precisely the case a
 * rotated box exists to keep.
 */
export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  const ca = cornersOf(a)
  const cb = cornersOf(b)
  const axes: Vec[] = [
    { x: Math.cos(a.angle), y: Math.sin(a.angle) },
    { x: -Math.sin(a.angle), y: Math.cos(a.angle) },
    { x: Math.cos(b.angle), y: Math.sin(b.angle) },
    { x: -Math.sin(b.angle), y: Math.cos(b.angle) },
  ]
  for (const axis of axes) {
    const [aLo, aHi] = projectOnto(ca, axis)
    const [bLo, bHi] = projectOnto(cb, axis)
    if (aHi < bLo || bHi < aLo) return false
  }
  return true
}

/**
 * Greedy placement: accept each candidate, in the order given, unless its box
 * intersects an obstacle or an already-accepted box.
 *
 * The ORDER is the priority — the caller decides it (selected wall first,
 * shell over partition, longer over shorter) and this function only enforces
 * "no two survivors overlap". Obstacles are boxes that are drawn regardless
 * (the chains and overalls, the statement of record): candidates yield to
 * them, never the reverse.
 */
export function placeBoxes<T>(
  obstacles: readonly LabelBox[],
  ordered: ReadonlyArray<{ box: LabelBox; item: T }>,
): T[] {
  const taken: LabelBox[] = [...obstacles]
  const accepted: T[] = []
  for (const candidate of ordered) {
    if (taken.some((box) => boxesOverlap(box, candidate.box))) continue
    taken.push(candidate.box)
    accepted.push(candidate.item)
  }
  return accepted
}
