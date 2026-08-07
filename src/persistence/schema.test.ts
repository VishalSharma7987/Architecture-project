import { describe, expect, it } from 'vitest'
import { rectangleWalls } from '../test/fixtures'
import type { Blueprint } from '../store/useDesignStore'
import {
  DESIGN_VERSION,
  attachable,
  parseDesign,
  serializeDesign,
  type DesignDocument,
} from './schema'

/**
 * The untrusted-input gate, and the migration mechanism L7 requires.
 *
 * `parseDesign` validates four different sources — file import, localStorage,
 * share links and raw LLM output — with one implementation. It had no tests
 * and no migration path, while its own comment promised both.
 */

const AT = '2026-08-07T00:00:00.000Z'

const BLUEPRINT: Blueprint = {
  src: 'blob:test/plan.png',
  fileName: 'plan.png',
  width: 1000,
  height: 800,
  metresPerPixel: 0.019,
  origin: { x: -9.5, z: -7.6 },
  opacity: 0.5,
  visible: true,
  calibration: {
    source: 'manual',
    metresPerPixel: 0.019,
    lockedByUser: true,
    setAt: AT,
    evidence: { typedMetres: 12 },
  },
}

/** A v1 document, exactly as the previous build wrote one. */
const V1_FILE = {
  version: 1,
  name: 'Old Project',
  savedAt: AT,
  settings: {
    viewMode: '2d',
    floorMaterial: 'oak',
    units: 'ftin',
    constructionRate: 1800,
    northOffset: 47,
    plotFacing: 'N',
  },
  walls: rectangleWalls(),
  furniture: [],
  rooms: [],
  plot: null,
  floors: [],
}

describe('versioning and migration', () => {
  it('writes the current version', () => {
    const doc = serializeDesign({ name: 'x', walls: [], viewMode: '2d', savedAt: AT })
    expect(doc.version).toBe(DESIGN_VERSION)
    expect(DESIGN_VERSION).toBe(2)
  })

  it('★ opens a v1 file and brings it forward', () => {
    const result = parseDesign(V1_FILE)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.version).toBe(DESIGN_VERSION)
    expect(result.doc.walls).toHaveLength(4)
    // v1 never persisted an underlay, so `null` is the honest value — not a
    // fabricated placement.
    expect(result.doc.blueprint).toBeNull()
  })

  it('★ reports the version the file was actually written at', () => {
    const result = parseDesign(V1_FILE)
    expect(result.ok && result.originalVersion).toBe(1)

    const current = parseDesign(
      serializeDesign({ name: 'x', walls: [], viewMode: '2d', savedAt: AT }),
    )
    expect(current.ok && current.originalVersion).toBe(2)
  })

  it('keeps every v1 setting through the migration', () => {
    const result = parseDesign(V1_FILE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.settings.constructionRate).toBe(1800)
    expect(result.doc.settings.northOffset).toBe(47)
    expect(result.doc.settings.units).toBe('ftin')
    expect(result.doc.settings.floorMaterial).toBe('oak')
  })

  it('refuses a file from a newer build rather than half-reading it', () => {
    const result = parseDesign({ ...V1_FILE, version: DESIGN_VERSION + 1 })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('newer')
  })

  it('refuses a version that is not a version', () => {
    for (const version of [0, -1, 1.5]) {
      expect(parseDesign({ ...V1_FILE, version }).ok).toBe(false)
    }
    expect(parseDesign({ ...V1_FILE, version: undefined }).ok).toBe(false)
  })

  it('has a migration for every version below the current one', () => {
    // The runner throws on a gap. Walking every version proves the table is
    // complete rather than merely complete today.
    for (let version = 1; version < DESIGN_VERSION; version++) {
      expect(() => parseDesign({ ...V1_FILE, version })).not.toThrow()
    }
  })
})

