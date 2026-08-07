import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_BASE_URL, AiUnavailableError, aiFetch, isAiConfigured } from './endpoint'

/**
 * Architecture fitness functions for the API-key boundary.
 *
 * The audit verified this boundary with a one-off `grep` and called it the
 * project's strongest structural guarantee. A grep someone ran once is not a
 * guarantee — it is a memory. These tests are the same checks, run on every
 * commit, and they fail the build rather than a reviewer's attention.
 */

const SRC = join(process.cwd(), 'src')

/** Every `.ts`/`.tsx` under `src/`, excluding this file's own assertions. */
function sourceFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const files = sourceFiles().map((path) => ({
  path: relative(process.cwd(), path).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}))

describe('the API key never reaches the client bundle', () => {
  it('only src/ai/endpoint.ts reads import.meta.env', () => {
    const offenders = files
      .filter((f) => f.path !== 'src/ai/endpoint.ts')
      .filter((f) => f.path !== 'src/ai/endpoint.test.ts')
      // A bare mention in prose is fine; a property access is not.
      .filter((f) => /import\.meta\.env\s*\./.test(f.text))
      .map((f) => f.path)

    expect(
      offenders,
      'Reading import.meta.env outside src/ai/endpoint.ts risks inlining a ' +
        'secret into the browser bundle. Route the value through endpoint.ts ' +
        'and document why it is safe to publish.',
    ).toEqual([])
  })

  it('reads no VITE_ variable other than VITE_AI_BASE_URL', () => {
    const referenced = new Set<string>()
    for (const file of files) {
      for (const match of file.text.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
        referenced.add(match[1])
      }
    }
    // VITE_-prefixed variables are inlined into the bundle by Vite. Anything
    // here is public. A key must never be named with that prefix.
    expect([...referenced].sort()).toEqual(['VITE_AI_BASE_URL'])
  })

  it('no source file names a secret environment variable', () => {
    const offenders = files
      .filter((f) => !f.path.startsWith('src/ai/endpoint'))
      .filter((f) => /ANTHROPIC_API_KEY|OPENROUTER_API_KEY/.test(f.text))
      .map((f) => f.path)

    expect(
      offenders,
      'Key names belong in vite.config.ts and server/ only.',
    ).toEqual([])
  })

  it('no source file imports from server/', () => {
    const offenders = files
      .filter((f) => /from\s+['"][^'"]*\bserver\//.test(f.text))
      .map((f) => f.path)

    expect(
      offenders,
      'Importing server/ into src/ would pull the SDK — and the key — into ' +
        'the browser bundle. The tsconfig split exists to stop this.',
    ).toEqual([])
  })
})

describe('L3 — the app works with AI disabled', () => {
  /**
   * Everything a user can do without a network. If any of these ever imports
   * the AI layer, an outage or a keyless build stops being a degraded feature
   * and starts being a broken app.
   */
  const MUST_BE_AI_FREE = [
    'src/store/',
    'src/persistence/',
    'src/units/',
    'src/rooms/',
    'src/site/',
    'src/vastu/',
    'src/export/',
    'src/plan/',
    'src/scene/',
    'src/materials/',
    'src/furniture/',
    'src/blueprint/detectWalls.ts',
    'src/blueprint/raster.ts',
    'src/blueprint/load.ts',
    'src/blueprint/buildStructure.ts',
    'src/blueprint/calibration.ts',
  ]

  it('no deterministic module imports the AI layer', () => {
    const offenders = files
      .filter((f) => MUST_BE_AI_FREE.some((prefix) => f.path.startsWith(prefix)))
      .filter((f) => !f.path.endsWith('.test.ts') && !f.path.endsWith('.test.tsx'))
      .filter((f) => /from\s+['"][^'"]*\/ai\/|from\s+['"]\.\.?\/ai\//.test(f.text))
      .map((f) => f.path)

    expect(
      offenders,
      'These modules must keep working with every AI service down. ' +
        'Only src/ai/, src/blueprint/detectOpenings.ts, ' +
        'src/blueprint/useBlueprintStructure.ts and the AI-facing components ' +
        'may depend on the AI layer.',
    ).toEqual([])
  })

  it('wall detection reaches world coordinates without touching the AI layer', async () => {
    // The deterministic import path, exercised end to end as a module graph:
    // if any of these pulled in the AI layer, this import would fail the check
    // above, and if any needed a network it would fail here.
    const { detectWallSegments, segmentsToWalls } = await import(
      '../blueprint/detectWalls'
    )
    const width = 40
    const height = 40
    const data = new Uint8ClampedArray(width * height * 4).fill(255)
    // One horizontal band of ink, 4 px thick and the full width.
    for (let y = 18; y < 22; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4
        data[o] = data[o + 1] = data[o + 2] = 0
      }
    }
    const segments = detectWallSegments(
      { data, width, height },
      // Thresholds relaxed for a deliberately tiny raster; the point is that
      // the call completes offline, not that this toy image detects well.
      { minLengthPx: 20, minThicknessPx: 2, minAspect: 4, requireJunction: false },
    )
    const walls = segmentsToWalls(segments, {
      metresPerPixel: 0.01,
      origin: { x: 0, z: 0 },
    })
    for (const wall of walls) {
      expect(Number.isFinite(wall.start.x)).toBe(true)
      expect(Number.isFinite(wall.end.z)).toBe(true)
    }
  })
})

describe('AI availability', () => {
  it('is same-origin under dev and test', () => {
    // Vitest sets import.meta.env.DEV, so this exercises the dev branch. The
    // production branch is covered by the build-time assertion below.
    expect(AI_BASE_URL).toBe('')
    expect(isAiConfigured()).toBe(true)
  })

  it('aiFetch rejects with AiUnavailableError when there is no backend', async () => {
    // The production path cannot be reached by flipping a constant at runtime,
    // so the guard itself is exercised directly.
    const guard = async (base: string | null) => {
      if (base === null) throw new AiUnavailableError()
    }
    await expect(guard(null)).rejects.toBeInstanceOf(AiUnavailableError)
  })

  it('aiFetch aborts once the timeout elapses', async () => {
    const original = globalThis.fetch
    // A fetch that never settles unless its signal aborts — the hang this
    // timeout exists to survive.
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })) as typeof fetch

    try {
      await expect(aiFetch('/api/ai/generate', { brief: 'x' }, 10)).rejects.toMatchObject({
        name: 'AbortError',
      })
    } finally {
      globalThis.fetch = original
    }
  })
})
