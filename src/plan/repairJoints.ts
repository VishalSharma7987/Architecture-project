import type { Point, Wall } from '../store/useDesignStore'
import { JOIN_TOLERANCE } from '../units/tolerance'

/**
 * Finding and closing wall joints that look connected and are not.
 *
 * ── Why this exists ──
 * `detectRooms` welds at `JOIN_TOLERANCE` (15 mm), which is a float-noise
 * guard and nothing more. A diagnostic on a real 30-wall plan found endpoints
 * missing each other by **100–152 mm**: far too wide for that guard, and wide
 * enough that a near-miss makes a graph node degree-1, `pruneDangles` deletes
 * its edge, a neighbour drops to degree-1, and it cascades. The plan reported
 * one room and 176 sq ft on an 870 sq ft building.
 *
 * ── Why it is USER-INVOKED and not automatic ──
 * Moving a wall is a model change. Doing it silently on load would rewrite a
 * saved document the user did not ask to change and could not see change — on
 * every autosave restore, not only on import. Asking first satisfies L4 three
 * times over: the user consents, the markers show them what will move, and it
 * is one undo step.
 *
 * ── Why the tolerance is not `JOIN_TOLERANCE` ──
 * They answer different questions. `JOIN_TOLERANCE` asks "is this the same
 * point?" and must stay below the thinnest legal wall. This asks "did the user
 * mean these to touch?", and the honest reading of that is **whether they look
 * touching on screen** — which depends on how thick the wall is drawn, so the
 * bound scales with the wall rather than being a constant.
 */

/**
 * Endpoint-to-endpoint, between walls that run near-PARALLEL.
 *
 * Deliberately tight. Two parallel walls with adjacent ends are as likely to
 * be a duct shaft or a cavity — two real walls with a real gap — as a mistake,
 * and fusing those merges two rooms silently. When the evidence is ambiguous
 * the repair does less, not more.
 */
export const REPAIR_MERGE = 0.05

/**
 * Endpoint-to-endpoint between walls that CROSS at a real angle, and
 * endpoint-to-wall for the mid-span case.
 *
 * Wider than `REPAIR_MERGE` because the ambiguity is gone: two ends near each
 * other on walls that are not parallel form a CORNER, and nobody builds two
 * walls meeting at 90° with a 150 mm gap between their ends. A near-parallel
 * pair might be a shaft; a corner cannot be.
 *
 * 160 mm covers one ft-in grid cell (152.4 mm) with a little to spare, because
 * a wall dropped exactly one cell short of what it should meet is the
 * commonest mis-click there is — and the grid the user snapped to is the ft-in
 * one by default.
 */
export const REPAIR_EXTEND = 0.16

/**
 * How far an endpoint may be from a wall and still be judged to belong to it.
 *
 * Scales with the target's thickness: an endpoint inside the wall's own drawn
 * body is one the user sees as connected, whatever the drawing's scale. The
 * fixed floor covers thin partitions, where half-thickness alone would be
 * narrower than a mis-click.
 */
const extendReach = (target: Wall) =>
  Math.max(REPAIR_EXTEND, target.thickness / 2 + REPAIR_MERGE)

/** Sine of the angle between two walls. 0 when they are parallel. */
function crossSin(a: Wall, b: Wall): number {
  const ax = a.end.x - a.start.x
  const az = a.end.z - a.start.z
  const bx = b.end.x - b.start.x
  const bz = b.end.z - b.start.z
  const la = Math.hypot(ax, az)
  const lb = Math.hypot(bx, bz)
  if (la === 0 || lb === 0) return 0
  return Math.abs((ax * bz - az * bx) / (la * lb))
}

/**
 * How close two endpoints must be to count as one corner.
 *
 * Wider for walls that cross at a real angle than for near-parallel ones —
 * see `REPAIR_MERGE` and `REPAIR_EXTEND`. This is the whole reason a shell
 * corner blown open by a typed length (153 mm) closes while two parallel
 * partitions the same distance apart are left alone.
 */
