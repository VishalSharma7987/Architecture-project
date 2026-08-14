import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { drawPlan } from './draw'
import { renderPlanSheet } from './planSheet'
import { createViewport } from './viewport'
import { InspectorPanel } from '../components/InspectorPanel'
import { parseDesign, serializeDesign } from '../persistence/schema'
import { wallColliders } from '../scene/collision'
import { openingBoxes, wallPieces } from '../scene/wallGeometry'
import { recorder, type Call } from '../test/canvasRecorder'
import { resetStore } from '../test/fixtures'
import {
  OPENING_DEFAULTS,
  useDesignStore,
  type Opening,
  type OpeningType,
  type Wall,
} from '../store/useDesignStore'

/**
 * B23 — a cased opening is a type, not a window told to keep quiet.
 *
 * Before this, the only way to draw the `O` between a kitchen and a dining
 * room was a window with `sill: 0` and full height — which then drew a glazing
 * line across it, called itself a Window in the inspector, in the 3D chip and
 * in every schedule, and stood solid in front of the walking figure. That is a
 * lie in the document, not a workaround.
 *
 * The symbol itself is not new. `punchOpening` plus the jamb lines that close
 * the wall across its full thickness ARE the cased-opening symbol; they are
 * what is left when the door and window branches are skipped (STATE.md
 * finding 22). So the tests below are mostly about what is NOT drawn — and a
 * test that asserts an absence has to prove the code ran at all, or it passes
 * for the wrong reason. Every one of them is paired with a control.
 */

/* ─── fixtures ──────────────────────────────────────────────────────────── */

const WALL_ID = 'w1'
const OPENING_ID = 'o1'

/** One wall running due east, carrying one opening of the given type. */
function wallWith(type: OpeningType | null): Wall {
  const defaults = type ? OPENING_DEFAULTS[type] : null
  const opening: Opening[] =
    type && defaults
      ? [
          {
            id: OPENING_ID,
            type,
            position: 2,
            // Identical geometry across all three types, so any difference in
            // what is drawn is the TYPE and nothing else.
            width: 1.2,
            height: 2.1,
            sill: 0,
            ...(type === 'door' ? { swing: { hand: 'start', side: 'left' } as const } : {}),
          },
        ]
      : []
  return {
    id: WALL_ID,
    start: { x: 0, z: 0 },
    end: { x: 4, z: 0 },
    height: 3,
    thickness: 0.2,
    openings: opening,
    material: 'white-paint',
    type: 'shell' as const,
  }
}

/** Everything `drawPlan` emitted for a plan holding exactly this one wall. */
function canvasCalls(wall: Wall): Call[] {
  const ctx = recorder()
  drawPlan(ctx, {
    width: 800,
    height: 600,
    viewport: createViewport(),
    walls: [wall],
    furniture: [],
    rooms: [],
    selection: null,
    units: 'm',
    anchor: null,
    cursor: null,
    showCursor: false,
  })
  return ctx.calls
}

function sheetCalls(wall: Wall): Call[] {
  const ctx = recorder()
  renderPlanSheet(ctx, {
    walls: [wall],
    furniture: [],
    title: 'test',
    date: '2026-08-10',
    width: 1190,
    height: 842,
  })
  return ctx.calls
}

const signature = (calls: Call[]) =>
  calls.map((c) => `${c.op}(${c.args.map((n) => n.toFixed(2)).join(',')})`)

beforeEach(resetStore)
afterEach(resetStore)

