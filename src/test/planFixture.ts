/**
 * A synthetic architectural drawing, rendered to pixels at a chosen scale,
 * with its ground truth attached.
 *
 * ⚠ **SYNTHETIC. Every number measured against this fixture establishes that
 * an approach works on SYNTHETIC INPUT and nothing else.** §10 rule 6 — the
 * CV constants were already tuned against generated fixtures once and ADR
 * 0002 concedes the circularity. Nothing measured here may be reported as a
 * corpus result, and no threshold may be tuned to it.
 *
 * ── Why it exists anyway ──
 * The corpus contains zero usable drawings (13 files, all refused), and the
 * one condition every approach has failed on is measurable without them: a
 * 115 mm partition at ~3 source pixels drawn with 1–2 px annotation. A
 * fixture rendered ONLY at generous resolution would validate an approach
 * that cannot work on anything real, so this one renders at three and the
 * results are reported per resolution.
 *
 * ── Why pixels rather than SVG ──
 * The failing condition is stated in PIXELS — "a 3 px partition with a 1 px
 * stroke" — and rasterising an SVG puts an anti-aliasing kernel between the
 * intent and the evidence. Drawing bands directly means the fixture contains
 * exactly the pixels it claims to.
 */

/** Everything the detector sees, and what it should have found. */
export type PlanFixture = {
  image: { data: Uint8ClampedArray; width: number; height: number }
  /** Source pixels per metre. */
  pixelsPerMetre: number
  truth: TruthWall[]
  /** Ink that is NOT structure: dimension lines, text, furniture. */
  annotation: TruthBox[]
}

export type TruthWall = {
  id: string
  /** Centreline, in IMAGE PIXELS. */
  x1: number
  y1: number
  x2: number
  y2: number
  /** Wall thickness in image pixels. */
  thickness: number
  kind: 'shell' | 'partition'
}

export type TruthBox = { x1: number; y1: number; x2: number; y2: number; kind: string }

/** Metres. A 9 × 7 m plan: shell, three partitions, a door, a window. */
const PLAN = {
  width: 9,
  depth: 7,
  shellThickness: 0.23,
  partitionThickness: 0.115,
  /** Clear margin for the dimension strings, which sit outside the building. */
  marginM: 1.4,
}

/**
 * The three resolutions, named by what they put a 115 mm partition at.
 *
 * `critical` is the measured real-world condition (batch 3: 24–36 px/m,
 * partitions 2.8–4.1 px, strokes 1–2 px) and is the one that matters. An
 * approach that works only at `generous` has not been shown to work.
 */
export const FIXTURE_SCALES = {
  generous: 104, // partition ≈ 12 px
  middle: 52, //   partition ≈ 6 px
  critical: 26, //  partition ≈ 3 px  ← the real condition
} as const

export type FixtureScale = keyof typeof FIXTURE_SCALES

/**
 * How a real file differs from a freshly rendered one, as measured.
 *
 * A crisp black-on-white render is not what arrives. Finding 37 measured
 * every corpus file passing through a fixed-width resize; finding 39
 * measured what a resample kernel does to a 1 px line; finding 40 measured a
 * drawing whose **darkest 0.5% of pixels sits at luminance 89 — there is no
 * true black anywhere in it**, so Otsu finds a threshold but the faces
 * threshold inconsistently along their length and never pair into a wall.
 *
 * `degraded` applies both: a box resample, then a luminance floor. It is the
 * difference between a fixture that validates an approach and a fixture that
 * can fail one.
 */
export type FixtureOptions = {
  degraded?: boolean
}

/** Finding 40's measurement: the darkest ink in a real failing file. */
const DEGRADED_BLACK = 89

