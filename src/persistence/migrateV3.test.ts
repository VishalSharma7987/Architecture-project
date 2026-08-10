import { describe, expect, it } from 'vitest'
import {
  DESIGN_VERSION,
  parseDesign,
  serializeDesign,
  type DesignDocument,
} from './schema'

/**
 * B7.3 — the v2 → v3 migration: room identity + provenance.
 *
 * §6's migration contract: an old-format fixture, an expected new-format
 * fixture, and a round-trip test. All three are here.
 */

const SAVED_AT = '2026-03-04T09:15:00.000Z'

/* ─── fixture in: a v2 document ─────────────────────────────────────────── */

/**
 * A v2 file as the shipped build wrote it — plus two deliberate omissions that
 * a hand-edited or LLM-produced file really does contain: the second room has
 * no `id`, and nothing anywhere has provenance.
 */
const V2_FILE = {
  version: 2,
  name: 'Plot 14',
  savedAt: SAVED_AT,
  settings: {
    viewMode: '2d',
    floorMaterial: 'grey-tile',
    units: 'ftin',
    constructionRate: 1800,
    northOffset: 0,
    plotFacing: 'north',
  },
  walls: [
    {
      id: 'w1',
      start: { x: 0, z: 0 },
      end: { x: 4, z: 0 },
      height: 3,
      thickness: 0.23,
      material: 'white-paint',
      openings: [
        { id: 'o1', type: 'door', position: 2, width: 0.9, height: 2.1, sill: 0 },
      ],
    },
    {
      id: 'w2',
      start: { x: 4, z: 0 },
      end: { x: 4, z: 3 },
      height: 3,
      thickness: 0.23,
      material: 'white-paint',
      openings: [],
    },
  ],
  furniture: [
    { id: 'f1', type: 'bed', position: { x: 2, z: 1.5 }, rotation: 0 },
  ],
  rooms: [
    { id: 'r1', type: 'bedroom', anchor: { x: 2, z: 1.5 } },
    // No id. This is the case that used to get a fresh UUID on every load.
    { type: 'kitchen', anchor: { x: 3, z: 2 } },
  ],
  plot: null,
  floors: [
    {
      name: 'Ground',
      walls: [
        {
          id: 'fw1',
          start: { x: 0, z: 0 },
          end: { x: 1, z: 0 },
          height: 3,
          thickness: 0.23,
          material: 'white-paint',
          openings: [
            { id: 'fo1', type: 'window', position: 0.5, width: 1.2, height: 1.2, sill: 0.9 },
          ],
        },
      ],
      furniture: [{ id: 'ff1', type: 'sofa', position: { x: 1, z: 1 }, rotation: 0 }],
      roomLabels: [{ id: 'fr1', type: 'living', anchor: { x: 0.5, z: 0.5 } }],
      stairs: [
        { id: 's1', position: { x: 3, z: 3 }, rotation: 0, width: 1, run: 3.6 },
      ],
    },
  ],
  blueprint: null,
}

const parsed = () => {
  const result = parseDesign(structuredClone(V2_FILE))
  if (!result.ok) throw new Error(`fixture did not parse: ${result.error}`)
  return result
}

