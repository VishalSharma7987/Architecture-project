import { describe, expect, it } from 'vitest'
import {
  GRID_STEP,
  METRES_PER_FOOT,
  formatArea,
  formatLength,
  formatLengthCompact,
  parseLength,
} from './length'

/**
 * The sole unit authority. Feeds every typed dimension, every label on the
 * plan, every figure in the area statement and the drawing grid itself.
 *
 * §4 invariant 4: `formatLength` is lossy and `parseLength` is NOT its inverse.
 * Round-tripping a wall through a label walks its length by up to half an inch
 * every edit. These tests pin that asymmetry down rather than pretending it
 * away, so a future "tidy-up" that makes them symmetric fails loudly.
 */

describe('parseLength', () => {
  const CASES: [input: string, unit: 'ftin' | 'm', metres: number][] = [
    // Feet and inches, in the spellings a drawing actually uses.
    [`12'6"`, 'ftin', 12 * 0.3048 + 6 * 0.0254],
    [`12'-6"`, 'ftin', 12 * 0.3048 + 6 * 0.0254],
    [`12'6`, 'ftin', 12 * 0.3048 + 6 * 0.0254],
    ['12 ft 6 in', 'ftin', 12 * 0.3048 + 6 * 0.0254],
    [`12'`, 'ftin', 12 * 0.3048],
    ['12 feet', 'ftin', 12 * 0.3048],
    [`6"`, 'ftin', 6 * 0.0254],
    [`3/4"`, 'ftin', 0.75 * 0.0254],
    [`6 3/4"`, 'ftin', 6.75 * 0.0254],
    // Metric, explicit.
    ['3.81m', 'ftin', 3.81],
    ['3.81 m', 'm', 3.81],
    ['381cm', 'm', 3.81],
    ['3810mm', 'm', 3.81],
    ['3.81 metres', 'm', 3.81],
  ]

  for (const [input, unit, metres] of CASES) {
    it(`reads ${JSON.stringify(input)} in ${unit} mode`, () => {
      expect(parseLength(input, unit)).toBeCloseTo(metres, 9)
    })
  }

  it('an explicit unit always beats the mode', () => {
    // `5'` is 1.524 m even when the user is working in metric.
    expect(parseLength(`5'`, 'm')).toBeCloseTo(5 * METRES_PER_FOOT, 9)
    expect(parseLength('2m', 'ftin')).toBe(2)
  })

  it('a bare number follows the mode', () => {
    expect(parseLength('5', 'ftin')).toBeCloseTo(5 * METRES_PER_FOOT, 9)
    expect(parseLength('5', 'm')).toBe(5)
  })

  it('accepts the smart quotes an iOS keyboard and a paste produce', () => {
    expect(parseLength('12’6”', 'ftin')).toBeCloseTo(
      parseLength(`12'6"`, 'ftin')!,
      9,
    )
    expect(parseLength('12′6″', 'ftin')).toBeCloseTo(
      parseLength(`12'6"`, 'ftin')!,
      9,
    )
  })

  it('rejects what is not a length', () => {
    for (const bad of ['', '   ', 'wall', '-5', `-12'6"`, '5 furlongs', '1/0"']) {
      expect(parseLength(bad, 'ftin'), bad).toBeNull()
    }
  })

  it('rejects a value that overflows to Infinity', () => {
    expect(parseLength('1e400 m', 'm')).toBeNull()
  })
})