export function buildPlanFixture(
  scale: FixtureScale,
  options: FixtureOptions = {},
): PlanFixture {
  const ppm = FIXTURE_SCALES[scale]
  const m = (metres: number) => metres * ppm
  const margin = Math.round(m(PLAN.marginM))
  const width = Math.round(m(PLAN.width)) + margin * 2
  const height = Math.round(m(PLAN.depth)) + margin * 2

  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let i = 3; i < data.length; i += 4) data[i] = 255

  /** Ink a filled axis-aligned box, in pixels. Black on white. */
  const fill = (x0: number, y0: number, x1: number, y1: number, value = 0) => {
    const xa = Math.max(0, Math.round(Math.min(x0, x1)))
    const xb = Math.min(width - 1, Math.round(Math.max(x0, x1)))
    const ya = Math.max(0, Math.round(Math.min(y0, y1)))
    const yb = Math.min(height - 1, Math.round(Math.max(y0, y1)))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const at = (y * width + x) * 4
        data[at] = value
        data[at + 1] = value
        data[at + 2] = value
      }
    }
  }

  const shellPx = Math.max(1, Math.round(m(PLAN.shellThickness)))
  const partPx = Math.max(1, Math.round(m(PLAN.partitionThickness)))
  /** Annotation stroke: 1 px at the critical scale, 2 px above it. */
  const hairline = ppm <= 30 ? 1 : 2

  // Building centrelines, in pixels.
  const left = margin
  const right = margin + Math.round(m(PLAN.width))
  const top = margin
  const bottom = margin + Math.round(m(PLAN.depth))

  const truth: TruthWall[] = []
  const annotation: TruthBox[] = []

  /**
   * A solid (poché) wall band centred on its centreline — the convention two
   * of the four reference drawings use, and the one this fixture covers.
   * OUTLINED walls (two thin parallel faces) are a second convention and are
   * deliberately NOT modelled here; see STATE.md finding 59.
   */
  const wall = (
    id: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thickness: number,
    kind: 'shell' | 'partition',
    /** Gap along the wall to leave unfilled — a door or a window. */
    gap?: { from: number; to: number },
  ) => {
    const half = thickness / 2
    const horizontal = y1 === y2
    const runFrom = horizontal ? x1 : y1
    const runTo = horizontal ? x2 : y2
    const spans: Array<[number, number]> = gap
      ? [
          [runFrom, gap.from],
          [gap.to, runTo],
        ]
      : [[runFrom, runTo]]

    for (const [a, b] of spans) {
      if (b <= a) continue
      // `fill` is inclusive at both ends, so the band runs to `+ half - 1`:
      // a 12 px wall must occupy 12 pixels, or the ground truth describes a
      // drawing the fixture did not draw and every measurement against it is
      // off by one.
      if (horizontal) fill(a, y1 - half, b, y1 + half - 1)
      else fill(x1 - half, a, x1 + half - 1, b)
    }
    truth.push({ id, x1, y1, x2, y2, thickness, kind })
  }

  /* ── the building: shell, three partitions ─────────────────────────────── */

  const doorFrom = top + Math.round(m(2.4))
  const doorTo = doorFrom + Math.round(m(0.9))
  const winFrom = left + Math.round(m(5.6))
  const winTo = winFrom + Math.round(m(1.2))

  wall('shell-n', left, top, right, top, shellPx, 'shell', {
    from: winFrom,
    to: winTo,
  })
  wall('shell-e', right, top, right, bottom, shellPx, 'shell')
  wall('shell-s', left, bottom, right, bottom, shellPx, 'shell')
  wall('shell-w', left, top, left, bottom, shellPx, 'shell')

  const midX = left + Math.round(m(3.5))
  const midY = top + Math.round(m(3.5))
  const rightX = left + Math.round(m(6.5))

  // A door opening in the long partition, so a gap-bridging rule is exercised.
  wall('part-a', midX, top, midX, bottom, partPx, 'partition', {
    from: doorFrom,
    to: doorTo,
  })
  wall('part-b', midX, midY, right, midY, partPx, 'partition')
  wall('part-c', rightX, midY, rightX, bottom, partPx, 'partition')

  // Glazing: two hairlines across the window opening, the standard symbol.
  const inset = Math.max(1, Math.round(shellPx * 0.3))
  fill(winFrom, top - inset, winTo, top - inset + hairline - 1)
  fill(winFrom, top + inset, winTo, top + inset + hairline - 1)
  annotation.push({ x1: winFrom, y1: top - inset, x2: winTo, y2: top + inset, kind: 'glazing' })

  /* ── annotation: dimension strings OUTSIDE, text and furniture INSIDE ──── */

  /** A dimension run: line, witness lines, ticks. All hairline. */
  const dimensionRun = (
    x0: number,
    y0: number,
    x1v: number,
    y1v: number,
    stations: number[],
  ) => {
    const horizontal = y0 === y1v
    fill(x0, y0, x1v, y0 + hairline - 1)
    if (!horizontal) fill(x0, y0, x0 + hairline - 1, y1v)
    const tick = Math.max(2, Math.round(ppm * 0.06))
    for (const s of stations) {
      if (horizontal) fill(s, y0 - tick, s + hairline - 1, y0 + tick)
      else fill(x0 - tick, s, x0 + tick, s + hairline - 1)
    }
    annotation.push({
      x1: Math.min(x0, x1v) - tick,
      y1: Math.min(y0, y1v) - tick,
      x2: Math.max(x0, x1v) + tick,
      y2: Math.max(y0, y1v) + tick,
      kind: 'dimension',
    })
  }

  // Two chains outside the building, exactly where the reference puts them.
  const dimGap = Math.round(margin * 0.55)
  dimensionRun(left, top - dimGap, right, top - dimGap, [left, midX, rightX, right])
  dimensionRun(left - dimGap, top, left - dimGap, bottom, [top, midY, bottom])

  /** Text: a row of small glyph blobs, like a room name. */
  const text = (cx: number, cy: number, glyphs: number) => {
    const h = Math.max(3, Math.round(ppm * 0.13))
    const w = Math.max(2, Math.round(h * 0.6))
    const step = w + Math.max(1, Math.round(w * 0.4))
    const x0 = cx - (glyphs * step) / 2
    for (let g = 0; g < glyphs; g++) {
      fill(x0 + g * step, cy - h / 2, x0 + g * step + w - 1, cy + h / 2, 40)
    }
    annotation.push({
      x1: x0,
      y1: cy - h / 2,
      x2: x0 + glyphs * step,
      y2: cy + h / 2,
      kind: 'text',
    })
  }

  text(left + Math.round(m(1.7)), top + Math.round(m(1.6)), 7)
  text(left + Math.round(m(5.0)), top + Math.round(m(1.6)), 6)
  text(left + Math.round(m(5.0)), top + Math.round(m(5.2)), 4)

  /** Furniture: a hairline-outlined rectangle standing free inside a room. */
  const furniture = (x0: number, y0: number, w: number, h: number) => {
    fill(x0, y0, x0 + w, y0 + hairline - 1)
    fill(x0, y0 + h, x0 + w, y0 + h + hairline - 1)
    fill(x0, y0, x0 + hairline - 1, y0 + h)
    fill(x0 + w, y0, x0 + w + hairline - 1, y0 + h)
    annotation.push({ x1: x0, y1: y0, x2: x0 + w, y2: y0 + h, kind: 'furniture' })
  }

  furniture(
    left + Math.round(m(0.6)),
    top + Math.round(m(4.4)),
    Math.round(m(2.0)),
    Math.round(m(1.6)),
  )

  if (options.degraded) degrade(data, width, height)

  return { image: { data, width, height }, pixelsPerMetre: ppm, truth, annotation }
}

/**
 * A crisp render turned into the thing a real file actually is.
 *
 * Two steps, in the order they happen to a real drawing: a 3×3 box blur
 * standing in for the resample every corpus file went through (finding 39
 * measured the cost of the kernel choice), then a luminance floor so the
 * darkest ink is `DEGRADED_BLACK` rather than 0 (finding 40).
 *
 * The ground truth is NOT adjusted: the walls are still where they were, so
 * a detector that loses them here has lost real walls, not moved goalposts.
 */
function degrade(data: Uint8ClampedArray, width: number, height: number): void {
  const source = new Uint8ClampedArray(data)
  const at = (x: number, y: number) =>
    source[(Math.min(height - 1, Math.max(0, y)) * width +
      Math.min(width - 1, Math.max(0, x))) * 4]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) sum += at(x + dx, y + dy)
      }
      const blurred = sum / 9
      // Compress into [DEGRADED_BLACK, 255]: no true black survives.
      const value = DEGRADED_BLACK + (blurred / 255) * (255 - DEGRADED_BLACK)
      const i = (y * width + x) * 4
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
    }
  }
}
