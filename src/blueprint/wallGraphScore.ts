/**
 * ── B44: `scoreWallGraphLegacy` is the PRE-B44 rule, kept deliberately ──
 *
 * A scorer change alters the meaning of every number in every previous
 * session. Deleting the old rule would make B40-B43's matrices
 * unreproducible and their reports unauditable, so it stays, is exported,
 * and is what the historical comparison in finding 64 is computed with.
 * Nothing in the app calls it; the benchmark and the tests do.
 */
/**
 * Scoring a detected wall graph against ground truth.
 *
 * "It looks about right" is not a result. This measures the GRAPH: how many
 * true walls were matched, how many detections were spurious, whether an
 * annotation line was reported as a wall, and whether two faces of one wall
 * came back as two walls.
 *
 * Pure, and shared by the benchmark harness and the tests so a number quoted
 * in the report is the number a test asserts.
 */
import type { PixelSegment } from './detectWalls'
import type { TruthBox, TruthWall } from '../test/planFixture'

export type GraphScore = {
  /** True walls with at least one detection matched to them. */
  matched: number
  truth: number
  detected: number
  /** Detections matching no true wall. */
  spurious: number
  /** Spurious detections lying on annotation ink. */
  onAnnotation: number
  /** True walls matched by MORE than one detection — unpaired faces. */
  doubled: number
  /** Matched walls whose reported thickness is within tolerance. */
  thicknessOk: number
  /** Per-truth-wall detail, for a report that names which wall was missed. */
  perWall: Array<{ id: string; hits: number; thickness: number | null }>
}

const overlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/** A detection is AT a wall when it runs the same way, close to its centreline. */
function matches(
  segment: PixelSegment,
  wall: TruthWall,
  tolerancePx: number,
): boolean {
  const segHorizontal = Math.abs(segment.y2 - segment.y1) <= Math.abs(segment.x2 - segment.x1)
  const wallHorizontal = wall.y1 === wall.y2
  if (segHorizontal !== wallHorizontal) return false

  if (wallHorizontal) {
    const centre = (segment.y1 + segment.y2) / 2
    if (Math.abs(centre - wall.y1) > tolerancePx) return false
    const shared = overlap(
      Math.min(segment.x1, segment.x2),
      Math.max(segment.x1, segment.x2),
      Math.min(wall.x1, wall.x2),
      Math.max(wall.x1, wall.x2),
    )
    // Half the wall, so a fragment counts but a stub crossing it does not.
    return shared >= Math.abs(wall.x2 - wall.x1) * 0.5
  }

  const centre = (segment.x1 + segment.x2) / 2
  if (Math.abs(centre - wall.x1) > tolerancePx) return false
  const shared = overlap(
    Math.min(segment.y1, segment.y2),
    Math.max(segment.y1, segment.y2),
    Math.min(wall.y1, wall.y2),
    Math.max(wall.y1, wall.y2),
  )
  return shared >= Math.abs(wall.y2 - wall.y1) * 0.5
}

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

export function scoreWallGraphLegacy(
  segments: PixelSegment[],
  truth: TruthWall[],
  annotation: TruthBox[],
  options: { tolerancePx?: number; thicknessTolerance?: number } = {},
): GraphScore {
  // Half a shell thickness: a detection on the wall's own face still counts as
  // that wall, which is the honest reading — a face IS the wall, seen edge on.
  const tolerancePx =
    options.tolerancePx ?? Math.max(3, Math.max(...truth.map((w) => w.thickness)) / 2 + 1)
  const thicknessTolerance = options.thicknessTolerance ?? 0.6

  const hits = new Map<string, PixelSegment[]>()
  const unmatched: PixelSegment[] = []

  for (const segment of segments) {
    const wall = truth.find((w) => matches(segment, w, tolerancePx))
    if (!wall) {
      unmatched.push(segment)
      continue
    }
    const list = hits.get(wall.id)
    if (list) list.push(segment)
    else hits.set(wall.id, [segment])
  }

  const perWall = truth.map((wall) => {
    const found = hits.get(wall.id) ?? []
    return {
      id: wall.id,
      hits: found.length,
      thickness: found.length > 0 ? found[0].thickness : null,
    }
  })

  const thicknessOk = truth.filter((wall) => {
    const found = hits.get(wall.id)
    if (!found || found.length === 0) return false
    const error = Math.abs(found[0].thickness - wall.thickness) / wall.thickness
    return error <= thicknessTolerance
  }).length

  return {
    matched: hits.size,
    truth: truth.length,
    detected: segments.length,
    spurious: unmatched.length,
    onAnnotation: unmatched.filter((s) =>
      annotation.some((box) => onBox(s, box, tolerancePx)),
    ).length,
    doubled: [...hits.values()].filter((list) => list.length > 1).length,
    thicknessOk,
    perWall,
  }
}

/** One line, for a benchmark table. */
export const scoreLine = (score: GraphScore): string =>
  `matched ${score.matched}/${score.truth}  detected ${score.detected}  ` +
  `spurious ${score.spurious} (${score.onAnnotation} on annotation)  ` +
  `doubled ${score.doubled}  thickness-ok ${score.thicknessOk}`

// B44: the live scorer is `scoreWallCoverage` in `coverageScore.ts`. Callers
// import `scoreWallGraph` from there via this alias so the historical rule
// above stays reachable by its own name for the audit in finding 64.
export { scoreWallCoverage as scoreWallGraph } from './coverageScore'
export { COVERAGE_THRESHOLD, type CoverageScore } from './coverageScore'
