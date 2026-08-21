/**
 * Separating WALL STRUCTURE from ANNOTATION, after detection.
 *
 * ── Why this exists ──
 * `detectWalls.ts` decides what is a wall from LOCAL evidence: how thick a
 * band is, how long, how solid, and whether either end happens to touch
 * something. Every one of those tests looks at one band. But the things that
 * are wrongly reported as walls — a dimension line, a row of text, a
 * furniture outline — are not distinguishable from a wall locally at low
 * resolution: at 26 px/m a 115 mm partition is 3 px and a dimension line is
 * 1–2 px, and the gap between those two numbers is the entire margin the
 * thickness filter has to work with.
 *
 * They ARE distinguishable structurally. A building's walls form one large
 * connected network that encloses the plan; annotation does not:
 *
 *   - a **dimension chain** lies OUTSIDE the building envelope — that is what
 *     makes it readable, and `plan/dimensionChains.ts` emits it that way from
 *     the other direction;
 *   - **text** is a scatter of small marks connected to nothing;
 *   - **furniture** stands free INSIDE a room, touching no wall.
 *
 * So this module adds the two signals the detector does not have: the
 * building ENVELOPE, and global CONNECTIVITY.
 *
 * ── §3: this EXTENDS the detector, it does not rewrite it ──
 * `detectWalls.ts`'s four-way binarisation, its scoring, and the
 * `mergeWallFaces` → `typicalThickness` ordering are untouched (§10 rules 7
 * and 9). This runs AFTER, on the segments it produced, and can be removed
 * without changing anything upstream. The argued reason §3 asks for is the
 * measurement in STATE.md finding 59.
 *
 * ⚠ Every threshold here is derived from the segments' own geometry rather
 * than picked, because the only fixture available is synthetic and §10 rule 6
 * forbids tuning against it.
 */
import type { PixelSegment } from './detectWalls'

export type StructureReport = {
  walls: PixelSegment[]
  /** Dropped for lying outside the envelope the thick walls describe. */
  outsideEnvelope: PixelSegment[]
  /** Dropped for belonging to no structural component. */
  disconnected: PixelSegment[]
  /** The envelope used, in image pixels, or null when none could be formed. */
  envelope: { x1: number; y1: number; x2: number; y2: number } | null
}

const midX = (s: PixelSegment) => (s.x1 + s.x2) / 2
const midY = (s: PixelSegment) => (s.y1 + s.y2) / 2
const length = (s: PixelSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Distance from a point to a segment's body. */
function toSegment(px: number, py: number, s: PixelSegment): number {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - s.x1, py - s.y1)
  const t = Math.min(1, Math.max(0, ((px - s.x1) * dx + (py - s.y1) * dy) / lenSq))
  return Math.hypot(px - (s.x1 + dx * t), py - (s.y1 + dy * t))
}

/**
 * Whether two segments meet: either endpoint of one within `slack` of the
 * other's body, either way round.
 *
 * Bodies, not endpoints, because the commonest architectural join is a T —
 * a partition ending mid-span of a shell wall shares no endpoint with it.
 */
function touching(a: PixelSegment, b: PixelSegment, slack: number): boolean {
  return (
    toSegment(a.x1, a.y1, b) <= slack ||
    toSegment(a.x2, a.y2, b) <= slack ||
    toSegment(b.x1, b.y1, a) <= slack ||
    toSegment(b.x2, b.y2, a) <= slack
  )
}

/**
 * The walls, with annotation removed.
 *
 * ── The envelope comes from the THICK segments, and that ordering matters ──
 * If the envelope were taken from every detection, a dimension chain would
 * enlarge the very box that is supposed to exclude it, and a witness line
 * reaching the building would merge the chain into the structural component
 * and defeat the connectivity test too. Taking it from segments at or above
 * the MEDIAN thickness uses the shell — the thickest, longest, most
 * confidently detected thing on the page — to say where the building is.
 * Hairline annotation can never contribute to it by construction.
 */
export function structuralWalls(
  segments: PixelSegment[],
  options: { slackPx?: number } = {},
): StructureReport {
  if (segments.length === 0) {
    return { walls: [], outsideEnvelope: [], disconnected: [], envelope: null }
  }

  const thicknesses = segments.map((s) => s.thickness)
  const midThickness = median(thicknesses)
  const thick = segments.filter((s) => s.thickness >= midThickness)
  const envelopeFrom = thick.length > 0 ? thick : segments

  // Slack scales with the thickest wall: an endpoint inside a wall's own
  // drawn body is joined to it, which is `repairJoints`' argument for
  // `extendReach` and B34's for the face band, in pixels.
  const slack =
    options.slackPx ?? Math.max(2, Math.max(...thicknesses) * 0.5 + 2)

  const envelope = {
    x1: Math.min(...envelopeFrom.map((s) => Math.min(s.x1, s.x2))),
    y1: Math.min(...envelopeFrom.map((s) => Math.min(s.y1, s.y2))),
    x2: Math.max(...envelopeFrom.map((s) => Math.max(s.x1, s.x2))),
    y2: Math.max(...envelopeFrom.map((s) => Math.max(s.y1, s.y2))),
  }

  /*
   * Inside-the-envelope test, with the slack applied ONLY outward. A
   * dimension chain sits a clear margin outside the building — that margin
   * is what makes it readable — so this needs no fine tuning to separate
   * them, and it is stated in the drawing's own units rather than in pixels.
   */
  const inside: PixelSegment[] = []
  const outsideEnvelope: PixelSegment[] = []
  for (const s of segments) {
    const x = midX(s)
    const y = midY(s)
    if (
      x >= envelope.x1 - slack &&
      x <= envelope.x2 + slack &&
      y >= envelope.y1 - slack &&
      y <= envelope.y2 + slack
    ) {
      inside.push(s)
    } else {
      outsideEnvelope.push(s)
    }
  }

  if (inside.length === 0) {
    return { walls: [], outsideEnvelope, disconnected: [], envelope }
  }

  /*
   * Connectivity, over what survived the envelope. Union-find rather than a
   * walk, so the components are a property of the input and not of the order
   * it happens to be visited in (L6) — the same argument `findLooseJoints`
   * makes for the same reason.
   */
  const parent = inside.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let i = 0; i < inside.length; i++) {
    for (let j = i + 1; j < inside.length; j++) {
      if (!touching(inside[i], inside[j], slack)) continue
      const a = find(i)
      const b = find(j)
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
    }
  }

  const components = new Map<number, number[]>()
  for (let i = 0; i < inside.length; i++) {
    const root = find(i)
    const list = components.get(root)
    if (list) list.push(i)
    else components.set(root, [i])
  }

  /*
   * The structural component is the one with the most WALL LENGTH, not the
   * most segments: a row of text can out-count four shell walls and can
   * never out-measure them. Ties break on the lowest member index, so two
   * identical drawings always keep the same component (L6).
   */
  let best: number[] = []
  let bestLength = -1
  for (const members of components.values()) {
    const total = members.reduce((sum, i) => sum + length(inside[i]), 0)
    if (total > bestLength + 1e-9) {
      bestLength = total
      best = members
    }
  }

  const kept = new Set(best)
  const walls = best.map((i) => inside[i])
  const disconnected = inside.filter((_, i) => !kept.has(i))

  return { walls, outsideEnvelope, disconnected, envelope }
}
