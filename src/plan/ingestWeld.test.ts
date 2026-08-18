import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { findLooseJoints, weldIngestWalls } from './repairJoints'
import { parseDesign } from '../persistence/schema'
import { resetStore } from '../test/fixtures'
import { provenance } from '../store/provenance'
import { useDesignStore, type Wall } from '../store/useDesignStore'

/**
 * B36 — the ingest weld, finding 27's open half.
 *
 * B28/B29/B30/B34 closed every route by which the DRAWING TOOLS can produce
 * an unjoined endpoint. Three ingest paths still admitted them: the CV
 * detector (two call sites), the AI's `replaceWalls`, and `parseDesign`.
 * The first two now weld; the third REPORTS and must never weld — it runs on
 * autosave restore, where a weld would rewrite a user's own document
 * invisibly with no undo step (L4).
 *
 * ── What makes each fixture capable of going red ──
 * The gaps are all OUTSIDE `JOIN_TOLERANCE` (15 mm) and inside the weld's
 * reach, so `detectRooms`' own noise guard cannot close them — only the weld
 * can, and disconnecting it changes every asserted coordinate. The oblique
 * fixture runs at a real angle because at 90° the axis intersection and the
 * perpendicular foot COINCIDE — a rectilinear fixture cannot tell extension
 * from rotation (SD25, the same trap that caught B26's perpendicular-foot
 * case). The order fixture contains a THREE-member cluster because a
 * two-member mean is order-safe by accident — x+y equals y+x in floats; it
 * takes three addends for associativity to bite.
 */

const wall = (
  id: string,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  thickness = 0.115,
): Wall => ({
  id,
  start: { x: ax, z: az },
  end: { x: bx, z: bz },
  height: 3,
  thickness,
  type: thickness > 0.17 ? 'shell' : 'partition',
  openings: [],
  material: 'white-paint',
})

/** An L whose corner is blown open by 100 mm — the band Session 1 measured. */
const openCorner = (): Wall[] => [
  wall('a', 0, 0, 4, 0),
  wall('b', 4.1, 0.02, 4.1, 3), // crossing walls, ends ~100 mm apart
]

describe('★ B36 — CV/AI walls with 100 mm gaps weld on ingest', () => {
  beforeEach(() => resetStore())

  /**
   * ★ Demonstrated red with the weld removed from `replaceWalls`: the corner
   * survived — "expected 2 to be +0" from the loose-joint count (both ends of
   * the open corner flagged), the endpoints still 102 mm apart.
   */
  it('★ replaceWalls (the AI path) closes the corner before committing', () => {
    const stamped = openCorner().map((w) => ({
      ...w,
      provenance: provenance.ai(),
    }))
    useDesignStore.getState().replaceWalls(stamped)

    const walls = useDesignStore.getState().walls
    expect(findLooseJoints(walls).length).toBe(0)
    // Joined EXACTLY — the cluster mean — not merely near: the room graph and
    // `sharedEnds` both match coordinates, not tolerances.
    const a = walls.find((w) => w.id === 'a')!
    const b = walls.find((w) => w.id === 'b')!
    expect(a.end).toEqual(b.start)
  })

  it('welds the id-less CV partials the detector emits, ids synthesized by index', () => {
    // The same shape `segmentsToWalls` returns, plus the index ids the CV
    // call sites attach before welding.
    const partials = openCorner().map(({ id: _id, start, end, thickness }, i) => ({
      id: `cv-${i}`,
      start,
      end,
      thickness,
    }))
    const { walls, closed } = weldIngestWalls(partials)
    expect(closed).toBeGreaterThan(0)
    expect(findLooseJoints(walls).length).toBe(0)
  })
})

