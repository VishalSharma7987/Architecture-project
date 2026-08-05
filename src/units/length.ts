import type { Unit } from '../store/useDesignStore'

/**
 * Display-side unit conversion. The model is metric everywhere; this module is
 * the only place that knows what a metre looks like to someone working in feet
 * and inches.
 *
 * `formatLength` is lossy — it rounds to the nearest inch (or fraction of one)
 * and `parseLength` is NOT its inverse. Never feed a formatted string back into
 * the model to "normalise" a value: round-tripping a wall through a label would
 * quietly walk its length by up to half an inch every edit. Format for eyes,
 * store what the user actually typed.
 */

/** Exact, by definition: 1 ft = 0.3048 m. */
export const METRES_PER_FOOT = 0.3048

/** Exact, by definition: 1 in = 0.0254 m. */
export const METRES_PER_INCH = 0.0254

/** Exact: one square foot in square metres. */
export const SQUARE_METRES_PER_SQUARE_FOOT = METRES_PER_FOOT * METRES_PER_FOOT

const INCHES_PER_FOOT = 12

/**
 * Drawing grid spacing, in metres, for each unit.
 *
 * The snap has to belong to the unit or the app only pretends to work in feet:
 * on a half-metre grid the shortest wall you can drag out is 1'7⅝", and round
 * imperial lengths are unreachable by hand. Six inches is the imperial
 * equivalent of the half-metre step it replaces.
 */
export const GRID_STEP: Record<Unit, { cell: number; section: number }> = {
  ftin: { cell: METRES_PER_FOOT / 2, section: METRES_PER_FOOT * 5 },
  m: { cell: 0.5, section: 5 },
}

export type LengthFormatOptions = {
  /**
   * Smallest inch fraction to show, as a denominator: 1 (whole inches, the
   * default), 2, 4, 8 or 16. Ignored when the unit is metric.
   */
  fraction?: number
  /** Decimal places for metric output. Defaults to 2 (i.e. millimetres). */
  decimals?: number
}

/**
 * A length in metres written for display.
 *
 * 'ftin' gives `12'6"`, dropping the inches when they round to zero (`12'`).
 * 'm' gives `3.81 m`. Non-finite input reads as zero so a bad number can never
 * paint `NaN` into the UI.
 */
export function formatLength(
  metres: number,
  unit: Unit,
  options: LengthFormatOptions = {},
): string {
  const value = finite(metres)
  if (unit === 'm') return `${fixed(value, options.decimals ?? 2)} m`
  return feetInches(value, options.fraction ?? 1, 'full')
}

/**
 * The same length, as short as it can be written without becoming ambiguous —
 * for dimension labels that have to fit between two walls.
 *
 * Drops the inch mark when feet are present (`12'6`) and the trailing metric
 * zeros (`4m`). Both forms still parse back through `parseLength`.
 */
export function formatLengthCompact(metres: number, unit: Unit): string {
  const value = finite(metres)
  if (unit === 'm') return `${trimZeros(fixed(value, 2))}m`
  return feetInches(value, 1, 'compact')
}

/**
 * An area in square metres written for display: `1,162 sq ft` or `108.0 m²`.
 * Areas below 10 gain a decimal so a small room does not collapse to `4 sq ft`.
 */
export function formatArea(squareMetres: number, unit: Unit): string {
  const value = finite(squareMetres)
  if (unit === 'm') return `${group(fixed(value, 1))} m²`

  const squareFeet = value / SQUARE_METRES_PER_SQUARE_FOOT
  return `${group(fixed(squareFeet, Math.abs(squareFeet) < 10 ? 1 : 0))} sq ft`
}

/**
 * Parses what a user typed into metres, or null if it means nothing.
 *
 * Accepts `12'6"`, `12'-6"`, `12 ft 6 in`, `12'6`, `6 3/4"`, `3.81m`, `381cm`,
 * `3810mm` and friends. `unit` only decides how a bare number is read — an
 * explicit unit always wins over it, so `5'` is 1.524 m even in metric mode.
 *
 * Negative and non-finite values are rejected outright; clamping to a sensible
 * range (see `LIMITS`) is the caller's job.
 */
export function parseLength(text: string, unit: Unit): number | null {
  const input = normalise(text)
  if (input === '') return null

  const metric = input.match(METRIC)
  if (metric) return scale(Number(metric[1]), METRIC_SCALE[metric[2]])

  const both = input.match(FEET_INCHES)
  if (both) {
    const inches = parseInches(both[2])
    if (inches === null) return null
    return scale(Number(both[1]) * INCHES_PER_FOOT + inches, METRES_PER_INCH)
  }

  const feet = input.match(FEET_ONLY)
  if (feet) return scale(Number(feet[1]), METRES_PER_FOOT)

  const inchesOnly = input.match(INCHES_ONLY)
  if (inchesOnly) {
    const inches = parseInches(inchesOnly[1])
    return inches === null ? null : scale(inches, METRES_PER_INCH)
  }

  const bare = input.match(BARE)
  if (bare) {
    return scale(Number(bare[1]), unit === 'm' ? 1 : METRES_PER_FOOT)
  }

  return null
}

