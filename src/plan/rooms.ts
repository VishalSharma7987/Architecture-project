import type { Point, Wall } from '../store/useDesignStore'

/** Corners within a millimetre of each other are the same node. */
const WELD = 1e-3

/** Faces smaller than this are numerical slivers, not rooms. */
const MIN_AREA = 1e-3

/**
 * The orientation a bounded face comes out with under the traversal in
 * `traceFaces`. The unbounded face around each building winds the other way,
 * which is how it gets dropped — see `detectRooms`.
 */
const INTERIOR_SIGN = -1

export type Room = {
  /** Closed ring of floor-plane points, in order. */
  polygon: Point[]
  /** Square metres. */
  area: number
}

/** A wall centreline, stripped of everything that is not geometry. */
type Segment = { a: Point; b: Point }

/** An undirected pair of node indices. */
type Edge = [number, number]

/**
 * Every enclosed space in the plan, largest first.
 *
 * Areas are measured on the wall CENTRELINES, so each room is overstated by
 * roughly half a wall thickness around its perimeter. That keeps adjacent
 * rooms tiling the shell exactly, which is what a "total floor area" reader
 * expects; the alternative leaves unattributed slivers under every wall.
 */
export function detectRooms(walls: Wall[]): Room[] {
  const segments = splitAtIntersections(
    walls
      .map((w) => ({ a: w.start, b: w.end }))
      .filter((s) => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z) > WELD),
  )

  const { nodes, edges } = buildGraph(segments)
  const closed = pruneDangles(nodes.length, edges)
  if (closed.length === 0) return []

  const rooms: Room[] = []

  for (const face of traceFaces(nodes, closed)) {
    const signed = signedArea(face)
    if (Math.sign(signed) !== INTERIOR_SIGN) continue
    if (Math.abs(signed) < MIN_AREA) continue
    rooms.push({ polygon: face, area: Math.abs(signed) })
  }

  return rooms.sort((a, b) => b.area - a.area)
}

/** Total enclosed floor area in square metres. */
export function totalFloorArea(walls: Wall[]): number {
  return detectRooms(walls).reduce((sum, room) => sum + room.area, 0)
}

/** Shoelace area, signed by winding direction. */
function signedArea(ring: Point[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    sum += p.x * q.z - q.x * p.z
  }
  return sum / 2
}

const cross = (ax: number, az: number, bx: number, bz: number) =>
  ax * bz - az * bx

/**
 * Cuts every segment wherever another one touches or crosses it.
 *
 * Without this a T-junction — an interior partition running into a corridor
 * wall — has no node at the meeting point, so the traversal walks straight
 * past it and merges two rooms into one.
 */
function splitAtIntersections(segments: Segment[]): Segment[] {
  return segments.flatMap((seg) => splitOne(seg, segments))
}

function splitOne(seg: Segment, others: Segment[]): Segment[] {
  const dx = seg.b.x - seg.a.x
  const dz = seg.b.z - seg.a.z
  const length = Math.hypot(dx, dz)

  // Parameters along `seg`, as fractions of its length.
  const cuts = [0, 1]
  const interior = (t: number) =>
    t * length > WELD && (1 - t) * length > WELD

  for (const other of others) {
    if (other === seg) continue

    const ex = other.b.x - other.a.x
    const ez = other.b.z - other.a.z
    const otherLength = Math.hypot(ex, ez)
    const wx = other.a.x - seg.a.x
    const wz = other.a.z - seg.a.z

    const denom = cross(dx, dz, ex, ez)
    if (Math.abs(denom) > 1e-12) {
      const t = cross(wx, wz, ex, ez) / denom
      const s = cross(wx, wz, dx, dz) / denom
      const onOther =
        s * otherLength >= -WELD && (1 - s) * otherLength >= -WELD
      if (interior(t) && onOther) cuts.push(t)
    }

    // Parallel walls never cross, but one can still end partway along the
    // other, and collinear overlaps only ever get a node from this branch.
    for (const q of [other.a, other.b]) {
      const along = (q.x - seg.a.x) * dx + (q.z - seg.a.z) * dz
      const t = along / (length * length)
      if (!interior(t)) continue
      const px = seg.a.x + dx * t
      const pz = seg.a.z + dz * t
      if (Math.hypot(q.x - px, q.z - pz) <= WELD) cuts.push(t)
    }
  }

  cuts.sort((m, n) => m - n)

  const pieces: Segment[] = []
  let prev = 0

  for (const t of cuts) {
    if ((t - prev) * length <= WELD) continue
    pieces.push({
      a: { x: seg.a.x + dx * prev, z: seg.a.z + dz * prev },
      b: { x: seg.a.x + dx * t, z: seg.a.z + dz * t },
    })
    prev = t
  }

  return pieces
}

