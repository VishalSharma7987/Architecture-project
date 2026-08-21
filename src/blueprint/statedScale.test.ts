import { beforeEach, describe, expect, it } from 'vitest'
import {
  metresPerPixelFromScale,
  parseScaleNotation,
  readImageDensity,
  setLoadedDensity,
} from './statedScale'
import {
  CALIBRATION_RANK,
  MIN_PICK_SEPARATION_PX,
  describeCalibration,
  isMeasured,
  pickIsSeparated,
  proposeCalibration,
  uncalibrated,
} from './calibration'
import { gateScaleProvenance } from './plausibility'
import { resetStore } from '../test/fixtures'
import { useDesignStore } from '../store/useDesignStore'

/**
 * B38 — automatic and assisted scale.
 *
 * Real use found the burden: a user uploaded a clean CAD export STATING
 * "SCALE 1:100" and the app made him pick two points by hand — twice,
 * because his first pair landed on the same spot and the panel then asked
 * how long a zero-length span really was.
 *
 * ── What makes each fixture capable of going red ──
 * The pick fixture is 3 SCREEN px apart at a stated viewport scale, inside
 * `MIN_PICK_SEPARATION_PX` but a nonzero world distance — so a rule written
 * against world metres, or one testing exact equality, passes it and fails
 * this. The rank fixture asserts the RECORDED source string, not "not
 * manual": a `stated` scale that quietly recorded itself as `manual` would
 * satisfy any weaker assertion while silently locking the scale and passing
 * Gate 2, which is the failure that matters.
 */

const AT = '2026-08-18T00:00:00.000Z'

const loadBlueprint = (metresPerPixel = 0.01) => {
  useDesignStore.getState().setBlueprint({
    src: 'blob:test',
    fileName: 'plan.png',
    width: 1000,
    height: 800,
    metresPerPixel,
    origin: { x: -5, z: -4 },
    opacity: 0.6,
    visible: true,
    calibration: uncalibrated(metresPerPixel, AT),
  })
}

/* ─── the notation ──────────────────────────────────────────────────────── */

describe('B38 — a scale notation is a paper-to-world ratio', () => {
  it('reads the metric ratio forms, with trailing words tolerated', () => {
    expect(parseScaleNotation('1:100')).toBe(100)
    expect(parseScaleNotation('1 : 50')).toBe(50)
    expect(parseScaleNotation('1/100')).toBe(100)
    // The reference CAD export prints exactly this.
    expect(parseScaleNotation('1:100 MTS.')).toBe(100)
  })

  it('reads the imperial equalities an Indian/US sheet prints', () => {
    // 1/4" of paper = 1 foot of building → 48× .
    expect(parseScaleNotation(`1/4"=1'`)).toBe(48)
    expect(parseScaleNotation(`1/8"=1'-0"`)).toBe(96)
    expect(parseScaleNotation(`1"=1'`)).toBe(12)
  })

  it('reads metric equalities', () => {
    expect(parseScaleNotation('1cm=1m')).toBe(100)
    expect(parseScaleNotation('5mm=1m')).toBe(200)
  })

  it('refuses what is not a scale, including enlargements and absurd ratios', () => {
    for (const text of ['', 'hello', '100', '2:1', '1:0', '1:99999', '1/0']) {
      expect(parseScaleNotation(text)).toBeNull()
    }
  })

  it('turns a ratio and a density into metres per pixel', () => {
    // 300 dpi = 11811 px/m of paper. At 1:100, one pixel is 100/11811 m.
    const density = { pixelsPerMetre: 300 / 0.0254, kind: 'png-phys' as const }
    expect(metresPerPixelFromScale(100, density)).toBeCloseTo(0.008467, 6)
    // Sanity: a 3000 px wide sheet is then 25.4 m of building — a 10 inch
    // sheet at 1:100. The arithmetic is the whole claim, so it is checked.
    expect(3000 * metresPerPixelFromScale(100, density)).toBeCloseTo(25.4, 3)
  })
})

