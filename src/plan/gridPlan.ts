import type { RoomLabel, Wall } from '../store/useDesignStore'
// Type-only, and it has to stay that way: `materials/palette` imports `three`,
// which would add a chunk of module-init time to files whose whole job is
// measuring something else.
import type { MaterialId } from '../materials/palette'

/**
 * Deterministic plan generator, shared by the benchmarks.
 *
 * Extracted from `rooms.bench.ts` when `autosave.bench.ts` needed the same
 * input. Two generators would have meant two definitions of "a 500-wall plan",
 * and the numbers in `benchmarks.md` would have stopped being comparable
 * between them.
 *
 * Nothing in the app imports this; it is `src/`-resident only because the
 * benchmarks are.
 */

/**
 * mulberry32 — a small seeded PRNG.
 *
 * Seeded so the plans are byte-identical between runs and between machines.
 * A benchmark whose input changes each run measures the input.
 */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SEED = 20260810

const WALL_DEFAULTS = {
  height: 3,
  thickness: 0.2,
  openings: [],
  material: 'white-paint' as MaterialId,
}

let nextId = 0
const wall = (
  ax: number,
  az: number,
  bx: number,
  bz: number,
): Wall => ({
  id: `w${nextId++}`,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  ...WALL_DEFAULTS,
})

/**
 * A rectilinear grid of rooms, plus interior partitions to hit an exact count.
 *
 * A full R×C grid is `2RC + R + C` walls, which lands on very few round
 * numbers — so the largest grid that fits under the target is built first, and
 * the remainder is made up with partitions splitting individual rooms in half.
 * That is closer to a real plan than truncating the grid would be: every wall
 * stays connected, so none of them are pruned as dangles before the traversal
 * does its work.
 *
 * Rooms are 3 m x 3.5 m, which is an ordinary Indian bedroom, so the polygon
 * areas and the weld tolerance are exercised at a realistic scale rather than
 * on a unit square.
 */
export function gridPlan(
  targetWalls: number,
  /**
   * Offset added to the seed and to the id counter, so two floors of a
   * multi-storey fixture are distinct plans rather than the same one twice.
   * Zero reproduces exactly the plan `benchmarks.md` was recorded against.
   */
  variant = 0,
): { walls: Wall[]; labels: RoomLabel[] } {
  const random = mulberry32(SEED + variant)
  nextId = variant

  const CELL_X = 3
  const CELL_Z = 3.5

  // Largest near-square grid whose wall count fits under the target.
  let rows = 1
  let cols = 1
  for (let r = 1; r <= 64; r++) {
    for (let c = r; c <= r + 1; c++) {
      const count = 2 * r * c + r + c
      if (count <= targetWalls && count > 2 * rows * cols + rows + cols) {
        rows = r
        cols = c
      }
    }
  }

  const walls: Wall[] = []

  // Horizontal runs: one segment per cell, so every crossing is a real node
  // rather than something `splitAtIntersections` has to discover. Both cases
  // occur in real plans; this is the cheaper of the two, deliberately, so the
  // baseline is not flattered by pathological input.
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      walls.push(wall(c * CELL_X, r * CELL_Z, (c + 1) * CELL_X, r * CELL_Z))
    }
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) {
      walls.push(wall(c * CELL_X, r * CELL_Z, c * CELL_X, (r + 1) * CELL_Z))
    }
  }

  // Top up to exactly the target with partitions across whole rooms, chosen by
  // the seeded generator so the layout is varied but reproducible.
  const cells: Array<[number, number]> = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([r, c])

  let cursor = 0
  while (walls.length < targetWalls && cells.length > 0) {
    const [r, c] = cells[Math.floor(random() * cells.length) % cells.length]
    const vertical = random() < 0.5
    walls.push(
      vertical
        ? wall(
            c * CELL_X + CELL_X / 2,
            r * CELL_Z,
            c * CELL_X + CELL_X / 2,
            (r + 1) * CELL_Z,
          )
        : wall(
            c * CELL_X,
            r * CELL_Z + CELL_Z / 2,
            (c + 1) * CELL_X,
            r * CELL_Z + CELL_Z / 2,
          ),
    )
    cursor++
    // Guard against a pathological seed looping forever on a tiny grid.
    if (cursor > targetWalls * 4) break
  }

  // One name per four rooms, which is roughly what a named plan carries.
  // `resolveRooms` tests every label against every detected room, so labels are
  // part of its cost and leaving them out would understate it.
  const labels: RoomLabel[] = []
  for (let i = 0; i < cells.length; i += 4) {
    const [r, c] = cells[i]
    labels.push({
      id: `label-${variant}-${i}`,
      type: 'bedroom',
      anchor: { x: c * CELL_X + CELL_X / 2, z: r * CELL_Z + CELL_Z / 2 },
    })
  }

  return { walls, labels }
}
