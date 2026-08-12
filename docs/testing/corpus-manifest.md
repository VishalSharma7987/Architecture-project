# Corpus manifest

Every drawing held in `corpus/`, which is **gitignored** — the images are not
redistributable, so the repository carries this record of them instead of the
files. A row here is enough to identify a file, re-check that it is the same
file, and know what it may be used for.

Hashes are the first 16 hex characters of the SHA-256 of the file as received.
Dimensions are read from the file header, not from any decode.

---

## Batch 3 — the right artefact class (4 files)

**Stated provenance:** architect contact, August 2026.
**Stated permission:** validation only, not for redistribution.

| # | File | Ref | SHA-256 (16) | Bytes | Header dims | Format |
|---|---|---|---|---|---|---|
| 10 | `image(10).png` | img1 | `95714c2c9b508bef` | 101 363 | 474 × 693 | png |
| 11 | `image(11).png` | img2 | `5a07fc171ea219c4` | 424 477 | 474 × 842 | png |
| 12 | `image(12).png` | img3 | `bab93e0754612113` | 51 823 | 473 × 496 | png |
| 13 | `image(13).png` | img4 | `2595b80a9305a958` | 118 939 | 473 × 494 | png |

**All four are genuine PNG** (`89504e470d0a1a0a`), unlike batch 2's JPEG-behind-a-`.png`.
They decode headless, so batch 3 is the first to exercise the harness past the
header read.

> ### EVERY FILE IS 473–474 px WIDE
>
> Four drawings, four different aspect ratios (0.68, 0.56, 0.95, 0.96), and all
> four land within one pixel of the same width. **That is a fixed-width resize,
> not a coincidence** — a share, download or preview step normalised every image
> to ~474 px across.
>
> **These are thumbnails of good drawings, not the drawings.** It changes how
> every measurement below must be read: where a gate refuses, the question is
> always whether it is refusing the drawing or the transmission. Batch 2's files
> were also degraded, by JPEG re-encoding; batch 3's are degraded by
> downscaling, which is worse, because detail that was resampled away cannot be
> recovered by any amount of downstream work.
>
> **Asking for the originals is the single highest-value action available**, and
> it costs the contributor one re-send.

### Tagging

| # | Ref | Tags | Usable for detection |
|---|---|---|---|
| 10 | img1 | `line-work` `sheet-white` `wall-solid` `anno-dimensions` `anno-furniture` `geom-orthogonal` `dim-metric` `dim-stated-scale` `src-cad-export` | **The best artefact in the corpus, and still not usable — at this size.** Clean CAD line work, solid black poché ~4 source px, column squares at junctions, metric dimension chains that close (2.00+4.00+3.00 = 9.00 across; 3.00+5.00+3.00 = 11.00 down), stated `SCALE 1:100 MTS.` Nothing about the *drawing* is wrong. It resolves to **36.0 px/m**, under Gate 1b's 40 px/m floor, purely because it arrived 474 px wide. |
| 11 | img2 | `line-work` `sheet-photo` `sheet-composite` `wall-outlined` `anno-dimensions` `geom-orthogonal` `dim-metric` `src-photo` | **No — but it is the most valuable file in the corpus and should be kept.** A photographed sanction print: grey paper cast, a fold crease running through the plan, 0.59° skew, uneven lighting, elevation above the plan on one sheet, cm room dimensions (`300X144`, `288X300`), and a full mark set (`D1` `D2` `W1` `W2` `W3` `MD` `GW` `V`). It is the only file that exercises the paper-contrast masks against real paper. The sheet top is cropped mid-title. |
| 12 | img3 | `line-work` `sheet-white` `wall-outlined` `anno-dimensions` `anno-none` `geom-orthogonal` `geom-lshape` `dim-imperial` `src-cad-export` | **No.** Thin double-line walls, hollow between — `mergeWallFaces`'s intended case — with no furniture at all, which makes it the cleanest input in the corpus by annotation load. But at 473 × 496 it is the smallest of the four and resolves to **24.2 px/m**, the lowest figure measured anywhere. It refuses at Gate 1a before that matters. |
| 13 | img4 | `line-work` `sheet-white` `wall-tinted` `anno-dimensions` `anno-furniture` `geom-orthogonal` `dim-mixed` `src-cad-export` | **No.** Grey-filled wall bands, furniture as line symbols, `W`/`V`/`MD` marks, and dual-unit dimensions (`36' [10.97]`) on both axes — the only drawing in the corpus that states its size in imperial *and* metric, which is why its two axes can be cross-checked without unit conversion. 494 px longest edge; refuses at Gate 1a. |

