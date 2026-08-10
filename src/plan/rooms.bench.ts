import { describe, it } from 'vitest'
import type { RoomLabel, Wall } from '../store/useDesignStore'
// Type-only, and it has to stay that way: `materials/palette` imports `three`,
// which would add a chunk of module-init time to a file whose whole job is
// measuring something else.
import type { MaterialId } from '../materials/palette'
import { detectRoomsUncached } from './rooms'
import { resolveRooms, resolveRoomsUncached } from '../rooms/resolve'

/**
 * Room detection: the algorithm, and the cost of one edit across the panels
 * that recompute it.
 *
 * The algorithm arms call the `*Uncached` entry points DELIBERATELY. After B8
 * `detectRooms` and `resolveRooms` are memoised, so timing them directly would
 * measure a `WeakMap` lookup and report a spectacular, meaningless speedup
 * against the pre-B8 table. §3 forbids touching the algorithm, so those two
 * rows are expected to be flat — that is the control.
 *
 * The per-edit arm is the one B8 is answerable for, and it is now MEASURED
 * rather than derived: `editedCopy` mints a new `walls` identity each
 * iteration, exactly as the store does, so the shared cache misses once per
 * edit and is then hit by every other consumer.
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

/**
 * Two arms, sampled alternately, so a drifting machine drifts through both.
 *
 * Measuring A's 21 samples and then B's would put B entirely in the hotter part
 * of the run — and this machine throttles measurably (see `benchmarks.md`).
 * Alternating spreads that across both arms, so the RATIO between them survives
 * a clock change even though the absolute figures do not.
 */
function measureBoth(a: () => void, b: () => void): [Timing, Timing] {
  for (let i = 0; i < WARMUP; i++) {
    a()
    b()
  }

  const sa: number[] = []
  const sb: number[] = []

  for (let i = 0; i < RUNS; i++) {
    let start = performance.now()
    a()
    sa.push(performance.now() - start)

    start = performance.now()
    b()
    sb.push(performance.now() - start)
  }

  const summarise = (s: number[]): Timing => {
    s.sort((m, n) => m - n)
    return { median: s[(s.length - 1) >> 1], min: s[0], max: s[s.length - 1] }
  }

  return [summarise(sa), summarise(sb)]
}

const ms = (n: number) => n.toFixed(3).padStart(9)

/**
 * One edit, as the store performs it: a new `walls` array, sharing every wall
 * object it did not touch.
 *
 * `height` is what changes, so the plan's geometry — and therefore the room
 * count and the traversal's work — is identical on every iteration. The point
 * is to vary the array IDENTITY, which is what the cache is keyed on, without
 * also varying the amount of work and making the samples incomparable.
 */
function editedCopy(walls: Wall[], i: number): Wall[] {
  const at = i % walls.length
  return walls.map((w, k) => (k === at ? { ...w, height: 3 + (i % 8) * 0.01 } : w))
}

describe('room detection', () => {
  /**
   * One measurement pass per arm per size, and no more.
   *
   * An earlier draft timed 2x and 4x `resolveRooms` as separate passes. That
   * was three extra passes of sustained work per size, which on a laptop is
   * enough to thermally throttle the machine — the third process run came back
   * ~2x slower than the first, which is a property of the cooling rather than
   * of the code. The per-edit arms below replace them: two passes, and they
   * measure the thing that actually changed.
   */
  it('measures the algorithm and the cost of one edit at 50 / 200 / 500 walls', () => {
    const algorithm: string[] = []
    const perEdit: string[] = []

    // The reachable maximum. Five call sites exist, but FloorPlanEditor is
    // 2D-only and RoomLabels is 3D-only and App renders one branch or the
    // other, so four is the most that ever mount together.
    const CONSUMERS = 4

    for (const target of [50, 200, 500]) {
      const { walls, labels } = gridPlan(target)
      const rooms = detectRoomsUncached(walls).length

      // ── the algorithm, unmemoised: the control, expected to be flat ──
      const detect = measure(() => void detectRoomsUncached(walls))
      const resolve = measure(() => void resolveRoomsUncached(walls, labels))

      // ── one edit, four consumers: no sharing (what B8 replaced) against
      //    the shared cache, sampled alternately ──
      let i = 0
      let j = 0
      const [before, after] = measureBoth(
        () => {
          const edited = editedCopy(walls, i++)
          for (let c = 0; c < CONSUMERS; c++) resolveRoomsUncached(edited, labels)
        },
        () => {
          const edited = editedCopy(walls, j++)
          for (let c = 0; c < CONSUMERS; c++) resolveRooms(edited, labels)
        },
      )

      algorithm.push(
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
          ms(before.median),
          ms(after.median),
          `${(before.median / after.median).toFixed(2)}x`.padStart(8),
        ].join(' | '),
      )
    }

    console.log(
      [
        '',
        `seed ${SEED} · median of ${RUNS} runs after ${WARMUP} warmup · milliseconds`,
        '',
        'ALGORITHM (uncached) — unchanged by B8 by design; this is the control',
        '',
        'walls | rooms | labels | detect ms |  det min |  det max | resolve ms |  res min |  res max',
        '------|-------|--------|-----------|----------|----------|------------|----------|---------',
        ...algorithm,
        '',
        `ONE EDIT, ${CONSUMERS} MOUNTED CONSUMERS — measured, not derived`,
        '',
        'walls | per-panel |    shared |  speedup',
        '------|-----------|-----------|---------',
        ...perEdit,
        '',
      ].join('\n'),
    )
  })
})
