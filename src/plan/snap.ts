/**
 * Where a wall endpoint wants to land, given the walls already drawn.
 *
 * ── Why this exists ──
 * Session 1 measured why plans fail to enclose rooms: endpoints land **1 to
 * 152 mm apart** and never join. Session 2 established that welding at
 * DETECTION time is the wrong layer — the model stays wrong, and every
 * consumer downstream (3D, BOQ, DXF, IFC, `sharedEnds`) has to re-implement
 * the same tolerance to paper over it.
 *
 * Snapping at DRAWING time is the layer where it can actually be fixed,
 * because it makes the stored coordinate correct rather than making thirteen
 * readers forgiving. A wall that snaps to another's endpoint is stored sharing
 * that endpoint EXACTLY — bit-identical, not within a tolerance — which is
 * what `rooms.ts`'s graph and `wallBody.ts`'s `sharedEnds` both already
 * require, since both match on exact coordinates.
 *
 * ── L2 is not violated ──
 * §L2 says user input outranks. A snap is not the app overruling a click: the
 * target is on screen, under the cursor, before the button goes down, and Alt
 * suppresses it. The user is clicking the INDICATOR. That is the input.
 *
 * ── Pure, and in world metres ──
 * No store, no canvas, no React. The radius arrives already converted from
 * screen pixels by the caller, because only the caller knows the viewport —
 * and a radius in world units would mean the snap behaved differently at every
 * zoom, which is the bug `HIT_TOLERANCE_PX` exists to avoid for picking.
 */
import type { Point, Wall } from '../store/useDesignStore'
import { projectOntoWall, wallAxis } from '../scene/wallGeometry'

export type SnapKind = 'endpoint' | 'midpoint' | 'centreline' | 'face'

export type SnapTarget = {
  kind: SnapKind
  /** Where the endpoint should go, in world metres. */
  point: Point
  /**
   * Every wall that contributed this exact target.
   *
   * A corner is ONE target, not two. When two walls already share an endpoint,
   * the thing worth snapping to is the COORDINATE — a third wall drawn to it
   * joins both, which is the whole point. Reporting two targets at the same
   * place would force a meaningless choice and draw two indicators on top of
   * each other. The ids are kept so the indicator can say what it caught.
   */
  wallIds: string[]
}

/**
 * Snap radius in SCREEN pixels, so it behaves identically at every zoom.
 *
 * ── Derived, not picked ──
 * Two bounds, and they are not close together:
 *
 * LOWER — it must beat the grid, or it never fires. The drawing grid is one
 * half-foot, 152.4 mm, which at the default 44 px/m viewport is **6.7 screen
 * pixels**. A radius at or below that loses to grid snap routinely, because
 * the grid point is nearly always nearer than the target you are aiming at.
 *
 * UPPER — it must not reach across an opening. The narrowest door in
 * `OPENING_DEFAULTS` is 0.75 m, which is 33 px at the same zoom. A radius near
 * that would grab the far jamb while you aim at the near one.
 *
 * 12 px sits well clear of both, and above `HIT_TOLERANCE_PX` (7) so that a
 * snap engages slightly BEFORE the same cursor position would pick the wall —
 * the indicator appears while you are still approaching, not at the moment
 * clicking would do something else.
 */
export const SNAP_RADIUS_PX = 12

/** Millimetre identity, matching `wallBody.ts`'s `vertexKey`. */
const coordKey = (p: Point) => `${Math.round(p.x * 1000)}:${Math.round(p.z * 1000)}`

/**
 * Perpendicular distance from a point to the wall's INFINITE centreline —
 * unlike `projectOntoWall().distance`, which measures to the clamped segment
 * and so mixes the lateral and past-the-end components the face band needs
 * kept apart.
 */
const projectionLateral = (wall: Wall, p: Point, length: number) =>
  Math.abs(
    (p.x - wall.start.x) * (wall.end.z - wall.start.z) -
      (p.z - wall.start.z) * (wall.end.x - wall.start.x),
  ) / length

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)

