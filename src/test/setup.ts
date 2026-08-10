import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Global test setup.
 *
 * jsdom does not implement everything the app assumes. Rather than sprinkle
 * guards through production code for the benefit of tests, the gaps are filled
 * here — so the code under test is the code that ships.
 */

/**
 * Unmount whatever the last test rendered.
 *
 * `@testing-library/react` registers this itself, but only when Vitest is run
 * with `globals: true`, and this project does not — so nothing was tearing the
 * DOM down between tests. It went unnoticed because the only rendering suite
 * asserted on cache counters rather than on the DOM; the first test to call
 * `getByTestId` twice failed with *"Found multiple elements"*, pointing at its
 * own query rather than at the leak.
 */
afterEach(cleanup)

// jsdom ships `crypto` but not always `crypto.randomUUID`, which the store
// calls for every id it mints. Node 20 has it on `globalThis.crypto`.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  let counter = 0
  Object.defineProperty(globalThis.crypto ?? (globalThis.crypto = {} as Crypto), 'randomUUID', {
    // Deterministic on purpose: a test that asserts on ids should be
    // reproducible, and nothing under test depends on them being random.
    value: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    configurable: true,
  })
}

// `setBlueprint` revokes the previous object URL; jsdom implements neither.
if (typeof URL.createObjectURL !== 'function') {
  let n = 0
  URL.createObjectURL = () => `blob:test/${++n}`
  URL.revokeObjectURL = () => {}
}
