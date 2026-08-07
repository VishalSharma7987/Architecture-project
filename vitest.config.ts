import { defineConfig } from 'vitest/config'

/**
 * Test config, deliberately separate from `vite.config.ts`.
 *
 * The app config installs `aiPlugin`, which reads API keys from the
 * environment and mounts dev-server middleware. Tests must never do either:
 * a suite that can reach OpenRouter is a suite whose results depend on
 * someone's credit balance.
 */
export default defineConfig({
  test: {
    // jsdom, not node: the store calls `crypto.randomUUID`, persistence calls
    // `localStorage`, and the blueprint modules touch `URL.createObjectURL`.
    // Pure-geometry tests do not need it but pay almost nothing for it.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      // Only the modules a regression would actually hurt. Components are
      // excluded until there is a reason to render them — counting untested
      // JSX in the headline number would hide the coverage that matters.
      include: [
        'src/store/**',
        'src/persistence/**',
        'src/units/**',
        'src/plan/rooms.ts',
        'src/plan/viewport.ts',
        'src/rooms/**',
        'src/site/**',
        'src/vastu/**',
        'src/scene/wallGeometry.ts',
        'src/scene/collision.ts',
        'src/scene/walkMotion.ts',
        'src/scene/avatarMotion.ts',
        'src/blueprint/detectWalls.ts',
        'src/blueprint/calibration.ts',
        'src/export/statement.ts',
        'src/export/pdf.ts',
      ],
    },
  },
})
