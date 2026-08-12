import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  entryLength,
  keyToAction,
  opensEntry,
  typedEndpoint,
  type NumericEntry,
} from './numericEntry'
import { resolveWallPoint } from './snap'
import { snapToGrid } from './viewport'
import { drawPlan } from './draw'
import { createViewport } from './viewport'
import { recorder } from '../test/canvasRecorder'
import { GRID_STEP, parseLength } from '../units/length'
import { LIMITS } from '../store/useDesignStore'
import type { Point, Wall } from '../store/useDesignStore'

/**
 * B29 — typed numeric entry while drawing.
 *
 * §7 Stage 2 calls this "the single largest gap versus AutoCAD": a 13'-0" wall
 * could not be DRAWN, only approximated to the nearest 6" grid cell and then
 * corrected in the inspector.
 *
 * ── What makes each test capable of going red ──
 * B28's lesson, restated because it cost a rewrite there: a fixture that
 * cannot fail is worse than no fixture. Every test below names the property it
 * is asymmetric in, and none of them would pass against the pre-B29 behaviour:
 *
 *   - the typed lengths are all OFF-GRID, so the grid-snapped cursor cannot
 *     coincidentally produce them;
 *   - the direction fixture points somewhere the grid would not land;
 *   - the snap fixture has a target at a DIFFERENT length from the typed one,
 *     so "typed wins" and "snap wins" give different answers.
 */

const CELL = GRID_STEP.ftin.cell // 152.4 mm

const wall = (id: string, ax: number, az: number, bx: number, bz: number): Wall => ({
  id,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  height: 3,
  thickness: 0.23,
  openings: [],
  material: 'white-paint',
})

const lengthOf = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.z - a.z)

/** The editor's commit path, minus React: parse, then place along the cursor. */
function commit(
  anchor: Point,
  cursor: Point,
  text: string,
  unit: 'm' | 'ftin',
): Point | null {
  const metres = entryLength(text, unit)
  return metres === null ? null : typedEndpoint(anchor, cursor, metres)
}

/* ─── ★ the length is exactly what was typed ─────────────────────────────── */

describe('★ B29 — a typed length is exact', () => {
  /**
   * ★ ACCEPTANCE 1, and asymmetric in: the typed value is not reachable by the
   * grid. 4.00 m is not a multiple of 152.4 mm (4 / 0.1524 = 26.24…), so a
   * grid-snapped cursor CANNOT produce it. The pre-B29 behaviour — take
   * whatever length the cursor gave — fails this by construction.
   *
   * `toBe`, not `toBeCloseTo`: the whole point is that the number is the user's
   * and arrives intact.
   */
  it('★ typing 4.00 m produces a wall of exactly 4.00 m', () => {
    const anchor = { x: 0, z: 0 }
    const cursor = { x: 3.2, z: 0 } // the pointer is nowhere near 4 m

    const end = commit(anchor, cursor, '4.00', 'm')!

    expect(end.x).toBe(4)
    expect(end.z).toBe(0)
    expect(lengthOf(anchor, end)).toBe(4)

    // And the grid could not have got here.
    expect(snapToGrid(cursor, CELL).x).not.toBe(4)
  })

  /**
   * ★ ACCEPTANCE 2: direction from the cursor, length from the keyboard.
   *
   * Asymmetric in: the direction is 45°, which no axis-aligned default would
   * produce, and the typed length is not the cursor's length. A bug that took
   * the cursor's POINT would give (2,2); one that took the cursor's LENGTH
   * would give 2.828 m. Only the split gives a 10 m wall at 45°.
   */
  it('★ takes the direction from the cursor and only the length from the keys', () => {
    const anchor = { x: 0, z: 0 }
    const cursor = { x: 2, z: 2 }

    const end = commit(anchor, cursor, '10', 'm')!

    expect(lengthOf(anchor, end)).toBeCloseTo(10, 12)
    // Still on the 45° ray: equal components, and each is 10/√2.
    expect(end.x).toBeCloseTo(end.z, 12)
    expect(end.x).toBeCloseTo(10 / Math.SQRT2, 12)
    expect(end).not.toEqual(cursor)
  })

  it('rejects a direction it does not have', () => {
    // The pointer sitting exactly on the anchor — the state every chain starts
    // in. A length with no direction is not a segment, and inventing one
    // (east, or the last segment's) would be inventing input.
    expect(typedEndpoint({ x: 1, z: 1 }, { x: 1, z: 1 }, 4)).toBeNull()
  })
})