describe('formatLength', () => {
  it('writes feet and inches the way a drawing does', () => {
    expect(formatLength(12 * 0.3048 + 6 * 0.0254, 'ftin')).toBe(`12'6"`)
    expect(formatLength(12 * 0.3048, 'ftin')).toBe(`12'`)
    expect(formatLength(3.81, 'm')).toBe('3.81 m')
  })

  it('carries a rounded 11.7 inches up into the next foot', () => {
    // Not 0'12" — the carry is what stops that.
    expect(formatLength(11.7 * 0.0254, 'ftin')).toBe(`1'`)
  })

  it('never prints a negative zero', () => {
    expect(formatLength(-0.001, 'm')).toBe('0.00 m')
  })

  it('never prints NaN', () => {
    expect(formatLength(Number.NaN, 'm')).toBe('0.00 m')
    expect(formatLength(Number.POSITIVE_INFINITY, 'ftin')).toBe('0"')
  })

  it('drops the inch mark only once feet have marked the units', () => {
    expect(formatLengthCompact(12 * 0.3048 + 6 * 0.0254, 'ftin')).toBe(`12'6`)
    expect(formatLengthCompact(6 * 0.0254, 'ftin')).toBe(`6"`)
    expect(formatLengthCompact(4, 'm')).toBe('4m')
  })
})

describe('★ format and parse are NOT inverses — and must not become so', () => {
  it('a formatted length rounds to the nearest inch', () => {
    // 3.812 m is 12'6.08". The label says 12'6", which is 3.8100 m.
    const metres = 3.812
    const label = formatLength(metres, 'ftin')
    const reparsed = parseLength(label, 'ftin')!

    expect(label).toBe(`12'6"`)
    expect(reparsed).not.toBe(metres)
    expect(Math.abs(reparsed - metres)).toBeLessThan(0.0254 / 2)
  })

  it('★ round-tripping repeatedly walks the value — the reason it is forbidden', () => {
    // The exact failure the module's header warns about: normalising a wall
    // through its own label once per edit drifts it by up to half an inch each
    // time. One trip is enough to show the drift is real and directional.
    let metres = 3.812
    const start = metres
    for (let i = 0; i < 5; i++) {
      metres = parseLength(formatLength(metres, 'ftin'), 'ftin')!
    }
    expect(metres).not.toBe(start)
    expect(metres).toBe(parseLength(`12'6"`, 'ftin'))
  })

  it('a compact metric label still parses back', () => {
    // The comment claims both compact forms round-trip. Held to it.
    for (const metres of [4, 3.81, 0.5, 12.25]) {
      expect(parseLength(formatLengthCompact(metres, 'm'), 'm')).toBeCloseTo(metres, 2)
    }
  })

  it('an area label deliberately does NOT parse back', () => {
    // Thousands separators are applied to areas and not to lengths, precisely
    // because a comma would stop the result parsing.
    expect(formatArea(200, 'ftin')).toContain(',')
    expect(formatLength(2000, 'm')).not.toContain(',')
  })
})

describe('formatArea', () => {
  it('reports square feet in imperial and square metres in metric', () => {
    expect(formatArea(100, 'm')).toBe('100.0 m²')
    expect(formatArea(100, 'ftin')).toBe('1,076 sq ft')
  })

  it('gives a small area a decimal so it does not collapse', () => {
    expect(formatArea(0.5, 'ftin')).toBe('5.4 sq ft')
  })
})

describe('★ the drawing grid belongs to the unit', () => {
  it('is six inches in imperial and half a metre in metric', () => {
    // §4 invariant 8, and README claim C8: several places say "0.5 m grid",
    // which is only true in metric mode. The DEFAULT unit is ftin.
    expect(GRID_STEP.ftin.cell).toBeCloseTo(0.1524, 9)
    expect(GRID_STEP.m.cell).toBe(0.5)
  })

  it('lands round imperial lengths exactly', () => {
    // The reason the step is not 0.5 m: on a half-metre grid the shortest wall
    // you can drag out is 1'7⅝", and no round imperial length is reachable.
    for (const feet of [1, 2, 5, 10]) {
      const steps = (feet * METRES_PER_FOOT) / GRID_STEP.ftin.cell
      expect(steps).toBeCloseTo(Math.round(steps), 9)
    }
  })

  it('has a section line every five cells-worth of unit', () => {
    expect(GRID_STEP.ftin.section).toBeCloseTo(5 * METRES_PER_FOOT, 9)
    expect(GRID_STEP.m.section).toBe(5)
  })
})