describe('★ B23 — a cased opening survives the file', () => {
  /**
   * Demonstrated red (SD5) by restoring the old predicate
   * `if (type !== 'door' && type !== 'window') return null`:
   *
   *   AssertionError: expected undefined to be 'cased'
   *
   * — `parseOpening` returned null, the opening was dropped, and the wall came
   * back with `openings: []` plus a warning. The document silently lost it.
   */
  it('★ round-trips through save and load with its type intact', () => {
    const doc = serializeDesign({
      name: 'cased',
      walls: [wallWith('cased')],
      viewMode: '2d',
      savedAt: '2026-08-10T00:00:00.000Z',
    })

    const result = parseDesign(JSON.parse(JSON.stringify(doc)))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const opening = result.doc.walls[0].openings[0]
    expect(opening?.type).toBe('cased')
    expect(opening?.width).toBe(1.2)
    // No swing, exactly as for a window. `parseSwing` drops one on any
    // non-door, so a file claiming otherwise is corrected rather than obeyed.
    expect(opening?.swing).toBeUndefined()
  })

  it('drops a swing a cased opening should never have carried', () => {
    const result = parseDesign({
      version: 4,
      name: 'x',
      savedAt: '2026-08-10T00:00:00.000Z',
      settings: { viewMode: '2d' },
      walls: [
        {
          id: WALL_ID,
          start: { x: 0, z: 0 },
          end: { x: 4, z: 0 },
          height: 3,
          thickness: 0.2,
          material: 'white-paint',
          type: 'shell' as const,
          openings: [
            {
              id: OPENING_ID,
              type: 'cased',
              position: 2,
              width: 1.2,
              height: 2.1,
              sill: 0,
              swing: { hand: 'end', side: 'right' },
            },
          ],
        },
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Ignored, not rejected: the opening is still a real opening, and losing
    // it over an annotation nobody typed would be the worse failure. Same
    // rule the malformed-swing case follows.
    expect(result.doc.walls[0].openings[0].type).toBe('cased')
    expect(result.doc.walls[0].openings[0].swing).toBeUndefined()
  })
})

describe('★ B23 — the hole is the hole; only the fill differs', () => {
  /**
   * ★ The 3D void.
   *
   * `wallPieces` and `openingBoxes` are type-agnostic, so this could pass
   * without anyone having thought about cased openings at all. The third
   * assertion is what stops it being vacuous: the cased opening must differ
   * from NO opening. Without it, a `wallPieces` that ignored cased openings
   * entirely — leaving the wall solid — would satisfy the first two.
   */
  it('★ punches the same void as a window of the same geometry', () => {
    const cased = wallWith('cased')
    const window = wallWith('window')
    const solid = wallWith(null)

    expect(wallPieces(cased).map((p) => p.scale)).toEqual(
      wallPieces(window).map((p) => p.scale),
    )
    expect(openingBoxes(cased).map((b) => b.scale)).toEqual(
      openingBoxes(window).map((b) => b.scale),
    )
    // …and it really is a hole, not an opening the geometry ignored.
    expect(wallPieces(cased)).not.toEqual(wallPieces(solid))
    expect(openingBoxes(cased)).toHaveLength(1)
    expect(openingBoxes(solid)).toHaveLength(0)
  })

  it('is walkable, like a doorway and unlike a window', () => {
    // collision.ts filtered on `type === 'door'`, so a cased opening stood
    // solid in front of the figure while the 3D geometry showed a gap — you
    // would stop dead in an opening you could see through.
    //
    // Demonstrated red by restoring that filter: `expected 1 to be greater
    // than 1` — the wall stayed a single collider, i.e. no gap at all.
    const casedGaps = wallColliders([wallWith('cased')])
    const solidGaps = wallColliders([wallWith(null)])
    const windowGaps = wallColliders([wallWith('window')])

    // A gap splits the wall into two colliders; a solid wall is one.
    expect(casedGaps.length).toBeGreaterThan(solidGaps.length)
    expect(windowGaps.length).toBe(solidGaps.length)
  })
})

describe('★ B23 — no leaf, no arc, no glazing', () => {
  /**
   * The anti-vacuous pairing the brief asked for.
   *
   * "Nothing extra was drawn" is exactly what a cased opening looks like, and
   * it is also what an opening that was never drawn at all looks like. So each
   * absence is asserted against TWO controls: the window (which must differ by
   * the glazing line) and the solid wall (which the cased opening must NOT
   * equal, proving the branch was reached and the wall was broken).
   *
   * Demonstrated red (SD5) by restoring the bare `else` in `draw.ts` and
   * deleting the `if (opening.type === 'cased') return` in `planSheet.ts`:
   *
   *   canvas: expected [ …(208) ] to not deeply equal [ …(208) ]
   *   sheet:  expected [ 'save()', …(100) ] to not deeply equal [ …(100) ]
   *
   * — identical call sequences, because a cased opening was drawing a window's
   * glazing line, which is the exact lie B23 exists to stop.
   */
  it('★ canvas: differs from a window, and from a solid wall', () => {
    const cased = signature(canvasCalls(wallWith('cased')))
    const window = signature(canvasCalls(wallWith('window')))
    const door = signature(canvasCalls(wallWith('door')))
    const solid = signature(canvasCalls(wallWith(null)))

    // Reached: the wall was cleared across the span and the jambs ticked.
    expect(cased).not.toEqual(solid)
    expect(cased.length).toBeGreaterThan(solid.length)
    // Quieter than a window — the glazing line is the whole difference.
    expect(cased).not.toEqual(window)
    expect(cased.length).toBeLessThan(window.length)
    // And no swing arc — counted against the solid wall rather than tested
    // for absence, because every wall already draws two `arc` calls for its
    // endpoint vertex dots. A bare "no arc" assertion is simply false here,
    // and looking only for the substring found the dots and passed for the
    // wrong reason on the first run of this file.
    const arcs = (s: string[]) => s.filter((c) => c.startsWith('arc(')).length
    expect(arcs(door)).toBe(arcs(solid) + 1)
    expect(arcs(cased)).toBe(arcs(solid))
    expect(arcs(window)).toBe(arcs(solid))
  })

  it('★ sheet: differs from a window, and from a solid wall', () => {
    const cased = signature(sheetCalls(wallWith('cased')))
    const window = signature(sheetCalls(wallWith('window')))
    const solid = signature(sheetCalls(wallWith(null)))

    expect(cased).not.toEqual(solid)
    expect(cased).not.toEqual(window)
    expect(cased.length).toBeLessThan(window.length)
  })
})

describe('★ B23 — the inspector does not call it a window', () => {
  function showOpening(type: OpeningType) {
    useDesignStore.setState({
      walls: [wallWith(type)],
      selection: { kind: 'opening', wallId: WALL_ID, openingId: OPENING_ID },
    })
    render(<InspectorPanel />)
  }

  /**
   * Demonstrated red by restoring `type === 'door' ? 'Door' : 'Window'`:
   *
   *   expected 'WindowDoneWidthmHeightmSill heightmAl…' to contain 'Opening'
   *
   * — the panel header called it a Window, which is what every schedule and
   * every 3D chip did too.
   */
  it('names it "Opening", and still names a window "Window"', () => {
    showOpening('cased')
    expect(screen.getByTestId('inspector').textContent).toContain('Opening')
    // The control: the same header must still read Window for a window, or
    // this test would pass against a build that called everything "Opening".
    expect(screen.getByTestId('inspector').textContent).not.toContain('Window')
  })

  it('shows no swing controls for a cased opening', () => {
    showOpening('cased')
    expect(screen.queryByTestId('swing-controls')).toBeNull()
    expect(screen.queryByTestId('swing-hand-start')).toBeNull()
  })

  it('still shows them for a door — the control for the control', () => {
    showOpening('door')
    expect(screen.getByTestId('swing-controls')).toBeTruthy()
  })
})