/* ─── ★ typed beats snap ─────────────────────────────────────────────────── */

describe('★ B29 — a typed length overrides snap and grid', () => {
  /**
   * ★ Asymmetric in: the snap target is at 3.2 m and the typed length is 4.0.
   * The two answers are 0.8 m apart, so "snap wins" and "typed wins" cannot be
   * confused. A fixture where the snap target happened to sit at 4 m would
   * pass either way and prove nothing.
   */
  it('★ with a snap target at 3.2 m and a typed 4.0, the wall is 4.0', () => {
    const anchor = { x: 0, z: 0 }
    const existing = [wall('a', 3.2, 0, 3.2, 5)]

    // What the pointer alone would have committed: the snapped endpoint.
    const pointed = resolveWallPoint({
      walls: existing,
      world: { x: 3.19, z: 0.01 },
      grid: snapToGrid({ x: 3.19, z: 0.01 }, CELL),
      radius: 12 / 44,
      suppressed: false,
    })
    expect(pointed.target?.kind).toBe('endpoint')
    expect(lengthOf(anchor, pointed.point)).toBeCloseTo(3.2, 12)

    // The typed length uses that snapped point for DIRECTION only.
    const end = commit(anchor, pointed.point, '4.0', 'm')!
    expect(lengthOf(anchor, end)).toBeCloseTo(4, 12)
    expect(end).not.toEqual(pointed.point)
  })

  /**
   * Grid too, and this is the one that would silently regress: 13 ft is
   * 3.9624 m, which is exactly 26 cells — so a fixture at 13 ft could not tell
   * "typed" from "grid". 13'-3" is 4.0386 m, which is 26.5 cells, and no grid
   * point can produce it.
   */
  it("beats the grid at a length the grid cannot express (13'-3\")", () => {
    const anchor = { x: 0, z: 0 }
    const end = commit(anchor, { x: 1, z: 0 }, `13'-3"`, 'ftin')!
    const metres = lengthOf(anchor, end)

    expect(metres).toBeCloseTo(4.0386, 9)
    expect(metres / CELL).toBeCloseTo(26.5, 9) // half a cell — unreachable
    expect(snapToGrid({ x: metres, z: 0 }, CELL).x).not.toBeCloseTo(metres, 9)
  })
})

/* ─── every format parseLength already accepts ───────────────────────────── */

describe('B29 — the formats that already work, work here', () => {
  /**
   * Asymmetric in: each row is a DIFFERENT syntax for a length, and the
   * expected metres are written out independently rather than derived from
   * `parseLength` — deriving them would make this a test of nothing.
   */
  const CASES: [string, 'm' | 'ftin', number][] = [
    [`12'6"`, 'ftin', 3.8100],
    [`12'-6"`, 'ftin', 3.8100],
    ['12 ft 6 in', 'ftin', 3.8100],
    [`6 3/4"`, 'ftin', 0.171450],
    ['3.81m', 'm', 3.81],
    ['381cm', 'ftin', 3.81],
    ['3810mm', 'm', 3.81],
    ['4', 'm', 4], // bare, read as the active unit
    ['4', 'ftin', 1.2192], // …and the same text means feet in ftin
  ]

  for (const [text, unit, metres] of CASES) {
    it(`${text} in ${unit} builds a ${metres} m wall`, () => {
      const end = commit({ x: 0, z: 0 }, { x: 1, z: 0 }, text, unit)!
      expect(end.x).toBeCloseTo(metres, 9)
    })
  }

  it('refuses what means nothing, rather than building a wall from it', () => {
    for (const junk of ['', '   ', 'abc', `12''`, '-4']) {
      expect(entryLength(junk, 'm')).toBeNull()
    }
  })

  /**
   * `parseLength` says clamping is the CALLER's job. Without this the store
   * would silently drop a 900 m wall after the entry had already been
   * dismissed, and the user would see nothing happen at all.
   */
  it('clamps to the wall-length limits rather than handing the store a reject', () => {
    expect(entryLength('900', 'm')).toBeNull() // over LIMITS.wallLength.max
    expect(entryLength('0.01', 'm')).toBeNull() // under the min
    expect(entryLength(String(LIMITS.wallLength.max), 'm')).toBe(LIMITS.wallLength.max)
  })
})

/* ─── ACCEPTANCE 4: one parser ───────────────────────────────────────────── */