const finite = (value: number) => (Number.isFinite(value) ? value : 0)

/** Rounds away a negative zero, so -0.001 m never prints as `-0.00 m`. */
const fixed = (value: number, decimals: number) =>
  (Number(value.toFixed(decimals)) + 0).toFixed(decimals)

const trimZeros = (text: string) =>
  text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text

/**
 * Thousands separators, on the integer part only. Deliberately not applied to
 * lengths: a comma would stop the result parsing back through `parseLength`.
 */
function group(text: string): string {
  const [whole, decimals] = text.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decimals === undefined ? grouped : `${grouped}.${decimals}`
}

/**
 * Rounds to `fraction`ths of an inch and carries the result up into feet, so
 * 11.7 inches reads `1'0"` rather than `0'12"`.
 */
function feetInches(
  metres: number,
  fraction: number,
  style: 'full' | 'compact',
): string {
  const steps = Math.max(1, Math.round(fraction))
  const ticks = Math.round((Math.abs(metres) / METRES_PER_INCH) * steps)

  const feet = Math.floor(ticks / (INCHES_PER_FOOT * steps))
  const rest = ticks - feet * INCHES_PER_FOOT * steps
  const inches = Math.floor(rest / steps)
  const numerator = rest - inches * steps

  const out = feet > 0 ? `${feet}'` : ''
  if (inches === 0 && numerator === 0 && feet > 0) {
    return sign(metres, ticks) + out
  }

  const fractionText = numerator > 0 ? reduce(numerator, steps) : ''
  // A bare `1/2"` reads better than `0 1/2"`, but only with no feet in front.
  const wholeText = fractionText && feet === 0 && inches === 0 ? '' : `${inches}`
  const body = [wholeText, fractionText].filter(Boolean).join(' ')
  // Dropping the inch mark is only safe once feet have marked the units.
  const mark = style === 'compact' && feet > 0 ? '' : '"'

  return sign(metres, ticks) + out + body + mark
}

const sign = (metres: number, ticks: number) =>
  metres < 0 && ticks > 0 ? '-' : ''

function reduce(numerator: number, denominator: number): string {
  let a = numerator
  let b = denominator
  while (b > 0) {
    const t = b
    b = a % b
    a = t
  }
  return `${numerator / a}/${denominator / a}`
}

/** A plain unsigned number — a leading `-` is what rejects negative lengths. */
const NUM = String.raw`\d+(?:\.\d+)?|\.\d+`
const FEET_MARK = String.raw`(?:'|ft|feet|foot)`
const INCH_MARK = String.raw`(?:"|in|inch|inches)`
/** `6`, `6.5`, `3/4` or `6 3/4`. */
const INCH_BODY = String.raw`(?:${NUM})\s\d+\/\d+|\d+\/\d+|(?:${NUM})`

const METRIC = new RegExp(
  String.raw`^(${NUM})\s?(m|metre|metres|meter|meters|cm|mm)$`,
)
const FEET_INCHES = new RegExp(
  String.raw`^(${NUM})\s?${FEET_MARK}\s?-?\s?(${INCH_BODY})\s?${INCH_MARK}?$`,
)
const FEET_ONLY = new RegExp(String.raw`^(${NUM})\s?${FEET_MARK}$`)
const INCHES_ONLY = new RegExp(String.raw`^(${INCH_BODY})\s?${INCH_MARK}$`)
const BARE = new RegExp(String.raw`^(${NUM})$`)

const METRIC_SCALE: Record<string, number> = {
  m: 1,
  metre: 1,
  metres: 1,
  meter: 1,
  meters: 1,
  cm: 0.01,
  mm: 0.001,
}

/** Smart quotes come back from iOS keyboards and paste; treat them as marks. */
function normalise(text: string): string {
  return text
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function parseInches(body: string): number | null {
  const mixed = body.match(new RegExp(String.raw`^(${NUM})\s(\d+)\/(\d+)$`))
  if (mixed) {
    const denominator = Number(mixed[3])
    if (denominator === 0) return null
    return Number(mixed[1]) + Number(mixed[2]) / denominator
  }

  const fraction = body.match(/^(\d+)\/(\d+)$/)
  if (fraction) {
    const denominator = Number(fraction[2])
    return denominator === 0 ? null : Number(fraction[1]) / denominator
  }

  return Number(body)
}

const scale = (value: number, factor: number) => {
  const metres = value * factor
  return Number.isFinite(metres) ? metres : null
}