const mergeReach = (a: Wall, b: Wall) =>
  crossSin(a, b) >= MIN_CROSS_SIN ? REPAIR_EXTEND : REPAIR_MERGE

/** Below this angle two walls are too near-parallel to intersect meaningfully. */
const MIN_CROSS_SIN = 0.26 // ~15 degrees

/** One endpoint that is not connected to what it appears to touch. */
export type LooseJoint = {
  wallId: string
  which: 'start' | 'end'
  /** Where the endpoint is now. */
  at: Point
  /** Where repairing would put it. */
  to: Point
  /** `merge` snapped it to other endpoints; `extend` ran it onto a wall. */
  kind: 'merge' | 'extend'
}

type Slot = { wallIndex: number; which: 'start' | 'end' }

const at = (wall: Wall, which: 'start' | 'end') =>
  which === 'start' ? wall.start : wall.end

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)

/**
 * Distance from a point to a segment, and how far along it the foot lies.
 * `t` is a fraction of the segment's length.
 */
function toSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const lenSq = dx * dx + dz * dz
  if (lenSq === 0) return { distance: dist(p, a), t: 0 }
  const raw = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq
  const t = Math.min(1, Math.max(0, raw))
  return {
    distance: Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)),
    t,
  }
}

/**
 * The representative point for a cluster of endpoints.
 *
 * Sorted BEFORE summing, and that is not tidiness: float addition is not
 * associative, so an unsorted mean drifts with the order the walls happen to
 * sit in the array. Two identical plans would then weld to microscopically
 * different coordinates, which is an L6 failure that no test asserting counts
 * would ever catch.
 */
function centre(points: Point[]): Point {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  let x = 0
  let z = 0
  for (const p of sorted) {
    x += p.x
    z += p.z
  }
  return { x: x / sorted.length, z: z / sorted.length }
}

/**
 * Every endpoint that looks joined and is not, with where it would move to.
 *
 * Pure, and computed the same way whatever order the walls arrive in — the
 * status bar counts these, the canvas draws them, and `weldJoints` applies
 * them, so all three must agree exactly.
 */