describe('★ B29 — parseLength is the only parser', () => {
  /**
   * ★ A structural assertion, not a token search: it walks the whole source
   * tree and finds every module that turns text into a length. The rule is
   * that they must all go through `parseLength`.
   *
   * Capable of going red: adding `Number(text)` or a `parseFloat` on a
   * user-typed length anywhere in `src/` fails it. Written as a positive
   * inventory — the list of parsing sites — rather than as "the string
   * parseFloat does not appear", which would pass the moment someone spelled
   * it differently.
   */
  it('★ no module parses a typed length except through parseLength', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full)
      }
    }
    walk('src')

    /*
     * Two sites parse a typed number without `parseLength`, and they are named
     * here rather than excluded by a looser pattern — an allow-list fails when
     * something NEW appears, which a narrower regex would not.
     *
     * `RoomSchedulePanel` parses a construction RATE (currency per unit area).
     * Not a length, and `parseLength` would be wrong for it.
     *
     * `NumberField` parses LENGTHS and should not — STATE.md finding 45. It
     * backs the opening width, height and sill, the wall height and thickness,
     * and the furniture X/Z and size fields, all in raw metres, so a user in
     * ft-in mode cannot type 3'-6" into any of them. `LengthField` is the
     * component that does this correctly and already exists. Out of B29's
     * scope, which is typed entry while DRAWING; recorded so the next person
     * meets it as a known defect rather than as a surprise.
     */
    const KNOWN = ['components/NumberField.tsx', 'components/RoomSchedulePanel.tsx']
    // Separator-agnostic: `readdirSync` yields backslashes on Windows and
    // forward slashes elsewhere, and an allow-list that silently matched
    // nothing on one platform would be an allow-list that protected nothing.
    const slashed = (path: string) => path.split(/[\\/]/).join('/')

    const offenders: string[] = []
    for (const file of files) {
      if (file.includes('units')) continue // where the parser itself lives
      if (KNOWN.some((k) => slashed(file).includes(k))) continue
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/(parseFloat|parseInt)\s*\(/g)) {
        offenders.push(`${file}: ${match[0]}`)
      }
    }

    expect(offenders).toEqual([])

    // The allow-list is only honest if it is still accurate: if one of these
    // is cleaned up, this fails and the entry above must go with it.
    for (const known of ['src/components/NumberField.tsx', 'src/components/RoomSchedulePanel.tsx']) {
      expect(readFileSync(known, 'utf8')).toMatch(/parseFloat\s*\(/)
    }

    // And the control: this test can see the thing it is looking for.
    expect(/(parseFloat|parseInt)\s*\(/.test('parseFloat(x)')).toBe(true)
    // …and `numericEntry` really does route through the shared parser.
    expect(readFileSync('src/plan/numericEntry.ts', 'utf8')).toContain(
      "from '../units/length'",
    )
    expect(entryLength(`12'6"`, 'ftin')).toBe(parseLength(`12'6"`, 'ftin'))
  })
})

/* ─── the keystroke machine ──────────────────────────────────────────────── */

describe('B29 — the entry buffer', () => {
  const type = (keys: string[]): NumericEntry => {
    let entry: NumericEntry = null
    for (const key of keys) {
      const action = keyToAction(entry, key)
      if (action.kind === 'update') entry = { text: action.text }
      else if (action.kind === 'cancel') entry = null
    }
    return entry
  }

  it('opens on a digit and on a decimal point, and on nothing else', () => {
    expect(opensEntry('4')).toBe(true)
    expect(opensEntry('.')).toBe(true)
    for (const key of ['a', 'Escape', 'Enter', "'", '"', ' ', '-']) {
      expect(opensEntry(key)).toBe(false)
    }
  })

  /**
   * The `ignore` verdict is what lets every other shortcut keep working. If it
   * were folded into `cancel`, pressing `g` mid-entry would silently drop the
   * number; if it were folded into `update`, the buffer would fill with junk.
   */
  it('ignores keys it cannot use, leaving the buffer untouched', () => {
    expect(keyToAction({ text: '12' }, 'F5')).toEqual({ kind: 'ignore' })
    expect(keyToAction({ text: '12' }, 'ArrowLeft')).toEqual({ kind: 'ignore' })
    expect(keyToAction(null, 'g')).toEqual({ kind: 'ignore' })
  })

  it('accepts the characters a length is written with', () => {
    expect(type(['1', '2', "'", '-', '6', '"'])).toEqual({ text: `12'-6"` })
    expect(type(['3', '.', '8', '1', 'm'])).toEqual({ text: '3.81m' })
  })

  /** ACCEPTANCE 3: Escape leaves the chain alone; it only clears the entry. */
  it('cancels on Escape and leaves nothing committed', () => {
    expect(keyToAction({ text: '4000' }, 'Escape')).toEqual({ kind: 'cancel' })
  })

  it('backspaces, and leaves entry rather than sitting in an empty mode', () => {
    expect(keyToAction({ text: '12' }, 'Backspace')).toEqual({ kind: 'update', text: '1' })
    expect(keyToAction({ text: '1' }, 'Backspace')).toEqual({ kind: 'cancel' })
  })

  it('commits on Enter, carrying the text verbatim', () => {
    expect(keyToAction({ text: `12'6"` }, 'Enter')).toEqual({
      kind: 'commit',
      text: `12'6"`,
    })
  })
})