**Three corrections to the brief's reading of these sheets:**

1. **img1's walls are solid poché, not hatched.** At 4× magnification the band is
   filled black. The grid that reads as hatching at low resolution is the
   **kitchen counter tiling**, and there is a second grid on the stair treads.
   The distinction matters: `wall-hatched` is the case `mergeWallFaces` struggles
   with, and this drawing is not it.
2. **img4's walls are tinted, not solid** — a mid-grey fill between darker
   edges, tagged `wall-tinted`.
3. **img1 carries `8.00` *and* `11.00` vertically**, like img3. `11.00` is the
   overall (3.00+5.00+3.00 on the right-hand chain); `8.00` is a partial chain
   on the left that starts below the kitchen block. Only `11.00` is the
   building.

### Two tags this batch needed

- **`line-work`** — an orthographic drawing whose walls are drawn as line work
  rather than rendered. The opposite pole from `render-3d`, and the axis batch 2
  proved matters most: it is the artefact-class question, asked before any
  quality question.
- **`dim-stated-scale`** — the sheet names its own ratio (`SCALE 1:100 MTS.`).
  One file in thirteen has this, and it is the only rung of the calibration
  ladder that needs no measurement at all.

The brief proposed `scan-photo`, `hatched-wall`, `metric-dimensions` and
`imperial-dimensions`. Those are synonyms for `sheet-photo`/`src-photo`,
`wall-hatched`, `dim-metric` and `dim-imperial`, which already exist, so the
existing names are used rather than a second vocabulary. `wall-hatched` turned
out not to apply to anything in this batch (correction 1).

---

## Batch 2 — first real batch (7 files)

**Stated provenance:** architect contact, August 2026.
**Stated permission:** validation only. **Not for redistribution**, which is why
`corpus/` is gitignored and why no image is reproduced in any document, report
or test fixture in this repository.

| # | File | SHA-256 (16) | Bytes | Header dims | Format |
|---|---|---|---|---|---|
| 1 | `Media (3).png` | `a89052117870ae29` | 168 612 | 900 × 1600 | **JPEG** |
| 2 | `Media (4).png` | `8e9e48b1b01e4431` | 168 234 | 1536 × 1024 | **JPEG** |
| 3 | `Media (5).png` | `af6137cdc2f22c2f` | 219 810 | 1024 × 1536 | **JPEG** |
| 4 | `Media (6).png` | `c9637d75f7b83625` | 122 114 | 892 × 1599 | **JPEG** |
| 5 | `Media (7).png` | `ec5d7ac44a207823` | 180 043 | 1190 × 1322 | **JPEG** |
| 6 | `Media (8).png` | `d12150fb8d61a0b2` | 158 914 | 1358 × 1158 | **JPEG** |
| 7 | `Media (9).png` | `cc2c15687504d164` | 159 121 | 1347 × 1168 | **JPEG** |

**All seven are JPEG data carrying a `.png` extension.** The harness reads the
magic bytes rather than the name, so it reports them correctly; a tool that
trusted the extension would mis-parse every one. Recorded because it says
something about how the files travelled — re-encoded and renamed by a messaging
or download step, not exported from a drawing tool.

That re-encode is not cosmetic. JPEG at these sizes puts ringing on exactly the
high-contrast black-on-white edges the detector thresholds against, and no
amount of downstream work recovers it. **Every measurement below is a
measurement of a JPEG, not of the drawing.**

### Batch 1 — carried over (2 files)

| # | File | SHA-256 (16) | Bytes | Header dims | Format |
|---|---|---|---|---|---|
| 8 | `first-floor-557px.png` | `4c03c1c92c25ae0c` | 31 196 | 557 × 513 | png |
| 9 | `51f2f7db99ab4affa1087cf754b297f4.webp` | `6fe2b9e2487c12c2` | 11 178 | 400 × 300 | webp |

Row 9 is the raster behind [`samples/real-plan-cv-untitled.json`](../../samples/real-plan-cv-untitled.json) — the plan that
produced 30 walls and one room, and the reason the B5b gates exist.

---

## Tagging

Two columns, kept apart on purpose:

- **Tags** — what the sheet *is*, on the axes in [corpus.md](corpus.md#taxonomy).
- **Usable for detection** — my own judgement, with the reason. It is not
  derived from the tags and it is not the contributor's claim.

| # | File | Tags | Usable for detection |
|---|---|---|---|
| 1 | `Media (3)` | `sheet-coloured` `wall-solid` `anno-furniture` `anno-text-heavy` `anno-dimensions` `anno-northarrow-scalebar` `geom-orthogonal` `dim-imperial` `src-listing-jpeg` `sheet-composite` | **No as delivered. Best crop candidate of the coloured five.** Walls are genuine solid black poché and the geometry is orthogonal — the two things the detector most needs. But the right third is a Vastu legend and a details list, the bottom fifth is three Hindi feature boxes, and every room is flooded with a floor tint and a rendered bed/sofa/car. The plan panel alone might be tractable; **the sheet is not, and there is no crop step.** |
| 2 | `Media (4)` | `sheet-coloured` `wall-solid` `anno-furniture` `anno-text-heavy` `anno-dimensions` `geom-orthogonal` `geom-multi-unit` `dim-imperial` `src-listing-jpeg` `sheet-composite` | **No.** Two *different storeys* side by side on one sheet, plus a left-hand specification panel. The detector would trace both plans into a single wall network with no relationship between them and no way to say which storey a wall belongs to. This is the crop gap in its clearest form. |
| 3 | `Media (5)` | `sheet-coloured` `sheet-photo` `wall-solid` `anno-furniture` `anno-text-heavy` `anno-dimensions` `geom-orthogonal` `geom-multi-unit` `dim-imperial` `src-listing-jpeg` `sheet-composite` | **No — the worst of the seven.** Two storeys *and* a photographic front elevation *and* a highlights panel *and* two tabulated room schedules. A photograph on the same sheet as the plan means the ink mask is competing against rendered brick, glass and lighting. |
| 4 | `Media (6)` | `sheet-coloured` `wall-outlined` `anno-furniture` `anno-hatchfill` `anno-dimensions` `geom-orthogonal` `dim-imperial` `src-listing-jpeg` | **No.** The only coloured one that is a *single* plan with no legend panel, so the crop problem does not apply — but the walls are thin grey-brown outlines drawn over photo-textured floor fills, not poché. `mergeWallFaces` exists for outlined walls; it does not exist for outlined walls whose interior fill is a photograph of marble. |
| 5 | `Media (7)` | `render-3d` `anno-furniture` `anno-dimensions` `dim-imperial` `src-listing-jpeg` | **No, categorically.** This is not a plan. It is a 3D isometric cutaway with wall tops, wall sides and furniture in perspective. There is no orthographic projection, so there is no single scale that describes it, so no calibration is even meaningful. Nothing about it can be fixed by cropping. |
| 6 | `Media (8)` | `render-3d` `anno-furniture` `anno-dimensions` `dim-imperial` `src-listing-jpeg` | **No, categorically.** Same class as #5. |
| 7 | `Media (9)` | `sheet-white` `sheet-photo` `wall-solid` `anno-dimensions` `anno-none` `geom-orthogonal` `dim-imperial` `src-listing-jpeg` `sheet-composite` | **The plan panel: yes in principle. The sheet: no.** The top-left panel is the only true working-drawing line work in the batch — black-on-white, solid poché, no furniture, dashed door swing arcs, window/door marks lettered `M` and `D`, per-room dimensions, and overall `17'-5"` and `20'` dimension lines on all four sides. It is what the corpus request was meant to produce. It occupies about **38% of the sheet by area**; the other 62% is five photographs. **This single file is the strongest argument for a crop step in the codebase** (STATE.md finding 36). |

### Two tags this batch needed and the vocabulary did not have

- **`render-3d`** — a 3D view rather than an orthographic plan. Distinct from
  `sheet-photo`: a photograph *of a plan* is still a plan and can in principle
  be rectified; an isometric render is not a plan at all and never will be. Two
  of seven files are this, so it needs to be sayable.
- **`sheet-composite`** — several panels on one sheet, only some of which are
  the plan. Distinct from `geom-multi-unit`, which is several *plans* of the
  same kind. Five of seven files are this.

Both are now in [corpus.md](corpus.md#taxonomy).

### The honest summary of the batch

**Zero of seven are delivered working drawings.** All seven are marketing or
listing artwork: coloured, furnished, laid out as a sales sheet with legends and
photographs. Five are 2D plans embedded in such a sheet, two are 3D renders that
are not plans at all.

One panel — `Media (9)`'s top-left — is real line work, and it is a *drawing
within* a marketing sheet rather than a delivered drawing in its own right.

This is not a criticism of the contributor. It is the corpus request being
answered exactly as written: it asked for "delivered floor plans, any format",
and these are what a search for that turns up. The request has been corrected
([corpus-request.md](corpus-request.md)) and this manifest records why.