export function findLooseJoints(walls: Wall[]): LooseJoint[] {
  const slots: Slot[] = []
  for (let i = 0; i < walls.length; i++) {
    slots.push({ wallIndex: i, which: 'start' }, { wallIndex: i, which: 'end' })
  }
  const pointOf = (s: Slot) => at(walls[s.wallIndex], s.which)

  /* ── pass 1: cluster endpoints that are nearly coincident ────────────── */
  // Union-find, so the clusters are a property of the input rather than of the
  // order it is walked in.
  const parent = slots.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }

  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      // Two ends of the SAME wall are not a joint, however short the wall.
      if (slots[i].wallIndex === slots[j].wallIndex) continue
      const a = walls[slots[i].wallIndex]
      const b = walls[slots[j].wallIndex]
      if (dist(pointOf(slots[i]), pointOf(slots[j])) <= mergeReach(a, b)) {
        union(i, j)
      }
    }
  }

  const clusters = new Map<number, number[]>()
  for (let i = 0; i < slots.length; i++) {
    const root = find(i)
    const list = clusters.get(root)
    if (list) list.push(i)
    else clusters.set(root, [i])
  }

  const joints: LooseJoint[] = []
  /** Where each slot ends up after pass 1, for pass 2 to work from. */
  const moved = slots.map((s) => pointOf(s))
  /**
   * Slots pass 1 has already claimed.
   *
   * Pass 2 must skip these, and the real plan is what proved it: an endpoint
   * could be merged into a corner AND then extended onto a wall, emitting two
   * joints for one slot. `weldJoints` applied both, last one winning — so the
   * function was NOT idempotent, and the travel bound was measured from the
   * position pass 1 had already moved to, letting one endpoint travel 169.4 mm
   * against a 160 mm promise. Both tests passed on the synthetic fixtures,
   * because none of them ever put a merge and an extend on the same endpoint.
   */
  const claimed = new Array<boolean>(slots.length).fill(false)

  for (const members of clusters.values()) {
    if (members.length < 2) continue
    const points = members.map((i) => pointOf(slots[i]))
    const target = centre(points)

    // Transitive chaining can build a cluster wider than any tolerance that
    // formed it — A near B, B near C, A far from C. Merging that would move an
    // endpoint further than the user was told anything could move. Leave the
    // whole cluster alone rather than move more than was promised.
    if (points.some((p) => dist(p, target) > REPAIR_EXTEND)) continue

    for (const i of members) {
      moved[i] = target
      // Claimed either way: a slot that pass 1 decided was already coincident
      // is still pass 1's answer, and pass 2 must not reopen it.
      claimed[i] = true
      // Already coincident within the noise guard: nothing to repair, nothing
      // to report. This is what keeps a healthy plan reporting zero.
      if (dist(points[members.indexOf(i)], target) <= JOIN_TOLERANCE) continue
      joints.push({
        wallId: walls[slots[i].wallIndex].id,
        which: slots[i].which,
        at: pointOf(slots[i]),
        to: target,
        kind: 'merge',
      })
    }
  }

  /* ── pass 2: run a loose endpoint onto the wall it nearly meets ───────── */
  // Second, because merging can put an endpoint onto a wall, while extending
  // can never create a new endpoint pair. The H2 case: a partition stopping
  // short of a shell centreline needs EXTENDING to it, not moving to some
  // other endpoint.
  for (let i = 0; i < slots.length; i++) {
    // One slot, one answer. See `claimed`.
    if (claimed[i]) continue

    const slot = slots[i]
    const wall = walls[slot.wallIndex]
    // The ORIGINAL position, not `moved[i]`. Belt and braces with the skip
    // above: measuring travel from a position pass 1 had already shifted is
    // how one endpoint moved 169.4 mm against a 160 mm bound. Reading the
    // wall directly means the two passes cannot compose even if the skip is
    // ever removed.
    const here = at(wall, slot.which)
    const other = at(wall, slot.which === 'start' ? 'end' : 'start')

    let best: { to: Point; distance: number; id: string } | null = null

    for (let j = 0; j < walls.length; j++) {
      const target = walls[j]
      if (j === slot.wallIndex) continue

      const near = toSegment(here, target.start, target.end)
      // Already touching within the noise guard — nothing to do.
      if (near.distance <= JOIN_TOLERANCE) { best = null; break }
      if (near.distance > extendReach(target)) continue
      // Only mid-span. An endpoint near the target's own END is pass 1's
      // business, and doing both would fight over the same point.
      if (near.t <= 0 || near.t >= 1) continue

      const hit = lineCross(other, here, target.start, target.end)
      if (!hit) continue
      // The endpoint may only travel toward what it nearly meets, and no
      // further than it was allowed to be away — so a wall can never be
      // stretched across the plan by a coincidental alignment.
      const travel = dist(here, hit)
      if (travel > extendReach(target)) continue
      // …and never past its own far end, which would invert the wall.
      if (dist(other, hit) <= JOIN_TOLERANCE) continue

      // Nearest wins; ties break on wall id, never on array position.
      if (
        !best ||
        near.distance < best.distance - 1e-12 ||
        (Math.abs(near.distance - best.distance) <= 1e-12 && target.id < best.id)
      ) {
        best = { to: hit, distance: near.distance, id: target.id }
      }
    }

    if (!best) continue
    joints.push({
      wallId: wall.id,
      which: slot.which,
      at: here,
      to: best.to,
      kind: 'extend',
    })
  }

  return joints
}

/**
 * Where this wall's infinite line crosses another's, or null when they are too
 * near-parallel for the answer to mean anything.
 *
 * The endpoint is moved ALONG ITS OWN WALL'S LINE, so the wall keeps its
 * direction exactly — extending a partition must never rotate it. Using the
 * perpendicular foot instead would have done.
 */