describe('★ B7.3 — v2 → v3', () => {
  it('brings the document forward and reports where it came from', () => {
    const result = parsed()
    expect(result.doc.version).toBe(DESIGN_VERSION)
    // A v2 file now runs 2→3→4, so it lands on 4 rather than stopping at 3.
    // This suite still covers the v3 STEP — every assertion below reads the
    // fields that step writes, and they are unaffected by the one after it.
    expect(result.doc.version).toBe(4)
    expect(result.originalVersion).toBe(2)
  })

  /* ─── expected out ─────────────────────────────────────────────────────── */

  it('stamps every one of the five element types', () => {
    const { doc } = parsed()
    const expected = { source: 'unknown', createdAt: SAVED_AT }

    expect(doc.walls[0].provenance).toEqual(expected)
    expect(doc.walls[0].openings[0].provenance).toEqual(expected)
    expect(doc.rooms[0].provenance).toEqual(expected)
    expect(doc.furniture[0].provenance).toEqual(expected)

    // And inside `floors[]`, which is a second copy of the same four shapes
    // plus stairs — the one place a migration is easy to forget.
    const floor = doc.floors[0]
    expect(floor.walls[0].provenance).toEqual(expected)
    expect(floor.walls[0].openings[0].provenance).toEqual(expected)
    expect(floor.furniture[0].provenance).toEqual(expected)
    expect(floor.roomLabels[0].provenance).toEqual(expected)
    expect(floor.stairs[0].provenance).toEqual(expected)
  })

  it("★ never writes 'manual', and never writes a confidence", () => {
    const { doc } = parsed()
    const every = [
      ...doc.walls,
      ...doc.walls.flatMap((w) => w.openings),
      ...doc.rooms,
      ...doc.furniture,
      ...doc.floors.flatMap((f) => [
        ...f.walls,
        ...f.walls.flatMap((w) => w.openings),
        ...f.roomLabels,
        ...f.furniture,
        ...f.stairs,
      ]),
    ]

    expect(every.length).toBeGreaterThan(8)
    for (const element of every) {
      // A v2 file can hold walls that came from CV or from an AI edit, and
      // nothing on disk tells them apart. L5 exists so the user can judge what
      // to trust — a confident lie is worse than an admission of ignorance.
      expect(element.provenance?.source).toBe('unknown')
      expect(element.provenance?.confidence).toBeUndefined()
    }
  })

  it('★ takes createdAt from the file, never from the clock', () => {
    const { doc } = parsed()
    expect(doc.walls[0].provenance?.createdAt).toBe(SAVED_AT)

    // The load-bearing property: migrating the same bytes twice gives the same
    // document. A `new Date()` in the migration would break this, and with it
    // the round-trip test below (L6).
    const again = parsed()
    expect(JSON.stringify(again.doc)).toBe(JSON.stringify(doc))
  })

  it('omits createdAt rather than inventing one when savedAt is absent', () => {
    const { savedAt: _dropped, ...noDate } = V2_FILE
    const result = parseDesign(noDate)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.doc.walls[0].provenance).toEqual({ source: 'unknown' })
  })

  /* ─── the uniqueId defect ──────────────────────────────────────────────── */

  it('★ a label with no id gets the SAME id on every load', () => {
    const first = parsed().doc.rooms.map((r) => r.id)
    const second = parsed().doc.rooms.map((r) => r.id)

    expect(first).toEqual(['r1', 'room-1'])
    // `crypto.randomUUID()` was the old fallback, so this was two different
    // arrays. Harmless while ids were decoration; corrupting from v3, where
    // the id IS the room's identity and a future merge has to line two copies
    // of one file up against each other.
    expect(second).toEqual(first)
  })

  it('does not let a derived id collide with an explicit one', () => {
    const result = parseDesign({
      ...V2_FILE,
      rooms: [
        // Claims the name the second label's fallback would take.
        { id: 'room-1', type: 'bedroom', anchor: { x: 1, z: 1 } },
        { type: 'kitchen', anchor: { x: 3, z: 2 } },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ids = result.doc.rooms.map((r) => r.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toBe('room-1')
  })

  /* ─── round trip ───────────────────────────────────────────────────────── */

  it('★ round-trips: parse(serialize(parse(v2))) === parse(v2)', () => {
    const once = parsed().doc
    const again = parseDesign(reserialize(once))

    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.doc).toEqual(once)
    // Already current, so the second pass migrates nothing.
    expect(again.originalVersion).toBe(DESIGN_VERSION)
  })

  it('a v1 file runs 1→2→3→4 and lands stamped', () => {
    const result = parseDesign({
      version: 1,
      name: 'ancient',
      savedAt: SAVED_AT,
      settings: { viewMode: '2d' },
      walls: V2_FILE.walls,
      rooms: [{ id: 'r1', type: 'bedroom', anchor: { x: 2, z: 1.5 } }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.originalVersion).toBe(1)
    expect(result.doc.version).toBe(4)
    // v1's own step still applies...
    expect(result.doc.blueprint).toBeNull()
    // ...and so does v2's, one after the other rather than instead of.
    expect(result.doc.walls[0].provenance?.source).toBe('unknown')
  })

  it('leaves provenance a file already carries alone', () => {
    const result = parseDesign({
      ...V2_FILE,
      walls: [
        {
          ...V2_FILE.walls[0],
          provenance: { source: 'cv', confidence: 0.82, sourceRef: 'plan.png' },
        },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.doc.walls[0].provenance).toEqual({
      source: 'cv',
      confidence: 0.82,
      sourceRef: 'plan.png',
    })
  })
})

describe('B7.3 — parseProvenance is defensive', () => {
  const wallWith = (provenance: unknown) =>
    parseDesign({ ...V2_FILE, walls: [{ ...V2_FILE.walls[0], provenance }] })

  it("degrades an unrecognised source to 'unknown' rather than dropping it", () => {
    const result = wallWith({ source: 'from-the-future', confidence: 0.5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The fact that SOMETHING claimed an origin is worth keeping, and a future
    // version's source name must not silently read as hand-drawn.
    expect(result.doc.walls[0].provenance?.source).toBe('unknown')
    expect(result.doc.walls[0].provenance?.confidence).toBe(0.5)
  })

  it('drops an out-of-range confidence rather than clamping it', () => {
    for (const confidence of [-1, 1.5, Number.NaN, '0.5']) {
      const result = wallWith({ source: 'cv', confidence })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Clamping would turn a bug into a plausible-looking figure, and this
      // one is shown to the user (L5).
      expect(result.doc.walls[0].provenance?.confidence).toBeUndefined()
      expect(result.doc.walls[0].provenance?.source).toBe('cv')
    }
  })

  it('treats a missing source as no provenance at all', () => {
    const result = wallWith({ confidence: 1, createdAt: SAVED_AT })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The migration only stamps when `provenance` is absent, and this one is
    // present-but-useless — so it parses away to nothing rather than becoming
    // a record with no origin in it.
    expect(result.doc.walls[0].provenance).toBeUndefined()
  })

  it('survives provenance that is not an object', () => {
    for (const junk of [null, 7, 'cv', []]) {
      const result = wallWith(junk)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.doc.walls[0].provenance).toBeUndefined()
    }
  })
})

/** Re-serialises a parsed document, preserving what `serializeDesign` takes. */
function reserialize(doc: DesignDocument) {
  return serializeDesign({
    name: doc.name,
    savedAt: doc.savedAt,
    walls: doc.walls,
    viewMode: doc.settings.viewMode,
    furniture: doc.furniture,
    roomLabels: doc.rooms,
    floors: doc.floors,
    plot: doc.plot,
    floorMaterial: doc.settings.floorMaterial,
    units: doc.settings.units,
    constructionRate: doc.settings.constructionRate,
    northOffset: doc.settings.northOffset,
    plotFacing: doc.settings.plotFacing,
    blueprint: null,
  })
}