/* ─── the density, and what it refuses to believe ───────────────────────── */

describe('B38 — the print density a file claims', () => {
  /** A PNG header plus a pHYs chunk at the given pixels-per-metre. */
  const png = (ppm: number, unit = 1): Uint8Array => {
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    // IHDR, skipped by the reader but present as a real file has it.
    bytes.push(0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52)
    for (let i = 0; i < 13 + 4; i++) bytes.push(0)
    bytes.push(0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73)
    for (const value of [ppm, ppm]) {
      bytes.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255)
    }
    bytes.push(unit, 0, 0, 0, 0)
    return new Uint8Array(bytes)
  }

  it('reads a deliberate PNG pHYs density', () => {
    const ppm = Math.round(300 / 0.0254) // 300 dpi
    expect(readImageDensity(png(ppm))).toEqual({
      pixelsPerMetre: ppm,
      kind: 'png-phys',
    })
  })

  /**
   * The refusals are the substance of this module. A default the encoder
   * wrote, or a unit flag meaning "aspect ratio only", describes no sheet of
   * paper — and believing one would size a building off a library default.
   */
  it('refuses encoder boilerplate and aspect-ratio-only units', () => {
    expect(readImageDensity(png(Math.round(96 / 0.0254)))).toBeNull()
    expect(readImageDensity(png(Math.round(72 / 0.0254)))).toBeNull()
    expect(readImageDensity(png(11811, 0))).toBeNull() // unit 0
    expect(readImageDensity(png(0))).toBeNull()
  })

  it('returns null for a file with no density chunk at all', () => {
    const bare = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0])
    expect(readImageDensity(bare)).toBeNull()
    expect(readImageDensity(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('reads a JPEG JFIF density in dpi and in dots-per-cm', () => {
    const jpeg = (unit: number, density: number): Uint8Array => {
      const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]
      bytes.push(0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, unit)
      bytes.push((density >> 8) & 255, density & 255, (density >> 8) & 255, density & 255)
      bytes.push(0, 0)
      return new Uint8Array(bytes)
    }
    expect(readImageDensity(jpeg(1, 300))?.pixelsPerMetre).toBeCloseTo(300 / 0.0254, 6)
    expect(readImageDensity(jpeg(2, 118))?.pixelsPerMetre).toBeCloseTo(11800, 6)
    expect(readImageDensity(jpeg(0, 1))).toBeNull()
  })
})

/* ─── ★ the rank it earns, recorded ─────────────────────────────────────── */

