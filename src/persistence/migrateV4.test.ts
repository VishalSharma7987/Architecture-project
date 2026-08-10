import { describe, expect, it } from 'vitest'
import {
  DESIGN_VERSION,
  parseDesign,
  serializeDesign,
  type DesignDocument,
} from './schema'

/**
 * B21 — the v3 → v4 migration: a door's swing is in the model.
 *
 * §6's migration contract: an old-format fixture, an expected new-format
 * fixture, and a round-trip test. All three are here.
 *
 * The property that matters most is NOT that the field arrives. It is that the
 * field arrives carrying **exactly what v3 already drew** — hinge at the jamb
 * nearer the wall's start, leaf to the wall's left — so that opening a saved
 * plan in v4 changes nothing on screen. A migration that gave every door a
 * different swing would be a migration that silently redrew everyone's doors.
 */

const SAVED_AT = '2026-05-19T11:40:00.000Z'

/** What every renderer hard-coded before v4, and so what the migration writes. */
const V3_CONVENTION = { hand: 'start', side: 'left' } as const

/* ─── fixture in: a v3 document ─────────────────────────────────────────── */

/**
 * A v3 file as the shipped build wrote it, plus the four cases that decide
 * whether the step is right:
 *
 *  - `o-door`     an ordinary door with no swing — the overwhelming majority
 *  - `o-window`   a window, which must NOT acquire one
 *  - `o-held`     a door that already carries a swing, which must be left alone
 *  - `fo-door`    a door inside `floors[]` — the copy a migration forgets
 */
const V3_FILE = {
  version: 3,
  name: 'Plot 22',
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
      provenance: { source: 'manual', confidence: 1 },
      start: { x: 0, z: 0 },
      end: { x: 4, z: 0 },
      height: 3,
      thickness: 0.23,
      material: 'white-paint',
      openings: [
        {
          id: 'o-door',
          provenance: { source: 'manual', confidence: 1 },
          type: 'door',
          position: 1,
          width: 0.9,
          height: 2.1,
          sill: 0,
        },
        {
          id: 'o-window',
          provenance: { source: 'manual', confidence: 1 },
          type: 'window',
          position: 3,
          width: 1.2,
          height: 1.2,
          sill: 0.9,
        },
        {
          // A door written by a build that already had v4. Nothing may touch
          // it: L2 — user input outranks everything, including a migration
          // that thinks it knows what this door used to look like.
          id: 'o-held',
          provenance: { source: 'manual', confidence: 1 },
          type: 'door',
          position: 2,
          width: 0.9,
          height: 2.1,
          sill: 0,
          swing: { hand: 'end', side: 'right' },
        },
      ],
    },
  ],
  furniture: [],
  rooms: [{ id: 'r1', provenance: { source: 'manual' }, type: 'bedroom', anchor: { x: 2, z: 1.5 } }],
  plot: null,
  floors: [
    {
      name: 'Ground',
      walls: [
        {
          id: 'fw1',
          provenance: { source: 'manual', confidence: 1 },
          start: { x: 0, z: 0 },
          end: { x: 3, z: 0 },
          height: 3,
          thickness: 0.23,
          material: 'white-paint',
          openings: [
            {
              id: 'fo-door',
              provenance: { source: 'manual', confidence: 1 },
              type: 'door',
              position: 1.5,
              width: 0.9,
              height: 2.1,
              sill: 0,
            },
          ],
        },
      ],
      furniture: [],
      roomLabels: [],
      stairs: [],
    },
  ],
  blueprint: null,
}

const parsed = () => {
  const result = parseDesign(structuredClone(V3_FILE))
  if (!result.ok) throw new Error(`fixture did not parse: ${result.error}`)
  return result
}

/** Every opening in the document, top-level walls and `floors[]` alike. */
const openingsOf = (doc: DesignDocument) => [
  ...doc.walls.flatMap((w) => w.openings),
  ...doc.floors.flatMap((f) => f.walls.flatMap((w) => w.openings)),
]

const byId = (doc: DesignDocument, id: string) => {
  const found = openingsOf(doc).find((o) => o.id === id)
  if (!found) throw new Error(`no opening ${id}`)
  return found
}