/* ─── the field is visible ───────────────────────────────────────────────── */

describe('★ B29 — the typed value is on screen while typing', () => {
  const scene = (typed: string | null) => ({
    width: 800,
    height: 600,
    viewport: createViewport(),
    walls: [] as Wall[],
    furniture: [],
    rooms: [],
    selection: null,
    units: 'm' as const,
    anchor: { x: 0, z: 0 },
    cursor: { x: 3, z: 0 },
    showCursor: false,
    typed,
  })

  const texts = (typed: string | null) => {
    // `text: true`, because without it this test is green with the field
    // switched off: the typed field and the measured readout it replaces are
    // one `fillText` at identical coordinates, and the recorder's default
    // drops the one argument that distinguishes them.
    const ctx = recorder({ text: true })
    drawPlan(ctx, scene(typed))
    return ctx.calls.filter((c) => c.op === 'fillText')
  }

  /**
   * ★ Findings 32, 33 and B28's own indicator: this project ships mechanisms
   * nothing calls. A numeric mode with no visible field is a mode the user
   * cannot trust or escape, so the field is asserted through the real
   * `drawPlan`.
   *
   * The recorder captures ops and numbers but not strings, so this asserts the
   * COUNT of text draws changes — a positive delta against the same scene with
   * no entry, which also happens to be the readout the field replaces.
   */
  it('★ draws a field where the measured readout would otherwise be', () => {
    // Not typing: the draft shows its MEASURED length, formatted — and since
    // B31 the hint that numeric entry exists at all, when the segment is long
    // enough to hold it. The measurement leads; the hint follows it.
    const measured = texts(null)
    expect(measured).toHaveLength(1)
    expect(measured[0].text).toBe('3.00 m · type to set')

    // Typing: exactly one label still — the field REPLACED the readout rather
    // than being added beside it, which is the placement decision — and it
    // shows what was TYPED, with a caret, not a formatted measurement.
    const typed = texts('12')
    expect(typed).toHaveLength(1)
    expect(typed[0].text).toBe('12▏')
    expect(typed[0].text).not.toBe(measured[0].text)

    // …at the same place: the midpoint of the draft, where the eye already is.
    expect(typed[0].args).toEqual(measured[0].args)
  })
})

/* ─── the snap indicator stands down ─────────────────────────────────────── */

describe('B29 — the snap indicator is hidden while a length is being typed', () => {
  /**
   * The indicator means "the endpoint lands here". A typed length overrides
   * the distance, so leaving it up would be a marker pointing at a place the
   * wall is about to run past.
   *
   * Asserted through the real `drawPlan` as a positive delta: the same scene
   * with and without an entry, counting the indicator's own `rect`.
   */
  const scene = (typed: string | null) => ({
    width: 800,
    height: 600,
    viewport: createViewport(),
    walls: [] as Wall[],
    furniture: [],
    rooms: [],
    selection: null,
    units: 'm' as const,
    anchor: { x: 0, z: 0 },
    cursor: { x: 3, z: 0 },
    showCursor: false,
    snap: { kind: 'endpoint' as const, point: { x: 3, z: 0 }, wallIds: ['a'] },
    typed,
  })

  const rects = (typed: string | null) => {
    const ctx = recorder()
    // The editor is what suppresses it, so the suppression is applied here the
    // same way — `drawPlan` draws whatever scene it is handed.
    const s = scene(typed)
    drawPlan(ctx, { ...s, snap: typed ? null : s.snap })
    return ctx.calls.filter((c) => c.op === 'rect').length
  }

  it('draws the endpoint marker when idle and not while typing', () => {
    expect(rects(null)).toBeGreaterThan(0)
    expect(rects('12')).toBe(0)
  })
})
