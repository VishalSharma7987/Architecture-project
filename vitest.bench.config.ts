import { defineConfig } from 'vitest/config'

/**
 * Benchmark config, separate from `vitest.config.ts` on purpose.
 *
 * Benchmarks are slow by design and their numbers are meaningless on a shared
 * CI runner, so they must never join `npm test`. Keeping the include lists in
 * two files is what guarantees that: there is no flag anyone can forget.
 *
 * `node`, not `jsdom` — `plan/rooms.ts` and `rooms/resolve.ts` import nothing
 * but types from the store, so the DOM would only add startup cost to the
 * thing being measured.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.bench.ts'],
    // No parallelism: two benchmark files sharing cores would measure the
    // scheduler rather than the code.
    fileParallelism: false,
  },
})