function lineCross(from: Point, through: Point, a: Point, b: Point): Point | null {
  const dx = through.x - from.x
  const dz = through.z - from.z
  const ex = b.x - a.x
  const ez = b.z - a.z
  const lenA = Math.hypot(dx, dz)
  const lenB = Math.hypot(ex, ez)
  if (lenA === 0 || lenB === 0) return null

  const denom = dx * ez - dz * ex
  if (Math.abs(denom / (lenA * lenB)) < MIN_CROSS_SIN) return null

  const t = ((a.x - from.x) * ez - (a.z - from.z) * ex) / denom
  return { x: from.x + dx * t, z: from.z + dz * t }
}

/**
 * What a typed length is about to do wrong, before Enter does it.
 *
 * ── The finding this closes (53, mechanism 2) ──
 * A typed length bypasses snap BY DESIGN — B29 hides the indicator while
 * typing, because a typed number is a statement of intent that outranks an
 * inference. So typing a room's CLEAR span, or a nominal figure, toward a
 * wall strands the endpoint 114–152 mm short: near enough to read as joined
 * on screen, far enough that the room graph never connects.
 *
 * ── L2: the commit is NEVER altered ──
 * The typed number is the highest-authority input in the app. This function
 * only PREDICTS: it answers "if this commits, what will the loose-end scan
 * say?" so the editor can show the miss WHILE the number can still be
 * retyped. It answers with the scan's own machinery — a hypothetical wall
 * through `findLooseJoints` — so the warning and the after-commit ring cannot
 * disagree about what counts as a near-miss, and there is no second tolerance
 * to drift.
 */
export type TypedMiss = {
  /** Where the typed commit will put the endpoint. */
  at: Point
  /** Where the repair would move it — on the wall or corner it nearly meets. */
  to: Point
  /** The shortfall, `at` to `to`, in metres. */
  gap: number
  /** The length that WOULD land on `to`, anchor to `to`, in metres. */
  reaches: number
}

/** An id no user wall can collide with — the probe never reaches the store. */
const TYPED_PROBE_ID = ' typed-probe'

export function probeTypedMiss(
  walls: Wall[],
  anchor: Point,
  end: Point,
): TypedMiss | null {
  if (dist(anchor, end) === 0) return null

  const probe: Wall = {
    id: TYPED_PROBE_ID,
    start: anchor,
    end,
    height: 3,
    // The probe's own thickness decides nothing: `extendReach` scales with
    // the TARGET wall and `mergeReach` with the crossing angle. Any legal
    // value serves.
    thickness: 0.115,
    type: 'partition',
    openings: [],
    material: 'white-paint',
  }

  const joint = findLooseJoints([...walls, probe]).find(
    (j) => j.wallId === TYPED_PROBE_ID && j.which === 'end',
  )
  if (!joint) return null

  return {
    at: end,
    to: joint.to,
    gap: dist(end, joint.to),
    reaches: dist(anchor, joint.to),
  }
}

/**
 * The walls with every loose joint closed.
 *
 * Returns the ORIGINAL array when there is nothing to do, so a repair that
 * finds nothing cannot hand the store a new identity and record an undo step
 * in which nothing changed (§10 rule 10).
 */
export function weldJoints(walls: Wall[]): Wall[] {
  const joints = findLooseJoints(walls)
  if (joints.length === 0) return walls

  const byWall = new Map<string, LooseJoint[]>()
  for (const joint of joints) {
    const list = byWall.get(joint.wallId)
    if (list) list.push(joint)
    else byWall.set(joint.wallId, [joint])
  }

  return walls.map((wall) => {
    const mine = byWall.get(wall.id)
    if (!mine) return wall
    // One slot yields at most one joint now, so a wall has at most two — its
    // start and its end. Built in one literal rather than by spreading in a
    // loop, which allocated a Wall per joint and tripped no-accumulating-spread.
    const start = mine.find((j) => j.which === 'start')
    const end = mine.find((j) => j.which === 'end')
    return {
      ...wall,
      ...(start ? { start: { ...start.to } } : {}),
      ...(end ? { end: { ...end.to } } : {}),
    }
  })
}
