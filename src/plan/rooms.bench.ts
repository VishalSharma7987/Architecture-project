import { describe, it } from 'vitest'
import type { Wall } from '../store/useDesignStore'
import { gridPlan, SEED } from './gridPlan'
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