describe('★ B38 — a typed scale records its own rank', () => {
  beforeEach(() => {
    resetStore()
    setLoadedDensity(null)
  })

  /**
   * ★ Asserts the RECORDED SOURCE, not merely "not manual". Demonstrated red
   * against a draft that reused `source: 'manual'` for the typed path — the
   * assertion reported `expected 'manual' to be 'stated'`, and that draft
   * also locked the scale and passed Gate 2, which is precisely the silent
   * over-claim §8 exists to prevent.
   */
  it('★ a stated scale records source "stated" — not manual, not ai', () => {
    loadBlueprint()
    const density = { pixelsPerMetre: 300 / 0.0254, kind: 'png-phys' as const }

    const result = proposeCalibration({
      source: 'stated',
      metresPerPixel: metresPerPixelFromScale(100, density),
      evidence: { statedScale: '1:100' },
      at: AT,
    })

    expect(result.applied).toBe(true)
    const calibration = useDesignStore.getState().blueprint?.calibration
    expect(calibration?.source).toBe('stated')
    expect(calibration?.evidence?.statedScale).toBe('1:100')
    // It is NOT a measurement, so it does not lock and does not claim to be.
    expect(calibration?.lockedByUser).toBe(false)
    expect(isMeasured(calibration)).toBe(false)
    expect(describeCalibration(calibration!)).toContain('scale you typed')
  })

  it('sits between ocr and heuristic on the ladder, moving no published rank', () => {
    expect(CALIBRATION_RANK.stated).toBeGreaterThan(CALIBRATION_RANK.ocr)
    expect(CALIBRATION_RANK.stated).toBeLessThan(CALIBRATION_RANK.heuristic)
    // The numbers other documents cite are untouched — §8's ladder is quoted
    // by VALUE elsewhere ("Gate 2 refuses rank 6").
    expect(CALIBRATION_RANK.manual).toBe(1)
    expect(CALIBRATION_RANK.ocr).toBe(4)
    expect(CALIBRATION_RANK.heuristic).toBe(5)
    expect(CALIBRATION_RANK.ai).toBe(6)
    expect(CALIBRATION_RANK.none).toBe(7)
  })

  it('outranks an AI estimate and yields to a measurement', () => {
    loadBlueprint()
    expect(proposeCalibration({ source: 'stated', metresPerPixel: 0.02, at: AT }).applied).toBe(true)
    // An AI estimate cannot replace it…
    expect(proposeCalibration({ source: 'ai', metresPerPixel: 0.05, at: AT }).applied).toBe(false)
    // …and a real measurement can.
    expect(proposeCalibration({ source: 'manual', metresPerPixel: 0.03, at: AT }).applied).toBe(true)
  })

  /** ACCEPTANCE 3 — Gate 2 is not weakened. */
  it('★ Gate 2 still refuses a stated scale, and still refuses rank 6', () => {
    expect(gateScaleProvenance('stated', false).status).toBe('fail')
    expect(gateScaleProvenance('stated', false).message).toContain('print size')
    expect(gateScaleProvenance('ai', false).status).toBe('fail')
    // …while the sources it always admitted are unchanged.
    for (const source of ['manual', 'dxf-units', 'vector', 'ocr'] as const) {
      expect(gateScaleProvenance(source, false).status).toBe('pass')
    }
  })
})

/* ─── ★ the zero-span refusal ───────────────────────────────────────────── */

describe('★ B38 — two picks on the same spot are refused', () => {
  /**
   * ★ The bug real use found. Demonstrated red against the pre-B38 rule
   * (no separation check at all): the pair was accepted, `distance` came
   * back 0, and the panel asked *"That span currently reads 0″. How long is
   * it really?"* — a question with no answer, and every scale derived from
   * it a division by zero.
   *
   * 3 px apart at 44 px/m is 68 mm of world: a NONZERO world distance, so a
   * rule testing equality passes it; and a tiny screen distance, so a rule
   * written in world metres cannot express it.
   */
  it('★ picks 3 screen px apart are refused; 12 px apart are accepted', () => {
    const scale = 44
    const first = { x: 0, z: 0 }
    const threePx = { x: 3 / scale, z: 0 }
    const twelvePx = { x: 12 / scale, z: 0 }

    expect(pickIsSeparated(first, threePx, scale)).toBe(false)
    expect(pickIsSeparated(first, twelvePx, scale)).toBe(true)
    // Exactly zero is the reported case, and is refused a fortiori.
    expect(pickIsSeparated(first, { ...first }, scale)).toBe(false)
  })

  /**
   * The threshold is in SCREEN pixels, so the same world gap is refused when
   * zoomed out and accepted when zoomed in — which is the point: what the
   * user aimed at is what they could see.
   */
  it('is a screen rule, not a world rule', () => {
    const gap = { x: 0.1, z: 0 } // 100 mm of world
    expect(pickIsSeparated({ x: 0, z: 0 }, gap, 20)).toBe(false) // 2 px
    expect(pickIsSeparated({ x: 0, z: 0 }, gap, 200)).toBe(true) // 20 px
    expect(MIN_PICK_SEPARATION_PX).toBe(6)
  })
})
