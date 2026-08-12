# Sample blueprints (test fixtures)

Several renderings of the **same** floor plan, plus the design document a correct
import should produce from any of them. Because the geometry never changes,
`blueprint-expected.json` is the ground truth for every one of them — so any
difference in what imports is a difference in how the drawing was *presented*,
not in what it depicts.

| File | Use it for |
| --- | --- |
| `blueprint-simple.png` | Easiest case: pure black-on-white, no grid, no dimensions. Start here. |
| `blueprint-detailed.png` | Realistic case: grid, dimension lines, title, scale bar, north arrow — all noise a parser must ignore. |
| `blueprint-dark.png` | Classic white-on-blue blueprint. Tests that detection is not hard-coded to "dark lines on light paper". |
| `blueprint-colour.svg` | Rooms flooded with a floor tint, walls in brown rather than black. The floor — not the paper — is the commonest colour on the sheet, which is what collapses a lightness-only threshold into one blob. |
| `blueprint-noisy.svg` | A stock plan as downloaded: furniture outlines beside the walls and a watermark lying across the whole drawing. |
| `blueprint-thin.svg` | Hairline walls (¼ thickness), as a plan pasted at screenshot size draws them. Tests that detection is not tied to a fixed pixel thickness. |
| `blueprint-expected.json` | Ground truth. Import any of the above, export the result, diff against this. |
| `blueprint-*.svg` | Vector source of each PNG, if you need to re-render at another size. |

The app accepts SVG directly (it takes any `image/*`), so the SVG-only fixtures
can be dragged straight in — no PNG step needed.

## The plan

Outer shell 12.00 m × 9.00 m, drawn at **100 px = 1 m** (so scale 1:100 at 96 dpi).
Origin for `blueprint-expected.json` is the plan's outer top-left corner — pixel
`(200, 150)` in the images. Convert with `metres = (pixel - origin) / 100`.

- Living Room 6 × 5 m, Kitchen 6 × 5 m, Bath 3 × 4 m, Bedroom 9 × 4 m
- 7 walls: 4 exterior (16 px = 0.16 m thick), 3 interior (12 px = 0.12 m thick)
- 11 openings: 6 windows (drawn as a thin frame across the wall gap) and
  5 doors (drawn as a gap + leaf line + quarter-circle swing arc)

## Regenerating

```bash
node gen-blueprint.mjs simple   > blueprint-simple.svg
node gen-blueprint.mjs detailed > blueprint-detailed.svg
node gen-blueprint.mjs dark     > blueprint-dark.svg
node gen-blueprint.mjs colour   > blueprint-colour.svg
node gen-blueprint.mjs noisy    > blueprint-noisy.svg
node gen-blueprint.mjs thin     > blueprint-thin.svg
```

Then render each SVG to PNG (any tool; these were made with headless Chrome at
1600×1200). Edit the `walls` array at the top of the script to produce other
layouts — L-shaped plans, diagonal walls, plans with no interior doors — as you
need harder cases.

## `real-plan-cv-untitled.json` — the real failure, kept unmodified

A user's actual saved project, exported from the running app on 2026-08-12.
It reports **3 rooms and 176 sq ft on a 950 sq ft bounding box**, and it is
the case the room-detection diagnostics were opened for.

**It is a DIAGNOSTIC fixture, not a golden one.** It is an example of failure:
every wall carries `provenance.source: "cv"`, the blueprint was scaled by
`calibration.source: "ai"` and never measured, and 19 of its 30 walls are
under 90 mm thick. Do not "fix" it, do not regenerate it, and do not tune
anything against it — see `docs/STATE.md` findings 28–30 for what it proves.