/**
 * Priority when several targets are in range: **endpoint, then midpoint, then
 * centreline** — and nearest wins within a kind.
 *
 * The ordering is by how much the target CLAIMS, not by how close it is:
 *
 *   - an **endpoint** is a place the user already committed to. It exists in
 *     the model as a coordinate, and landing on it is what makes two walls
 *     share a vertex — the one thing that makes a room close.
 *   - a **midpoint** is derived rather than authored, but it is still a single
 *     distinguished point, and it is what a partition drawn to the middle of a
 *     wall wants.
 *   - a **centreline** is a whole LINE. It says "somewhere on this wall",
 *     which is the weakest claim of the three point-and-line targets, and it
 *     is a 1-dimensional target where the other two are 0-dimensional.
 *   - a **face** (B34) is not even where the endpoint will land — it is an
 *     AIMING band over the wall's drawn body whose committed point is the
 *     centreline behind it. It makes the weakest claim of all, and when the
 *     centreline is also in range the two propose the SAME point, so the
 *     higher-information indicator wins and the face only ever fires where it
 *     adds reach the others lack.
 *
 * Distance cannot be the primary key. A centreline is by construction never
 * further than an endpoint on the same wall — the endpoint lies ON the
 * centreline — so ranking by distance alone would mean the endpoint could
 * never win, and the feature would silently never do the thing it exists for.
 */
const PRIORITY: Record<SnapKind, number> = {
  endpoint: 0,
  midpoint: 1,
  centreline: 2,
  face: 3,
}

/**
 * The best target within `radius` metres of `world`, or null.
 *
 * `exclude` drops walls that must not be snapped to — the chain's own anchor
 * wall while it is still being drawn would otherwise pull its own free end
 * back onto itself.
 */