/**
 * Welds coincident endpoints into shared nodes and drops duplicate edges, so
 * that two walls drawn to the same corner meet there instead of leaving two
 * nodes a floating-point hair apart.
 */
function buildGraph(segments: Segment[]) {
  const nodes: Point[] = []

  const nodeAt = (p: Point) => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - p.x, nodes[i].z - p.z) <= WELD) return i
    }
    nodes.push({ x: p.x, z: p.z })
    return nodes.length - 1
  }

  const edges = new Map<string, Edge>()

  for (const seg of segments) {
    const u = nodeAt(seg.a)
    const v = nodeAt(seg.b)
    if (u === v) continue
    edges.set(u < v ? `${u}:${v}` : `${v}:${u}`, [u, v])
  }

  return { nodes, edges: [...edges.values()] }
}

/**
 * Repeatedly drops edges with a free end. A dangling wall belongs to no room,
 * and leaving it in makes the face walk detour up and back down the spur.
 */
function pruneDangles(nodeCount: number, edges: Edge[]): Edge[] {
  let kept = edges

  for (;;) {
    const degree = new Array<number>(nodeCount).fill(0)
    for (const [u, v] of kept) {
      degree[u]++
      degree[v]++
    }
    const next = kept.filter(([u, v]) => degree[u] > 1 && degree[v] > 1)
    if (next.length === kept.length) return kept
    kept = next
  }
}

/**
 * Walks every face of the planar graph.
 *
 * Each edge becomes two half-edges, `2i` and `2i + 1`. Arriving at a node
 * along one, the next edge of the same face is the one after its reverse in
 * the node's angular order — so the walk hugs the face, turning as tightly as
 * it can. Every half-edge lies on exactly one face, which is the loop bound.
 */
function traceFaces(nodes: Point[], edges: Edge[]): Point[][] {
  const from: number[] = []
  const to: number[] = []

  for (const [u, v] of edges) {
    from.push(u, v)
    to.push(v, u)
  }

  const angle = (h: number) => {
    const tail = nodes[from[h]]
    const head = nodes[to[h]]
    return Math.atan2(head.z - tail.z, head.x - tail.x)
  }

  const outgoing: number[][] = nodes.map(() => [])
  for (let h = 0; h < from.length; h++) outgoing[from[h]].push(h)
  for (const list of outgoing) list.sort((a, b) => angle(a) - angle(b))

  const slot = new Map<number, number>()
  for (const list of outgoing) {
    list.forEach((h, i) => slot.set(h, i))
  }

  const next = (h: number) => {
    const reverse = h ^ 1
    const list = outgoing[from[reverse]]
    return list[(slot.get(reverse)! + 1) % list.length]
  }

  const seen = new Array<boolean>(from.length).fill(false)
  const faces: Point[][] = []

  for (let start = 0; start < from.length; start++) {
    if (seen[start]) continue

    const ring: Point[] = []
    let h = start

    do {
      seen[h] = true
      ring.push(nodes[from[h]])
      h = next(h)
    } while (h !== start)

    if (ring.length >= 3) faces.push(ring)
  }

  return faces
}
