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
  /** Wall FOOTPRINT across its axis, in image pixels — the same whether the
   * wall is filled or outlined. */
  thickness: number
  kind: 'shell' | 'partition'
  /** What was actually drawn — an outline too thin to hold a gap falls back. */
  renderedAs: WallRendering
  /** Inked pixels at each face. Equals `thickness` when solid. */
  stroke: number
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
/**
 * How the walls are DRAWN. B39 measured only `solid`; finding 59 named the
 * rest as what the corpus files carry and the fixture did not.
 *
 * `outlined` is the important one: half the reference drawings use it,
 * `mergeWallFaces` exists specifically to pair its two faces back into one
 * wall, and until B40 no fixture in this project had ever contained one.
 */
export type WallRendering = 'solid' | 'outlined' | 'hatched'

export type FixtureOptions = {
  degraded?: boolean
  /** Defaults to `solid` — B39's fixture, so its numbers stay reproducible. */
  rendering?: WallRendering
  /**
   * Put a room name ACROSS a wall rather than clear of it. Real drawings do
   * it constantly (a label overflowing a narrow room), and it welds a text
   * blob onto the wall's ink where no thickness rule can separate them.
   */
  textCrossesWall?: boolean
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
  /** Annotation stroke, and the face stroke of an outlined wall. */
  const hairline = ppm <= 30 ? 1 : 2
  const rendering = options.rendering ?? 'solid'

  // Building centrelines, in pixels.
  const left = margin
  const right = margin + Math.round(m(PLAN.width))
  const top = margin
  const bottom = margin + Math.round(m(PLAN.depth))

  const truth: TruthWall[] = []
  const annotation: TruthBox[] = []

  /**
   * A wall, drawn in the requested convention.
   *
   * ── The three numbers that must agree (the B39 lesson) ──
   * FOOTPRINT is `thickness` pixels, whatever the convention: the wall
   * occupies exactly the same ground whether it is filled or outlined, so
   * one ground truth describes both and a detector's answer is comparable
   * across them. STROKE is how much of that footprint is inked at each face.
   * FACE SEPARATION follows from the two — the distance between the stroke
   * CENTRES is `thickness - stroke`, and it is recorded rather than implied.
   *
   * B39's off-by-one came from exactly this class of disagreement, so
   * `checkFixture` re-measures all three off the rendered pixels.
   *
   * ── When an outline cannot be drawn ──
   * An outlined wall needs ink, gap, ink: at least `2 * stroke + 1` pixels.
   * A 3 px partition with a 1 px stroke is the boundary; below it the
   * convention is not expressible and the wall renders SOLID, with
   * `renderedAs` saying so. That is not a fixture limitation — at that size a
   * real outlined wall is not distinguishable from a solid one either, which
   * is itself a finding.
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

    const stroke = hairline
    const canOutline = thickness >= 2 * stroke + 1
    const renderedAs: WallRendering =
      rendering === 'solid' || !canOutline ? 'solid' : rendering

    /** Ink across the wall, from `lo` to `hi` inclusive, in the run's frame. */
    const across = (a: number, b: number, lo: number, hi: number) => {
      if (horizontal) fill(a, y1 + lo, b, y1 + hi)
      else fill(x1 + lo, a, x1 + hi, b)
    }

    for (const [a, b] of spans) {
      if (b <= a) continue

      if (renderedAs === 'solid') {
        // `fill` is inclusive at both ends, so the band runs to `+ half - 1`:
        // a 12 px wall must occupy 12 pixels, or the ground truth describes a
        // drawing the fixture did not draw and every measurement against it
        // is off by one.
        across(a, b, -half, half - 1)
        continue
      }

      // Two faces: `stroke` pixels at each edge of the same footprint.
      across(a, b, -half, -half + stroke - 1)
      across(a, b, half - stroke, half - 1)

      if (renderedAs === 'hatched') {
        // 45° hatch between the faces — the brick convention. Drawn as single
        // pixels so it cannot be mistaken for a face by width alone, which is
        // the property that makes hatch hard: it is ink INSIDE the wall that
        // is neither face nor void.
        // A clear pixel is left inside each face, so a cross-section still
        // reads face / gap / face and `checkFixture` can measure the stroke.
        // Hatch that touches its own face is indistinguishable from a
        // thicker face, which would make the instrument lie about what it
        // drew — the B39 hazard.
        const pitch = Math.max(2, Math.round(thickness * 0.6))
        const lo = -half + stroke + 1
        const hi = half - stroke - 1
        for (let t = Math.round(a); t <= Math.round(b); t += pitch) {
          for (let k = lo; k < hi; k++) {
            const along = t + (k - lo)
            if (along < a || along > b) continue
            if (horizontal) fill(along, y1 + k, along, y1 + k)
            else fill(x1 + k, along, x1 + k, along)
          }
        }
      }
    }

    truth.push({
      id,
      x1,
      y1,
      x2,
      y2,
      thickness,
      kind,
      renderedAs,
      stroke: renderedAs === 'solid' ? thickness : stroke,
    })
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
 * Does the fixture draw what it claims to draw?
 *
 * ── Why this exists ──
 * B39's first fixture rendered a 12 px wall as 13 px, and the detector
 * measured against it appeared to collapse seven walls into one at high
 * resolution while reading them perfectly at low. That "resolution
 * inversion" was three paragraphs from being written up as a finding, with a
 * mechanism attached. It was an off-by-one in the INSTRUMENT.
 *
 * Outlined walls make the hazard worse, because footprint, stroke and face
 * separation are three numbers that must agree rather than one. So the
 * fixture is now re-measured off its own rendered pixels: a cross-section is
 * cut through every wall and compared with what the ground truth promised.
 *
 * Returns the disagreements. An empty array is the only acceptable result,
 * and `planFixture.test.ts` asserts it for every variant.
 */
export function checkFixture(fixture: PlanFixture): string[] {
  const { image, truth } = fixture
  const problems: string[] = []
  const inkAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false
    // Mid-grey: the degraded render has no true black, so a "is it 0" test
    // would report every degraded fixture as empty.
    return image.data[(y * image.width + x) * 4] < 170
  }

  for (const wall of truth) {
    const horizontal = wall.y1 === wall.y2
    // A cross-section one quarter along, which misses the door and window
    // gaps at the middle and the junctions at the ends.
    const along = Math.round(
      horizontal
        ? wall.x1 + (wall.x2 - wall.x1) * 0.25
        : wall.y1 + (wall.y2 - wall.y1) * 0.25,
    )
    const centre = horizontal ? wall.y1 : wall.x1
    const reach = wall.thickness + 4

    const runs: Array<[number, number]> = []
    let start: number | null = null
    for (let d = -reach; d <= reach; d++) {
      const on = horizontal ? inkAt(along, centre + d) : inkAt(centre + d, along)
      if (on && start === null) start = d
      if (!on && start !== null) {
        runs.push([start, d - 1])
        start = null
      }
    }
    if (start !== null) runs.push([start, reach])

    if (runs.length === 0) {
      problems.push(`${wall.id}: no ink at its own centreline`)
      continue
    }

    const footprint = runs[runs.length - 1][1] - runs[0][0] + 1
    if (footprint !== wall.thickness) {
      problems.push(
        `${wall.id}: footprint ${footprint} px, ground truth says ${wall.thickness}`,
      )
    }

    if (wall.renderedAs === 'solid') {
      if (runs.length !== 1) {
        problems.push(`${wall.id}: solid wall drew ${runs.length} runs, expected 1`)
      }
      continue
    }

    // Outlined and hatched both put ink at BOTH faces with a gap between.
    if (runs.length < 2) {
      problems.push(
        `${wall.id}: ${wall.renderedAs} wall drew ${runs.length} run(s) — no gap between faces`,
      )
      continue
    }
    const first = runs[0][1] - runs[0][0] + 1
    const last = runs[runs.length - 1][1] - runs[runs.length - 1][0] + 1
    if (first !== wall.stroke || last !== wall.stroke) {
      problems.push(
        `${wall.id}: faces ${first}/${last} px, ground truth says ${wall.stroke}`,
      )
    }
  }

  return problems
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
