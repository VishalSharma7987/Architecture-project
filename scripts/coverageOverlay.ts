/**
 * B44 — draw what the SCORER decided, not what the detector drew. DEV ONLY.
 *
 *   npx jiti scripts/coverageOverlay.ts <out-dir>
 *
 * ⚠ SYNTHETIC. This validates the scoring rule against controlled fixtures.
 * It does not establish detector performance on arbitrary real-world
 * floor-plan images.
 *
 * `wallBench.ts` already draws truth-vs-detections. This draws the layer
 * above it: which fragments the scorer ASSIGNED to which wall, what it
 * refused, and the coverage each wall ended up with — so a grouping that
 * quietly swallowed something unrelated is visible rather than inferred.
 */
import { writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { buildPlanFixture, type FixtureScale, type WallRendering } from '../src/test/planFixture'
import { detectWallSegments, type PixelSegment } from '../src/blueprint/detectWalls'
import { scoreWallCoverage } from '../src/blueprint/coverageScore'

const OUT = process.argv[2] ?? '.'

/**
 * Colour says what the SCORER thought, not what the detector found:
 *   green  a wall whose collective coverage cleared the threshold
 *   amber  a wall that fell short — found, but not enough of it
 *   red    a detection assigned to no wall at all (genuinely spurious)
 * Each accepted fragment is also banded so a two-piece wall reads as two.
 */
function overlay(
  rendering: WallRendering,
  scale: FixtureScale,
  file: string,
): string {
  const fixture = buildPlanFixture(scale, { rendering })
  const segments = detectWallSegments(fixture.image, {
    rasterScale: 1,
    metresPerPixel: 1 / fixture.pixelsPerMetre,
  })
  const score = scoreWallCoverage(segments, fixture.truth, fixture.annotation)

  const { width, height, data } = fixture.image
  const png = new PNG({ width, height })
  for (let i = 0; i < width * height; i++) {
    const grey = 255 - (255 - data[i * 4]) * 0.25
    png.data[i * 4] = grey
    png.data[i * 4 + 1] = grey
    png.data[i * 4 + 2] = grey
    png.data[i * 4 + 3] = 255
  }
  const paint = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const at = (Math.round(y) * width + Math.round(x)) * 4
    png.data[at] = r
    png.data[at + 1] = g
    png.data[at + 2] = b
  }
  const line = (s: PixelSegment, r: number, g: number, b: number, fat = 2) => {
    const steps = Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = s.x1 + (s.x2 - s.x1) * t
      const y = s.y1 + (s.y2 - s.y1) * t
      for (let o = 0; o < fat; o++) {
        paint(x + (Math.abs(s.y2 - s.y1) > Math.abs(s.x2 - s.x1) ? o : 0), y + (Math.abs(s.y2 - s.y1) > Math.abs(s.x2 - s.x1) ? 0 : o), r, g, b)
      }
    }
  }

  // Re-derive the assignment the scorer made, so the picture cannot claim
  // an association the score did not.
  const byWall = new Map<string, PixelSegment[]>()
  for (const s of segments) {
    const horiz = Math.abs(s.y2 - s.y1) <= Math.abs(s.x2 - s.x1)
    const centre = horiz ? (s.y1 + s.y2) / 2 : (s.x1 + s.x2) / 2
    const tol = Math.max(3, Math.max(...fixture.truth.map((w) => w.thickness)) / 2 + 1)
    const owner = fixture.truth
      .filter((w) => (w.y1 === w.y2) === horiz)
      .filter((w) => Math.abs(centre - (horiz ? w.y1 : w.x1)) <= tol)
      .filter((w) => Math.abs(s.thickness - w.thickness) / w.thickness <= 0.6)
      .sort(
        (p, q) =>
          Math.abs(centre - (horiz ? p.y1 : p.x1)) -
          Math.abs(centre - (horiz ? q.y1 : q.x1)),
      )[0]
    if (!owner) {
      line(s, 220, 30, 30, 3) // spurious
      continue
    }
    const list = byWall.get(owner.id)
    if (list) list.push(s)
    else byWall.set(owner.id, [s])
  }

  for (const cov of score.coverage) {
    const accepted = cov.covered >= 0.8
    for (const s of byWall.get(cov.id) ?? []) {
      if (accepted) line(s, 20, 160, 70, 3)
      else line(s, 230, 150, 20, 3)
    }
  }

  writeFileSync(file, PNG.sync.write(png))

  const worst = [...score.coverage].sort((a, b) => a.covered - b.covered)[0]
  return (
    `${rendering}/${scale}: matched ${score.matched}/7 spurious ${score.spurious} ` +
    `maxFragments ${Math.max(...score.coverage.map((c) => c.fragments))} ` +
    `lowest coverage ${worst.id} ${(worst.covered * 100).toFixed(0)}%`
  )
}

console.log('B44 coverage overlay — SYNTHETIC FIXTURE, not a corpus result\n')
for (const rendering of ['solid', 'outlined'] as WallRendering[]) {
  for (const scale of ['generous', 'middle', 'critical'] as FixtureScale[]) {
    console.log(
      '  ' + overlay(rendering, scale, `${OUT}/b44-${rendering}-${scale}.png`),
    )
  }
}
