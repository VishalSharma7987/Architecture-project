import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rectangleWalls, resetStore } from '../test/fixtures'
import { provenance } from './provenance'
import { useDesignStore } from './useDesignStore'

/**
 * B7.4 — every element says where it came from (L5).
 *
 * The fitness test below is the enforcement. It is modelled on
 * `calibration.test.ts`'s "no module outside calibration.ts writes
 * metresPerPixel", which is the pattern this repo already uses twice for
 * invariants no type or lint rule can express.
 */

const SRC = join(process.cwd(), 'src')

function sourceFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (path: string) => relative(process.cwd(), path).replace(/\\/g, '/')

describe('★ B7.4 — nothing builds an element without a source', () => {
  /**
   * Every `id: crypto.randomUUID()` in an object literal is an element coming
   * into being. Each one must set `provenance` in the same literal.
   *
   * Greps the tree rather than relying on types because the field is OPTIONAL
   * on the element types — it has to be, or every v2 document and every test
   * fixture would fail to typecheck. Optionality is right for the DATA and
   * wrong for the CODE, and this is the seam that says so.
   *
   * Demonstrated red (SD5): before the call sites were stamped, this listed
   *
   *   src/store/useDesignStore.ts:1258  (addStair)
   *   src/store/useDesignStore.ts:1333  (nameRoom)
   *   src/store/useDesignStore.ts:1416  (addFurniture)
   *   src/store/useDesignStore.ts:1594  (addWall)
   *   src/store/useDesignStore.ts:1672  (addOpening)
   *
   * — the five creating actions, which is exactly the set §6 v3 names. The
   * FIRST run of that demonstration found only three of them, which is how the
   * key-versus-mention weakness below was found.
   */
  it('every element construction sets provenance in the same literal', () => {
    const offenders: string[] = []

    for (const path of sourceFiles()) {
      const text = readFileSync(path, 'utf8')
      if (/\.test\.tsx?$/.test(path)) continue

      const lines = text.split('\n')
      lines.forEach((line, i) => {
        if (!/\bid:\s*crypto\.randomUUID\(\)/.test(line)) return

        // `FloorData` is not one of §6 v3's five element types — a storey is a
        // container, and it becomes a first-class `Level` with its own fields
        // in v4. Named explicitly so adding provenance to it later is a
        // decision rather than an accident of this regex.
        const window = lines.slice(Math.max(0, i - 6), i + 8).join('\n')
        if (/FloorData|emptyFloor/.test(window)) return

        // `provenance` as an object KEY — `provenance:` or a shorthand
        // `provenance,`. A bare mention is not enough: the first draft of this
        // test matched the word anywhere in the window, so the PARAMETER in
        // `nameRoom: (anchor, type, provenance) =>` satisfied it and two of
        // the five unstamped actions went undetected.
        if (!/provenance\s*[:,]/.test(window)) {
          offenders.push(`${rel(path)}:${i + 1}`)
        }
      })
    }

    expect(
      offenders,
      'Every element must record where it came from (L5, §6 v3). Build it ' +
        'with one of the constructors in store/provenance.ts. Do NOT default ' +
        "to 'manual': addWall's callers are two-thirds CV, and a default " +
        'would label machine output as hand-drawn — the exact failure L5 ' +
        'exists to prevent.',
    ).toEqual([])
  })

  it('no call site invents a Provenance literal instead of using a constructor', () => {
    const offenders = sourceFiles()
      .filter((p) => !/\.test\.tsx?$/.test(p))
      .map((p) => ({ path: rel(p), text: readFileSync(p, 'utf8') }))
      .filter((f) => !f.path.endsWith('src/store/provenance.ts'))
      // The migration builds its own, and must: it is the only writer of
      // `'unknown'`, and it takes `createdAt` from the file rather than the
      // clock. Every other hand-rolled literal is a call site that will drift.
      .filter((f) => !f.path.endsWith('src/persistence/schema.ts'))
      .filter((f) => /provenance:\s*\{\s*source:/.test(f.text))
      .map((f) => f.path)

    expect(
      offenders,
      'Use store/provenance.ts. A literal here is how confidence, createdAt ' +
        'and sourceRef drift apart between call sites.',
    ).toEqual([])
  })

  it('the CV constructor does not claim a confidence', () => {
    // `scoreSegments` returns total detected wall length in PIXELS — unbounded,
    // and only meaningful when ranking two binarisations of the same image.
    // ADR 0002 measured it preferring 75 imaginary walls totalling 77,592 px to
    // 7 real ones totalling 6,300 px, so a higher score can mean a worse read.
    // Presenting it as a 0–1 confidence would put a fabricated number under the
    // one field that exists to tell the user what to trust.
    expect(provenance.cv('plan.png').confidence).toBeUndefined()
    expect(provenance.cv('plan.png').source).toBe('cv')
    expect(provenance.ai().confidence).toBeUndefined()

    // Deterministic paths do claim it.
    expect(provenance.manual().confidence).toBe(1)
    expect(provenance.copy('w1').confidence).toBe(1)
  })
})

describe('B7.4 — the real sources', () => {
  it('the draw tools record manual, with full confidence', () => {
    resetStore()
    const id = useDesignStore
      .getState()
      .addWall({ x: 0, z: 0 }, { x: 4, z: 0 }, { provenance: provenance.manual() })

    const wall = useDesignStore.getState().walls.find((w) => w.id === id)!
    expect(wall.provenance?.source).toBe('manual')
    expect(wall.provenance?.confidence).toBe(1)
    expect(wall.provenance?.createdAt).toBeTruthy()
  })

  it('★ the duplicate-floor path records copy, and keeps the original id', () => {
    resetStore()
    const walls = rectangleWalls()
    useDesignStore.setState({ walls })
    useDesignStore.getState().nameRoom({ x: 2, z: 1.5 }, 'kitchen', provenance.manual())

    expect(useDesignStore.getState().copyToNextFloor()).toBe(true)

    const copied = useDesignStore.getState().floors[1]
    expect(copied.walls).toHaveLength(4)
    for (const wall of copied.walls) {
      expect(wall.provenance?.source).toBe('copy')
      // Fresh ids, so `sourceRef` is the only place the original stays
      // recoverable — which is what makes it worth recording.
      expect(walls.some((w) => w.id === wall.provenance?.sourceRef)).toBe(true)
      expect(wall.id).not.toBe(wall.provenance?.sourceRef)
    }
    expect(copied.roomLabels[0].provenance?.source).toBe('copy')
  })

  it('sourceRef carries the blueprint filename for a CV wall', () => {
    expect(provenance.cv('ground-floor.png').sourceRef).toBe('ground-floor.png')
    // Absent rather than empty when there is nothing to point at.
    expect(provenance.cv().sourceRef).toBeUndefined()
    expect(provenance.cv('').sourceRef).toBeUndefined()
  })

  it('every constructor produces something parseProvenance accepts', () => {
    const all = [
      provenance.manual(),
      provenance.cv('a.png'),
      provenance.ai('req-1'),
      provenance.copy('w1'),
      provenance.importJson('plan.json'),
    ]
    for (const p of all) {
      expect(typeof p.source).toBe('string')
      expect(typeof p.createdAt).toBe('string')
      if (p.confidence !== undefined) {
        expect(p.confidence).toBeGreaterThanOrEqual(0)
        expect(p.confidence).toBeLessThanOrEqual(1)
      }
    }
  })
})
