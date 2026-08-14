import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { drawPlan } from './draw'
import { extentOf, deviationFrom, describeDeviation } from './extent'
import { recorder } from '../test/canvasRecorder'
import { resetStore } from '../test/fixtures'
import { resolveRoomsUncached } from '../rooms/resolve'
import { parseDesign, serializeDesign } from '../persistence/schema'
import { InspectorPanel } from '../components/InspectorPanel'
import {
  MIGRATION_TYPE_SPLIT,
  WALL_TYPE_THICKNESS,
  useDesignStore,
  wallTypeFromThickness,
  type RoomLabel,
  type Wall,
} from '../store/useDesignStore'
import { provenance } from '../store/provenance'

/**
 * B32 — shell and partition.
 *
 * The reference plan's most immediate signal is thick shell walls against thin
 * partitions. Before this the editor had one default thickness (200 mm) and no
 * concept at all, so differentiating them meant selecting each of sixteen walls
 * and retyping a number.
 *
 * ── 230 / 115 is a stated decision, not a reading ──
 * The reference is metric and does NOT state its thicknesses. A full brick and
 * a half brick are the Indian residential standard this project is aimed at.
 * The numbers are chosen; the tests below pin the CHOICE, not a measurement.
 *
 * ── The rule the amendment demanded, and the one this suite exists for ──
 * TYPE and THICKNESS are independent fields. The type is authoritative: a
 * shell set to 300 mm is still a shell. Nothing infers one from the other at
 * runtime, and the single exception — a legacy file that carries no type — is
 * fenced off and asserted as such.
 */

const wall = (
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  type: 'shell' | 'partition' = 'shell',
  thickness?: number,
): Wall => ({
  id,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  height: 3,
  thickness: thickness ?? WALL_TYPE_THICKNESS[type],
  type,
  openings: [],
  material: 'white-paint',
})

/* ─── ★ type is not derived from thickness ───────────────────────────────── */

describe('★ B32 — type and thickness are independent fields', () => {
  beforeEach(() => resetStore())

  /**
   * ★ THE AMENDMENT'S TEST.
   *
   * Asymmetric in: 300 mm is on the SHELL side of the migration split, so a
   * naive "infer from thickness" would coincidentally get this right. The
   * partition case below is the other half — 300 mm on a PARTITION is the
   * value inference cannot survive.
   */
  it('★ a shell overridden to 300 mm is still a shell after save and reload', () => {
    const walls = [wall('a', 0, 0, 5, 0, 'shell', 0.3)]
    const saved = JSON.parse(
      JSON.stringify(serializeDesign({ walls } as Parameters<typeof serializeDesign>[0])),
    )

    const parsed = parseDesign(saved)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const back = parsed.doc.walls[0]
    expect(back.type).toBe('shell')
    expect(back.thickness).toBe(0.3)
  })

  /**
   * ★ The case inference CANNOT survive: a partition at 300 mm.
   *
   * `wallTypeFromThickness(0.3)` is 'shell', so if the parser derived the type
   * this comes back as a shell and the user's statement is lost. This is the
   * assertion that goes red the moment anyone reintroduces derivation.
   */
  it('★ a PARTITION overridden to 300 mm survives, where inference would flip it', () => {
    // The trap, stated out loud.
    expect(wallTypeFromThickness(0.3)).toBe('shell')

    const walls = [wall('a', 0, 0, 5, 0, 'partition', 0.3)]
    const saved = JSON.parse(
      JSON.stringify(serializeDesign({ walls } as Parameters<typeof serializeDesign>[0])),
    )
    const parsed = parseDesign(saved)
    if (!parsed.ok) throw new Error('expected the document to parse')

    expect(parsed.doc.walls[0].type).toBe('partition')
    expect(parsed.doc.walls[0].thickness).toBe(0.3)
  })

  /**
   * The ONE place a type is read from a thickness, fenced off: a file that
   * carries no type at all. Asymmetric in: two walls either side of the split,
   * in the SAME file, so a parser that defaulted everything to one type fails.
   */
  it('reads a type from thickness only when the file has none', () => {
    const legacy = {
      version: 1,
      walls: [
        { id: 'thick', start: { x: 0, z: 0 }, end: { x: 5, z: 0 }, thickness: 0.23 },
        { id: 'thin', start: { x: 0, z: 2 }, end: { x: 5, z: 2 }, thickness: 0.115 },
      ],
    }
    const parsed = parseDesign(legacy)
    if (!parsed.ok) throw new Error('a pre-B32 file must still open')

    expect(parsed.doc.walls[0].type).toBe('shell')
    expect(parsed.doc.walls[1].type).toBe('partition')
    // The old universal default lands on shell, which is what those walls were.
    expect(wallTypeFromThickness(0.2)).toBe('shell')
    expect(MIGRATION_TYPE_SPLIT).toBeCloseTo(0.1725, 6)
  })
})

/* ─── the defaults, and what changing the type means ─────────────────────── */

