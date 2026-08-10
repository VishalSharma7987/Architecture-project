import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allFloors, emptyFloor, useDesignStore } from './useDesignStore'
import { rectangleWalls, resetStore } from '../test/fixtures'

/**
 * M1 — the checked-out floor invariant, made enforceable.
 *
 * `floors[activeFloor]` is DELIBERATELY allowed to go stale: while a storey is
 * open, the top-level `walls` / `furniture` / `roomLabels` / `stairs` ARE that
 * storey, and the thirty-odd things that read the design keep reading them
 * without knowing floors exist. The two are reconciled in exactly three places.
 *
 * The problem is that nothing enforced it. `state.floors` has the same type
 * whether it is fresh or stale, so `strict`, the linter and the whole suite are
 * all blind to a reader that takes it at face value — and the failure is silent
 * wrong data: the last-switched-away-from version of the open storey, which
 * looks entirely plausible in an area total or a cost sheet. It was documented
 * in a comment and enforced by whoever remembered to read it.
 *
 * This is that comment as a test, in the shape `calibration.test.ts` already
 * uses for the single-writer rule on `metresPerPixel`.
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

type SourceFile = { path: string; text: string }

/**
 * Everything that could get this wrong.
 *
 * The store itself is excluded because it OWNS the invariant — the three
 * reconciliation points are in it, and they are the only code allowed to touch
 * a stale entry. Tests and fixtures are excluded because `resetStore` writes
 * `floors` wholesale on purpose.
 */
function readersOfTheDesign(): SourceFile[] {
  return sourceFiles()
    .map((path) => ({
      path: relative(process.cwd(), path).replace(/\\/g, '/'),
      text: readFileSync(path, 'utf8'),
    }))
    .filter((f) => f.path !== 'src/store/useDesignStore.ts')
    .filter((f) => !/\.test\.tsx?$/.test(f.path))
    .filter((f) => !f.path.startsWith('src/test/'))
}

/**
 * Ways of reading the STORE's `floors`, as opposed to some other object's.
 *
 * Deliberately narrow: `doc.floors`, `input.floors` and `statement.floors` are
 * different arrays with no invariant on them, and a blanket `\.floors\b` would
 * flag every one of them and be turned off within a week.
 */
const RAW_READS = [
  // useDesignStore((s) => s.floors)
  /useDesignStore\(\s*\(\s*(\w+)\s*\)\s*=>\s*\1\.floors\b/,
  // useDesignStore.getState().floors
  /useDesignStore\.getState\(\)\.floors\b/,
  // const { floors } = useDesignStore.getState()
  /const\s*\{[^}]*\bfloors\b[^}]*\}\s*=\s*useDesignStore\.getState\(\)/,
]

const readsRawFloors = (f: SourceFile) => RAW_READS.some((re) => re.test(f.text))
const foldsThroughAllFloors = (f: SourceFile) => /\ballFloors\s*\(/.test(f.text)

describe('★ the checked-out floor invariant', () => {
  it('no module reads the store’s floors without folding them through allFloors', () => {
    const offenders = readersOfTheDesign()
      .filter(readsRawFloors)
      .filter((f) => !foldsThroughAllFloors(f))
      .map((f) => f.path)

    expect(
      offenders,
      'floors[activeFloor] is deliberately stale while that storey is open. ' +
        'Reading state.floors directly gets the last-switched-away-from copy ' +
        'of whatever the user is editing — silently, and with the right type. ' +
        'Subscribe to the parts and fold them with allFloors(), as Building, ' +
        'Toolbar and RoomSchedulePanel do.',
    ).toEqual([])
  })

  it('no module outside the store writes floors into the store', () => {
    const offenders = readersOfTheDesign()
      .filter((f) => /setState\(\s*\{[^}]*\bfloors\s*:/.test(f.text))
      .map((f) => f.path)

    expect(
      offenders,
      'Writing floors from outside the store bypasses fileActiveFloor, which ' +
        'is the only thing that folds the open storey back into storage.',
    ).toEqual([])
  })

  it('keeps allFloors as a real export, so the rule above can be obeyed', () => {
    expect(typeof allFloors).toBe('function')
  })
})

/**
 * The behaviour the rule protects, stated once so the regex above is not the
 * only description of it.
 */
describe('allFloors folds the open storey back over the stale entry', () => {
  it('returns the open storey as it is now, not as it was filed', () => {
    resetStore()
    useDesignStore.setState({
      floors: [emptyFloor(0), emptyFloor(1), emptyFloor(2)],
      activeFloor: 0,
      walls: rectangleWalls(),
    })

    const state = useDesignStore.getState()
    expect(state.floors[0].walls, 'the stored entry is stale by design').toHaveLength(0)
    expect(allFloors(state)[0].walls, 'allFloors sees the live edit').toHaveLength(4)
  })

  it('leaves the storeys that are not open alone', () => {
    resetStore()
    useDesignStore.setState({
      floors: [emptyFloor(0), emptyFloor(1), emptyFloor(2)],
      activeFloor: 1,
      walls: rectangleWalls(),
    })

    const folded = allFloors(useDesignStore.getState())
    expect(folded[1].walls).toHaveLength(4)
    expect(folded[0].walls).toHaveLength(0)
    expect(folded[2].walls).toHaveLength(0)
  })
})