describe('the blueprint round-trips', () => {
  it('★ survives serialize → parse with its calibration intact', () => {
    const doc = serializeDesign({
      name: 'Traced',
      walls: [],
      viewMode: '2d',
      blueprint: BLUEPRINT,
      savedAt: AT,
    })
    const result = parseDesign(JSON.parse(JSON.stringify(doc)))

    expect(result.ok).toBe(true)
    if (!result.ok || !result.doc.blueprint) throw new Error('no blueprint')
    const bp = result.doc.blueprint

    expect(bp.fileName).toBe('plan.png')
    expect(bp.metresPerPixel).toBe(0.019)
    expect(bp.origin).toEqual({ x: -9.5, z: -7.6 })
    expect(bp.calibration.source).toBe('manual')
    // The measurement is still locked after a reload, so a vision read on the
    // reopened project still cannot overwrite it.
    expect(bp.calibration.lockedByUser).toBe(true)
  })

  it('never persists the object URL', () => {
    const doc = serializeDesign({
      name: 'Traced',
      walls: [],
      viewMode: '2d',
      blueprint: BLUEPRINT,
      savedAt: AT,
    })
    expect(JSON.stringify(doc)).not.toContain('blob:')
    expect(doc.blueprint).not.toHaveProperty('src')
  })

  it('comes back attachable, with no image', () => {
    const doc = serializeDesign({
      name: 'Traced',
      walls: [],
      viewMode: '2d',
      blueprint: BLUEPRINT,
      savedAt: AT,
    })
    const restored = attachable(parseDesign(doc).ok ? doc.blueprint : null)
    expect(restored?.src).toBeNull()
    expect(restored?.metresPerPixel).toBe(0.019)
  })

  it('drops a lock that has no measurement behind it', () => {
    // A hand-edited file claiming an AI reading is locked. Only `manual` locks;
    // honouring this would let a forged file freeze out a real measurement.
    const doc = serializeDesign({
      name: 'x',
      walls: [],
      viewMode: '2d',
      blueprint: {
        ...BLUEPRINT,
        calibration: { ...BLUEPRINT.calibration, source: 'ai', lockedByUser: true },
      },
      savedAt: AT,
    })
    const result = parseDesign(doc)
    expect(result.ok && result.doc.blueprint?.calibration.lockedByUser).toBe(false)
  })

  it('drops an unreadable placement but keeps the design', () => {
    const doc = serializeDesign({ name: 'x', walls: rectangleWalls(), viewMode: '2d', savedAt: AT })
    const damaged = { ...doc, blueprint: { fileName: 'x.png', width: 0, height: -1 } }

    const result = parseDesign(damaged)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.doc.blueprint).toBeNull()
    expect(result.doc.walls).toHaveLength(4)
    expect(result.warnings.join(' ')).toContain('blueprint')
  })

  it('falls back to source "none" when provenance is missing', () => {
    const doc = serializeDesign({ name: 'x', walls: [], viewMode: '2d', savedAt: AT })
    const withPlacement = {
      ...doc,
      blueprint: {
        fileName: 'p.png',
        width: 100,
        height: 100,
        metresPerPixel: 0.02,
        origin: { x: 0, z: 0 },
        opacity: 0.5,
        visible: true,
      },
    }
    const result = parseDesign(withPlacement)
    expect(result.ok && result.doc.blueprint?.calibration.source).toBe('none')
    expect(result.ok && result.doc.blueprint?.calibration.metresPerPixel).toBe(0.02)
  })
})

describe('the untrusted-input contract', () => {
  const base = (over: Partial<DesignDocument> = {}) => ({
    ...serializeDesign({ name: 'x', walls: rectangleWalls(), viewMode: '2d', savedAt: AT }),
    ...over,
  })

  it('rejects a non-object', () => {
    for (const bad of [null, 42, 'x', []]) expect(parseDesign(bad).ok).toBe(false)
  })

  it('rejects a missing walls array', () => {
    expect(parseDesign(base({ walls: undefined as never })).ok).toBe(false)
  })

  it('★ rejects 1e999, which JSON.parse turns into Infinity', () => {
    // The literal is deliberately out of range — that is the input under test.
    // oxlint-disable-next-line no-loss-of-precision
    const wall = { ...rectangleWalls()[0], start: { x: 1e999, z: 0 } }
    expect(parseDesign(base({ walls: [wall] })).ok).toBe(false)
  })

  it('drops a zero-length wall with a warning instead of failing the file', () => {
    const wall = { ...rectangleWalls()[0], end: rectangleWalls()[0].start }
    const result = parseDesign(base({ walls: [wall, ...rectangleWalls()] }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.doc.walls).toHaveLength(4)
    expect(result.ok && result.warnings.join(' ')).toContain('zero length')
  })

  it('mints ids for walls that arrive without them, and keeps them unique', () => {
    const walls = rectangleWalls().map((w) => ({ ...w, id: 'same' }))
    const result = parseDesign(base({ walls }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new Set(result.doc.walls.map((w) => w.id)).size).toBe(4)
  })

  it('falls back on an unknown material rather than rejecting the wall', () => {
    const walls = rectangleWalls().map((w) => ({ ...w, material: 'unobtanium' }))
    const result = parseDesign(base({ walls: walls as never }))
    expect(result.ok && result.doc.walls[0].material).toBe('white-paint')
  })

  it('wraps a hand-edited north rotation into range', () => {
    const doc = base()
    const result = parseDesign({ ...doc, settings: { ...doc.settings, northOffset: 450 } })
    expect(result.ok && result.doc.settings.northOffset).toBe(90)
  })

  it('reads a negative construction rate as "not quoted"', () => {
    const doc = base()
    const result = parseDesign({ ...doc, settings: { ...doc.settings, constructionRate: -5 } })
    expect(result.ok && result.doc.settings.constructionRate).toBe(0)
  })
})