describe('★ B32 — drawing with a type', () => {
  beforeEach(() => resetStore())

  /**
   * ★ Asymmetric in: the SAME two clicks, one setting changed. Both walls are
   * identical in geometry, so only the active type can be what differs.
   */
  it('★ the active type decides a new wall’s thickness — 230 or 115', () => {
    const store = useDesignStore.getState()

    store.setActiveWallType('shell')
    const shellId = store.addWall({ x: 0, z: 0 }, { x: 5, z: 0 }, {
      provenance: provenance.manual(),
    })!
    store.setActiveWallType('partition')
    const partId = useDesignStore.getState().addWall({ x: 0, z: 2 }, { x: 5, z: 2 }, {
      provenance: provenance.manual(),
    })!

    const walls = useDesignStore.getState().walls
    const shell = walls.find((w) => w.id === shellId)!
    const part = walls.find((w) => w.id === partId)!

    expect(shell.type).toBe('shell')
    expect(shell.thickness).toBe(0.23)
    expect(part.type).toBe('partition')
    expect(part.thickness).toBe(0.115)
  })

  /** An explicit thickness still wins over the type's standard. */
  it('respects a thickness handed in with the wall', () => {
    const store = useDesignStore.getState()
    store.setActiveWallType('shell')
    const id = store.addWall({ x: 0, z: 0 }, { x: 5, z: 0 }, {
      thickness: 0.3,
      provenance: provenance.manual(),
    })!
    const built = useDesignStore.getState().walls.find((w) => w.id === id)!

    expect(built.type).toBe('shell')
    expect(built.thickness).toBe(0.3)
  })

  /**
   * The active type is a setting on the PENCIL, not a property of the
   * building, so it must not be in the saved file or the undo snapshot.
   * Both exclusions are by omission from an allow-list, which is exactly the
   * kind of decision that survives until someone adds a field without thinking.
   */
  it('the active type is not part of the document', () => {
    useDesignStore.getState().setActiveWallType('partition')
    const saved = serializeDesign({
      walls: [wall('a', 0, 0, 5, 0)],
    } as Parameters<typeof serializeDesign>[0])

    expect(JSON.stringify(saved)).not.toContain('activeWallType')
  })
})

/* ─── the inspector when they disagree ───────────────────────────────────── */

describe('★ B32 — the inspector when type and thickness disagree', () => {
  beforeEach(() => {
    resetStore()
    useDesignStore.setState({
      walls: [wall('a', 0, 0, 5, 0, 'shell', 0.3)],
      selection: { kind: 'wall', wallId: 'a' },
    })
  })

  /**
   * ★ A positive delta on the drawn STRING: the same wall at its standard
   * thickness must NOT carry the note, so the note cannot be static chrome.
   */
  it('★ says the wall is overridden and still a shell', () => {
    render(<InspectorPanel />)
    const note = screen.getByTestId('wall-type-override')
    expect(note.textContent).toContain('normally 230 mm')
    expect(note.textContent).toContain('still a shell')

    // The control reports the TYPE, not the thickness.
    expect(screen.getByTestId('wall-type-shell').getAttribute('aria-pressed')).toBe('true')
  })

  it('says nothing when they agree', () => {
    useDesignStore.setState({ walls: [wall('a', 0, 0, 5, 0, 'shell')] })
    render(<InspectorPanel />)
    expect(screen.queryByTestId('wall-type-override')).toBeNull()
  })
})

/* ─── scope 11: B31 still behaves ────────────────────────────────────────── */

describe('★ B32 — B31’s readouts still behave with mixed thicknesses', () => {
  /**
   * The reference at reference size, now with a 230 mm shell and 115 mm
   * partitions instead of a uniform 200 mm.
   *
   * Areas are measured to CENTRELINES and that is unchanged here —
   * centreline-versus-finish-face is Stage 3 work. So the extent is decided by
   * the shell's centreline and must still read 9 × 11 exactly.
   */
  const mixed: Wall[] = [
    wall('n', 0, 0, 9, 0, 'shell'),
    wall('e', 9, 0, 9, 11, 'shell'),
    wall('s', 9, 11, 0, 11, 'shell'),
    wall('w', 0, 11, 0, 0, 'shell'),
    wall('b1', 0, 3.5, 9, 3.5, 'partition'),
    wall('b2', 3, 0, 3, 3.5, 'partition'),
    wall('b3', 6, 0, 6, 3.5, 'partition'),
  ]

  it('★ the extent is unchanged by the wall types — still 9 × 11, on target', () => {
    const actual = extentOf(mixed)!
    expect(actual).toEqual({ width: 9, depth: 11 })

    const deviation = deviationFrom(actual, { width: 9, depth: 11 })!
    expect(describeDeviation(deviation)).toBe('on target')
  })

  /** And the caption still carries a size line, with the thinner partitions. */
  it('the room caption still shows its dimensions', () => {
    const labels: RoomLabel[] = [
      {
        id: 'l1',
        type: 'bedroom',
        anchor: { x: 1.5, z: 1.75 },
        provenance: provenance.manual(),
      },
    ]
    const ctx = recorder({ text: true })
    drawPlan(ctx, {
      width: 900,
      height: 800,
      viewport: { center: { x: 4.5, z: 5.5 }, scale: 60 },
      walls: mixed,
      furniture: [],
      rooms: resolveRoomsUncached(mixed, labels),
      selection: null,
      units: 'm',
      anchor: null,
      cursor: null,
      showCursor: false,
    })
    const texts = ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.text ?? '')

    expect(texts.some((t) => t.includes('×'))).toBe(true)
    expect(texts).toContain('Bedroom')
  })
})