export function findSnap(
  walls: Wall[],
  world: Point,
  radius: number,
  exclude: ReadonlySet<string> = new Set(),
): SnapTarget | null {
  const candidates: { kind: SnapKind; point: Point; wallId: string; d: number }[] = []

  for (const wall of walls) {
    if (exclude.has(wall.id)) continue
    const { length } = wallAxis(wall)
    if (length <= 0) continue

    for (const point of [wall.start, wall.end]) {
      const d = dist(world, point)
      if (d <= radius) candidates.push({ kind: 'endpoint', point, wallId: wall.id, d })
    }

    const mid = { x: (wall.start.x + wall.end.x) / 2, z: (wall.start.z + wall.end.z) / 2 }
    const dm = dist(world, mid)
    if (dm <= radius) candidates.push({ kind: 'midpoint', point: mid, wallId: wall.id, d: dm })

    // Clamped to the segment, so this never proposes a point off the end of
    // the wall — that would be an EXTENSION snap, which is a different target
    // and deliberately not in this session.
    //
    // `Projection.t` is a DISTANCE IN METRES along the wall, not a 0..1
    // parameter — the doc comment says so and `placeOpenings` relies on it,
    // since `Opening.position` is metres from the start. Treating it as a
    // fraction put the centreline point 8x down a 8 m wall on the first run.
    const projection = projectOntoWall(wall, world)
    const along = projection.t / length
    const foot = {
      x: wall.start.x + (wall.end.x - wall.start.x) * along,
      z: wall.start.z + (wall.end.z - wall.start.z) * along,
    }
    if (projection.distance <= radius) {
      candidates.push({ kind: 'centreline', point: foot, wallId: wall.id, d: projection.distance })
    }

    /*
     * The FACE band (B34, finding 53). The user aims at the face because the
     * face is what is DRAWN — and B32's 230 mm shells put it 115 mm from the
     * centreline, outside the 12 px radius above ~104 px/m, where aiming at
     * what you can see fell through to grid and landed the stem one cell
     * short. Anywhere within `radius` of the drawn body counts, interior
     * included: an endpoint inside the wall's own ink is one the user sees as
     * connected (`repairJoints.extendReach` makes the same argument).
     *
     * The committed point is the CENTRELINE FOOT behind the aim, never a
     * point on the face itself: an endpoint left on the face would not join —
     * the room graph and `sharedEnds` both match centreline coordinates — and
     * the chain arithmetic (B33) sums centrelines. The face is an aiming
     * target; the centreline is the landing. The indicator is drawn at the
     * committed point, so the user sees the landing before the click.
     *
     * The alternative — growing the radius with zoom or thickness — is
     * rejected: it would make EVERY target grabbier and break the two bounds
     * the 12 px radius was derived from. Only the face extends coverage, and
     * only over the wall's own drawn body.
     */
    // The band is the drawn BODY dilated by the radius — measured against the
    // rectangle, not against the segment plus a lateral allowance. Measuring
    // from the clamped segment would reach `thickness / 2` past a free end in
    // every direction, where there is no ink at all, and B28's "does not snap
    // just outside the radius" pin caught the first draft doing exactly that.
    // Axially the band ends `radius` past the endpoint, which is ground the
    // endpoint target already covers and outranks.
    const alongRaw =
      ((world.x - wall.start.x) * (wall.end.x - wall.start.x) +
        (world.z - wall.start.z) * (wall.end.z - wall.start.z)) /
      length
    const overrun = Math.max(0, -alongRaw, alongRaw - length)
    const lateralGap = Math.max(0, projectionLateral(wall, world, length) - wall.thickness / 2)
    const bodyDist = Math.hypot(overrun, lateralGap)
    if (bodyDist <= radius) {
      candidates.push({ kind: 'face', point: foot, wallId: wall.id, d: bodyDist })
    }
  }

  if (candidates.length === 0) return null

  candidates.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.d - b.d)
  const best = candidates[0]

  // Every wall meeting at the winning coordinate, so a corner reports as one
  // target that knows it is a corner.
  const key = coordKey(best.point)
  const wallIds = candidates
    .filter((c) => c.kind === best.kind && coordKey(c.point) === key)
    .map((c) => c.wallId)

  return { kind: best.kind, point: best.point, wallIds: [...new Set(wallIds)] }
}

/** Where a wall endpoint lands, and what it caught on the way. */
export type SnapResult = { point: Point; target: SnapTarget | null }

/**
 * The whole snap-or-grid decision, in one pure function.
 *
 * ── Snap BEATS grid, and the snapped point is returned unrounded ──
 * Rounding a snapped point to the grid would defeat the feature entirely. The
 * target is worth snapping to precisely because landing on it makes two walls
 * share a coordinate bit-for-bit; the grid would then move it by up to half a
 * cell — 76 mm — which lands squarely inside the 1–152 mm band Session 1
 * measured as the reason rooms fail to close. Grid is the FALLBACK, used only
 * when nothing is in range.
 *
 * ── `suppressed` falls back to the grid, not to nothing ──
 * Alt is "place this on the grid instead", not "place this anywhere". A raw
 * unsnapped coordinate is the state this session exists to stop producing, and
 * a modifier that produced one would be a supported way to reintroduce the bug.
 *
 * Lives here rather than in the editor so it can be tested without a DOM: the
 * component is left as an adapter that knows about pixels and the store, and
 * every rule worth asserting is in this file.
 */
export function resolveWallPoint(input: {
  walls: Wall[]
  /** The raw cursor position in world metres. */
  world: Point
  /** Where the grid would put it — the fallback. */
  grid: Point
  /** Snap radius in WORLD metres, already converted from screen pixels. */
  radius: number
  suppressed: boolean
  exclude?: ReadonlySet<string>
}): SnapResult {
  if (input.suppressed) return { point: input.grid, target: null }
  const target = findSnap(input.walls, input.world, input.radius, input.exclude)
  return { point: target ? target.point : input.grid, target }
}
