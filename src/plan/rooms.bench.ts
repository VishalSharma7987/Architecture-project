import { describe, it } from 'vitest'
import type { RoomLabel, Wall } from '../store/useDesignStore'
// Type-only, and it has to stay that way: `materials/palette` imports `three`,
// which would add a chunk of module-init time to a file whose whole job is
// measuring something else.
import type { MaterialId } from '../materials/palette'
import { detectRooms } from './rooms'
import { resolveRooms } from '../rooms/resolve'

/**
 * Pre-B7 baseline for room detection.
 *
 * B7 rewrites `resolveRooms` and folds B8's shared memoisation into it. There
 * is no way to tell whether that helped without a number from before, and the
 * repository had none — so this exists to be beaten, not to pass or fail.
 *
 * Deliberately NOT part of `npm test`: it is slow by design, and wall-clock
 * timings on a shared CI runner are noise. `vitest.bench.config.ts` includes
 * it, `vitest.config.ts` does not. Run it with `npm run bench:rooms`.
 *
 * Nothing here asserts. A benchmark that fails the build on a slow machine
 * teaches people to skip the build.
 */

/* ─── deterministic input ───────────────────────────────────────────────── */

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

const SEED = 20260810

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
function gridPlan(targetWalls: number): { walls: Wall[]; labels: RoomLabel[] } {
  const random = mulberry32(SEED)
  nextId = 0

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
      id: `label-${i}`,
      type: 'bedroom',
      anchor: { x: c * CELL_X + CELL_X / 2, z: r * CELL_Z + CELL_Z / 2 },
    })
  }

  return { walls, labels }
}

/* ─── measurement ───────────────────────────────────────────────────────── */

/**
 * 21 samples, 5 discarded first.
 *
 * Started at 11 and 3, which was not enough: at 50 walls a single call is a
 * quarter of a millisecond, so the median moved by 3x between process runs on
 * JIT warm-up alone, and at 500 walls one GC pause was enough to drag the
 * median with it. A baseline that noisy cannot show whether B7 helped.
 */
const RUNS = 21
const WARMUP = 5

type Timing = { median: number; min: number; max: number }

/**
 * Median of `RUNS`, after `WARMUP` discarded runs.
 *
 * Median rather than mean because a single GC pause or a JIT tier-up skews a
 * mean and tells you nothing about the typical frame. Warmup because the first
 * few calls run in the interpreter and would measure V8 rather than this code.
 */
function measure(run: () => void): Timing {
  for (let i = 0; i < WARMUP; i++) run()

  const samples: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }

  samples.sort((a, b) => a - b)
  return {
    median: samples[(samples.length - 1) >> 1],
    min: samples[0],
    max: samples[samples.length - 1],
  }
}

const ms = (n: number) => n.toFixed(3).padStart(9)

describe('room detection baseline', () => {
  /**
   * One measurement pass per size, and no more.
   *
   * An earlier draft also timed 2x and 4x `resolveRooms` directly. That was
   * three extra passes of sustained work per size, which on a laptop is enough
   * to thermally throttle the machine — the third process run came back ~2x
   * slower than the first, which is a property of the cooling rather than of
   * the code. Those multiples are N calls to the same pure function, so they
   * are derived arithmetically below and marked as derived.
   */
  it('measures detectRooms and resolveRooms at 50 / 200 / 500 walls', () => {
    const rows: string[] = []
    const perEdit: string[] = []

    for (const target of [50, 200, 500]) {
      const { walls, labels } = gridPlan(target)
      const rooms = detectRooms(walls).length

      const detect = measure(() => void detectRooms(walls))
      const resolve = measure(() => void resolveRooms(walls, labels))

      rows.push(
        [
          String(walls.length).padStart(5),
          String(rooms).padStart(5),
          String(labels.length).padStart(6),
          ms(detect.median),
          ms(detect.min),
          ms(detect.max),
          ms(resolve.median),
          ms(resolve.min),
          ms(resolve.max),
        ].join(' | '),
      )

      perEdit.push(
        [
          String(walls.length).padStart(5),
          ms(resolve.median),
          ms(resolve.median * 2),
          ms(resolve.median * 4),
        ].join(' | '),
      )
    }

    console.log(
      [
        '',
        `seed ${SEED} · median of ${RUNS} runs after ${WARMUP} warmup · milliseconds`,
        '',
        'walls | rooms | labels | detect ms |  det min |  det max | resolve ms |  res min |  res max',
        '------|-------|--------|-----------|----------|----------|------------|----------|---------',
        ...rows,
        '',
        // There are five resolveRooms call sites in the render path, but five
        // never mount together: FloorPlanEditor is 2D-only and RoomLabels is
        // 3D-only, and App renders one branch or the other. The reachable
        // maximum is FOUR; the ordinary case is two — the viewport plus
        // InspectorPanel, which is mounted whenever you are editing. Quoting
        // 5x would manufacture an improvement for B8 to claim.
        'one edit, recomputed independently by each mounted panel (x2 and x4 derived)',
        '',
        'walls |  1 panel | 2 typical |   4 max',
        '------|-----------|-----------|----------',
        ...perEdit,
        '',
      ].join('\n'),
    )
  })
})