describe('★ B36 — parseDesign reports and never welds', () => {
  const docWith = (walls: Wall[]) => ({
    version: 4,
    name: 'near-miss',
    savedAt: '2026-08-18T00:00:00.000Z',
    walls,
    furniture: [],
    rooms: [],
  })

  /**
   * ★ THE FAILURE MODE THAT MATTERS MOST: the weld leaking into the parse
   * path, where it would rewrite a user's own document on every autosave
   * restore. Demonstrated red by deliberately welding the parsed walls
   * inside `parseDesign` (the SD5 probe pattern): "expected { x: 4.05,
   * z: 0.01 } to deeply equal { x: 4, z: +0 }" — wall `a`'s end had moved to
   * the cluster mean — and the real-plan count fell 12 → 0 in the same run.
   * The probe was then removed.
   */
  it('★ leaves near-miss geometry byte-identical and says so in a warning', () => {
    const parsed = parseDesign(docWith(openCorner()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // The exact authored coordinates, untouched — a person's 100 mm gap is a
    // decision, not noise (L2).
    const a = parsed.doc.walls.find((w) => w.id === 'a')!
    const b = parsed.doc.walls.find((w) => w.id === 'b')!
    expect(a.end).toEqual({ x: 4, z: 0 })
    expect(b.start).toEqual({ x: 4.1, z: 0.02 })

    // …and the parse SAYS what it sees, in the status bar's own terms.
    expect(
      parsed.warnings.some((w) => w.includes('joined but are not connected')),
    ).toBe(true)
  })

  it('stays silent on a clean document', () => {
    const clean = [wall('a', 0, 0, 4, 0), wall('b', 4, 0, 4, 3)]
    const parsed = parseDesign(docWith(clean))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.warnings.some((w) => w.includes('not connected'))).toBe(false)
  })
})

describe('B36 — the weld is a fixed point', () => {
  it('welding twice equals welding once, by reference', () => {
    const once = weldIngestWalls(openCorner())
    const twice = weldIngestWalls(once.walls)
    // Convergence means the second call finds nothing and returns its INPUT —
    // byte-identical because it is the same array.
    expect(twice.walls).toBe(once.walls)
    expect(twice.closed).toBe(0)
  })

  it('shuffling the wall array produces the identical welded geometry', () => {
    // A THREE-member cluster (see the header) plus an extend, so both passes
    // exercise their order sensitivity.
    const base = (): Wall[] => [
      wall('n', 0, 0, 4, 0),
      wall('e', 4.08, 0.03, 4.05, 3),
      wall('s', 4.02, -0.06, 7, -0.06),
      wall('t', 2, 0.09, 2, 2), // extends onto n's centreline
    ]

    const sortById = (walls: Wall[]) =>
      [...walls].sort((a, b) => (a.id < b.id ? -1 : 1))
    const reference = sortById(weldIngestWalls(base()).walls)

    // Every rotation of the array, not one lucky shuffle — four inputs, one
    // deterministic answer, asserted to full float precision.
    for (let rotate = 1; rotate < 4; rotate++) {
      const rotated = base()
      const shuffled = [...rotated.slice(rotate), ...rotated.slice(0, rotate)]
      expect(sortById(weldIngestWalls(shuffled).walls)).toEqual(reference)
    }
  })

  it('extends along the wall’s own axis, never to the perpendicular foot', () => {
    // A stem at ~34° stopping short of a horizontal target's centreline. At
    // this angle the perpendicular foot and the axis intersection are ~50 mm
    // apart, so the substitution SD25 warns about cannot pass.
    const target = wall('t', -2, 1, 6, 1, 0.23)
    const stem = wall('s', 0, 0, 1.4, 0.93) // heading for (1.5, 1)
    const { walls } = weldIngestWalls([target, stem])

    const weldedStem = walls.find((w) => w.id === 's')!
    // On the target's centreline…
    expect(weldedStem.end.z).toBeCloseTo(1, 9)
    // …and the BEARING is exactly preserved: the endpoint moved along the
    // stem's own line, so start→end direction is unchanged to full precision.
    const angleBefore = Math.atan2(0.93 - 0, 1.4 - 0)
    const angleAfter = Math.atan2(
      weldedStem.end.z - weldedStem.start.z,
      weldedStem.end.x - weldedStem.start.x,
    )
    expect(angleAfter).toBeCloseTo(angleBefore, 12)
  })
})

describe('B36 — the real CV plan, its source path re-run', () => {
  /**
   * ACCEPTANCE 1 — `samples/real-plan-cv-untitled.json` is the detector's
   * committed output from 2026-08-12, saved before any weld existed. Running
   * it through the ingest weld is the re-run of its source path. The exact
   * counts are pinned (L6: same bytes, same answer): 12 loose joints before,
   * 13 closed across the fixed point's rounds (the 13th is a near-miss the
   * first round's moves created), 0 after — and the weld recovers a fourth
   * room the loose joints were bleeding.
   */
  it('12 loose joints before, 0 after, 13 closed', () => {
    const raw = JSON.parse(
      readFileSync('samples/real-plan-cv-untitled.json', 'utf8'),
    ) as unknown
    const parsed = parseDesign(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(findLooseJoints(parsed.doc.walls).length).toBe(12)
    // And the parse now warns about exactly that (B36's report half).
    expect(parsed.warnings.some((w) => w.includes('12 wall joints'))).toBe(true)

    const { walls, closed } = weldIngestWalls(parsed.doc.walls)
    expect(closed).toBe(13)
    expect(findLooseJoints(walls).length).toBe(0)
  })
})
