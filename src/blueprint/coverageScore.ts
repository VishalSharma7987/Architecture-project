/**
 * Scoring that reasons about fragments COLLECTIVELY — B44, ADR 0007.
 *
 * ── What the old rule got wrong ──
 * `scoreWallGraphLegacy` judges every detection independently against a
 * 50%-of-the-wall rule, so a wall interrupted by a door and correctly
 * reported in two pieces scores as one miss plus one spurious. Measured on a
 * 1000 px wall: fragments of 45% + 45% — ninety per cent of the wall,
 * correctly placed, nothing invented — scored **0 matched, 2 spurious**. The
 * wall was found and the benchmark said it was not.
 *
 * ── Why one-to-many, and not grouping the detections first ──
 * Grouping detections before matching has to answer "do these two belong
 * together?" from detection geometry alone, which needs a GAP TOLERANCE —
 * and that is exactly the decision that can silently merge two real
 * collinear walls. Assigning each detection to a true wall FIRST asks an
 * easier question, and one the scorer is entitled to answer, because a
 * scorer is the thing that knows the truth.
 *
 * It also removes the need for a gap constant entirely: the gap between two
 * fragments is simply length that nothing covers, so the coverage threshold
 * accounts for it with nothing to tune. **And it needs no ground-truth
 * OPENING positions** — which matters more than it first appears, because a
 * rule that depended on them could never be run against a real drawing,
 * where no ground truth exists. This rule is not fixture-only.
 *
 * ── The three properties that stop it being permissive ──
 * 1. Each detection is assigned to AT MOST ONE wall — nearest centreline,
 *    ties on overlap then id. One fragment can never supply coverage to two
 *    walls, and an over-long detection spanning two collinear walls covers
 *    only one of them.
 * 2. Coverage is the UNION of covered intervals, never their sum, so a
 *    duplicate detection adds nothing.
 * 3. A detection lying on no wall is still spurious, exactly as before.
 */
import type { PixelSegment } from './detectWalls'
import type { TruthBox, TruthWall } from '../test/planFixture'
import type { GraphScore } from './wallGraphScore'

/**
 * How much of a true wall its fragments must collectively cover before the
 * wall counts as found.
 *
 * ── Derived from the fixture, not picked ──
 * A wall interrupted by one standard opening loses that opening's share of
 * itself: the fixture's window is 1.2 m of a 9 m wall (13%), its door 0.9 m
 * of a 7 m wall (13%). The real fragmented walls measure 86% and 87%
 * collective coverage. The hard negative — two fragments at 20% each — is
 * 40%. Anything from 0.45 to 0.85 separates them.
 *
 * The TOP of that band is chosen deliberately. A stricter threshold is the
 * safe direction for a scorer: the failure it risks is calling a real wall
 * missed, which is visible and conservative, rather than calling a wrong
 * reading correct, which is the failure that makes a benchmark lie.
 *
 * 0.8 accepts a wall with one opening in it and refuses anything missing
 * more than a fifth of itself. Drift is a test failure.
 */
export const COVERAGE_THRESHOLD = 0.8

export type CoverageScore = GraphScore & {
  /** Per wall: the union of its fragments as a fraction of its length. */
  coverage: Array<{ id: string; covered: number; fragments: number }>
}

const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

const spanOf = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a])

/** Whether a segment's body lies inside a known patch of annotation ink. */
function onBox(segment: PixelSegment, box: TruthBox, slack: number): boolean {
  const cx = (segment.x1 + segment.x2) / 2
  const cy = (segment.y1 + segment.y2) / 2
  return (
    cx >= Math.min(box.x1, box.x2) - slack &&
    cx <= Math.max(box.x1, box.x2) + slack &&
    cy >= Math.min(box.y1, box.y2) - slack &&
    cy <= Math.max(box.y1, box.y2) + slack
  )
}

type Axis = { horizontal: boolean; lo: number; hi: number; cross: number }

const axisOf = (wall: TruthWall): Axis =>
  wall.y1 === wall.y2
    ? {
        horizontal: true,
        lo: Math.min(wall.x1, wall.x2),
        hi: Math.max(wall.x1, wall.x2),
        cross: wall.y1,
      }
    : {
        horizontal: false,
        lo: Math.min(wall.y1, wall.y2),
        hi: Math.max(wall.y1, wall.y2),
        cross: wall.x1,
      }

const alongOf = (segment: PixelSegment, horizontal: boolean): [number, number] =>
  horizontal ? spanOf(segment.x1, segment.x2) : spanOf(segment.y1, segment.y2)