describe('★ B21 — v3 → v4, the door swing', () => {
  it('brings the document forward and reports where it came from', () => {
    const result = parsed()
    expect(result.doc.version).toBe(DESIGN_VERSION)
    expect(result.doc.version).toBe(4)
    expect(result.originalVersion).toBe(3)
  })

  /* ─── expected out ─────────────────────────────────────────────────────── */

  it('★ gives every swing-less door exactly what v3 already drew', () => {
    const { doc } = parsed()
    // Hinge at the jamb nearer the wall's start, leaf to the wall's left.
    // If this ever reads anything else, every saved plan in existence has had
    // its doors silently redrawn.
    expect(byId(doc, 'o-door').swing).toEqual(V3_CONVENTION)
  })

  it('reaches the doors inside floors[], not just the top-level walls', () => {
    // The one place a migration is easy to forget: `floors[]` is a second copy
    // of the same shapes, and the v2→v3 step needed its own traversal for it.
    expect(byId(parsed().doc, 'fo-door').swing).toEqual(V3_CONVENTION)
  })

  it('leaves a swing the file already carries alone (L2)', () => {
    expect(byId(parsed().doc, 'o-held').swing).toEqual({
      hand: 'end',
      side: 'right',
    })
  })

  it('gives a window no swing — a window does not swing', () => {
    expect(byId(parsed().doc, 'o-window').swing).toBeUndefined()
  })

  it('changes nothing else about the openings it touches', () => {
    const door = byId(parsed().doc, 'o-door')
    expect(door).toEqual({
      id: 'o-door',
      provenance: { source: 'manual', confidence: 1 },
      type: 'door',
      position: 1,
      width: 0.9,
      height: 2.1,
      sill: 0,
      swing: V3_CONVENTION,
    })
  })

  /* ─── round trip ───────────────────────────────────────────────────────── */

  it('★ round-trips: parse(serialize(parse(v3))) === parse(v3)', () => {
    const once = parsed().doc
    const again = parseDesign(reserialize(once))

    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.doc).toEqual(once)
    // Already current, so the second pass migrates nothing.
    expect(again.originalVersion).toBe(DESIGN_VERSION)
  })

  it('is deterministic — the same bytes migrate to the same document (L6)', () => {
    // The v2→v3 step had to take `createdAt` from the file rather than the
    // clock for exactly this reason. v4 writes a constant pair, so it is
    // deterministic by construction; this asserts it rather than assuming it.
    expect(parsed().doc).toEqual(parsed().doc)
  })

  it('a v2 file runs 2→3→4, gaining provenance AND a swing', () => {
    const result = parseDesign({
      version: 2,
      name: 'older',
      savedAt: SAVED_AT,
      settings: { viewMode: '2d' },
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
      ],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.originalVersion).toBe(2)
    expect(result.doc.version).toBe(4)
    // v3's step still applies...
    expect(result.doc.walls[0].openings[0].provenance?.source).toBe('unknown')
    // ...and so does v4's, one after the other rather than instead of.
    expect(result.doc.walls[0].openings[0].swing).toEqual(V3_CONVENTION)
  })

  /* ─── the trust boundary ───────────────────────────────────────────────── */

  it('★ drops a malformed swing without reaching geometry, and keeps the door', () => {
    // §3's reason for `parseDesign` existing: malformed-vs-odd is a real
    // distinction. A bad swing is ODD — the door is still a door, so it is
    // repaired to the default rather than costing the user an opening.
    const bad = ['middle', 1e999, null, { hand: 'start' }, []]

    for (const hand of bad) {
      const result = parseDesign({
        ...structuredClone(V3_FILE),
        walls: [
          {
            ...V3_FILE.walls[0],
            openings: [
              { id: 'o-bad', type: 'door', position: 1, width: 0.9, height: 2.1, sill: 0, swing: { hand, side: 'left' } },
            ],
          },
        ],
        floors: [],
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const door = byId(result.doc, 'o-bad')
      // The door survives...
      expect(door.type).toBe('door')
      // ...and carries no swing, so `doorSwing()` falls back to the pre-v4
      // convention and it draws exactly as it always did.
      expect(door.swing).toBeUndefined()
    }
  })

  it('strips a swing a window should never have had', () => {
    const result = parseDesign({
      ...structuredClone(V3_FILE),
      walls: [
        {
          ...V3_FILE.walls[0],
          openings: [
            { id: 'o-w', type: 'window', position: 1, width: 1.2, height: 1.2, sill: 0.9, swing: { hand: 'start', side: 'left' } },
          ],
        },
      ],
      floors: [],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(byId(result.doc, 'o-w').swing).toBeUndefined()
  })
})

/** Feeds a parsed document back through `serializeDesign`, as a save would. */
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
    units: doc.settings.units,
    constructionRate: doc.settings.constructionRate,
    northOffset: doc.settings.northOffset,
    plotFacing: doc.settings.plotFacing,
    floorMaterial: doc.settings.floorMaterial,
  })
}