export function scoreWallCoverage(
  segments: PixelSegment[],
  truth: TruthWall[],
  annotation: TruthBox[],
  options: {
    tolerancePx?: number
    thicknessTolerance?: number
    coverageThreshold?: number
  } = {},
): CoverageScore {
  const tolerancePx =
    options.tolerancePx ??
    Math.max(3, Math.max(...truth.map((w) => w.thickness)) / 2 + 1)
  const thicknessTolerance = options.thicknessTolerance ?? 0.6
  const threshold = options.coverageThreshold ?? COVERAGE_THRESHOLD

  const assigned = new Map<string, PixelSegment[]>()
  const unmatched: PixelSegment[] = []

  for (const segment of segments) {
    const segHorizontal =
      Math.abs(segment.y2 - segment.y1) <= Math.abs(segment.x2 - segment.x1)

    let best: { wall: TruthWall; distance: number; shared: number } | null = null

    for (const wall of truth) {
      const axis = axisOf(wall)
      if (axis.horizontal !== segHorizontal) continue

      // On this wall's centreline, within the SAME tolerance the old rule
      // used — unchanged, so "which wall is this on" still means what it did.
      const centre = segHorizontal
        ? (segment.y1 + segment.y2) / 2
        : (segment.x1 + segment.x2) / 2
      const distance = Math.abs(centre - axis.cross)
      if (distance > tolerancePx) continue

      // Thickness compatibility, on the same relative-error basis the
      // thickness report already uses. A hairline lying along a wall's
      // centreline is not a fragment of that wall, and this is what stops
      // annotation contributing coverage.
      const error = Math.abs(segment.thickness - wall.thickness) / wall.thickness
      if (error > thicknessTolerance) continue

      const [lo, hi] = alongOf(segment, segHorizontal)
      const shared = overlap(lo, hi, axis.lo, axis.hi)
      if (shared <= 0) continue

      // Nearest centreline wins; ties on overlap, then id — so two identical
      // drawings always assign identically (L6).
      if (
        !best ||
        distance < best.distance - 1e-9 ||
        (Math.abs(distance - best.distance) <= 1e-9 &&
          (shared > best.shared + 1e-9 ||
            (Math.abs(shared - best.shared) <= 1e-9 && wall.id < best.wall.id)))
      ) {
        best = { wall, distance, shared }
      }
    }

    if (!best) {
      unmatched.push(segment)
      continue
    }
    const list = assigned.get(best.wall.id)
    if (list) list.push(segment)
    else assigned.set(best.wall.id, [segment])
  }

  const coverage = truth.map((wall) => {
    const axis = axisOf(wall)
    const length = axis.hi - axis.lo
    const fragments = assigned.get(wall.id) ?? []

    // UNION of the covered intervals, clipped to the wall. Sorting then
    // sweeping is what makes a duplicate contribute nothing.
    const intervals = fragments
      .map((s) => {
        const [lo, hi] = alongOf(s, axis.horizontal)
        return [Math.max(lo, axis.lo), Math.min(hi, axis.hi)] as [number, number]
      })
      .filter(([lo, hi]) => hi > lo)
      .sort((p, q) => p[0] - q[0])

    let covered = 0
    let cursor = -Infinity
    for (const [lo, hi] of intervals) {
      const from = Math.max(lo, cursor)
      if (hi > from) covered += hi - from
      cursor = Math.max(cursor, hi)
    }

    return {
      id: wall.id,
      covered: length > 0 ? covered / length : 0,
      fragments: fragments.length,
    }
  })

  const found = new Set(
    coverage.filter((c) => c.covered >= threshold).map((c) => c.id),
  )

  const thicknessOk = truth.filter((wall) => {
    if (!found.has(wall.id)) return false
    const fragments = assigned.get(wall.id) ?? []
    if (fragments.length === 0) return false
    // EVERY fragment must be the right thickness, not merely the first — the
    // old rule read `found[0]` and could not see a mixed pair.
    return fragments.every(
      (s) =>
        Math.abs(s.thickness - wall.thickness) / wall.thickness <= thicknessTolerance,
    )
  }).length

  /**
   * A wall reported in two PIECES is fragmented, not doubled. Doubling now
   * means genuinely overlapping duplicates — two detections covering
   * substantially the same run of the same wall.
   */
  const doubled = truth.filter((wall) => {
    const fragments = assigned.get(wall.id) ?? []
    if (fragments.length < 2) return false
    const axis = axisOf(wall)
    for (let i = 0; i < fragments.length; i++) {
      for (let j = i + 1; j < fragments.length; j++) {
        const [aLo, aHi] = alongOf(fragments[i], axis.horizontal)
        const [bLo, bHi] = alongOf(fragments[j], axis.horizontal)
        const shared = overlap(aLo, aHi, bLo, bHi)
        if (shared > Math.min(aHi - aLo, bHi - bLo) * 0.5) return true
      }
    }
    return false
  }).length

  return {
    matched: found.size,
    truth: truth.length,
    detected: segments.length,
    spurious: unmatched.length,
    onAnnotation: unmatched.filter((s) =>
      annotation.some((box) => onBox(s, box, tolerancePx)),
    ).length,
    doubled,
    thicknessOk,
    perWall: coverage.map((c) => ({
      id: c.id,
      hits: c.fragments,
      thickness: (assigned.get(c.id) ?? [])[0]?.thickness ?? null,
    })),
    coverage,
  }
}
