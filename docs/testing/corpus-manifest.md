# Corpus manifest

Every drawing held in `corpus/`, which is **gitignored** — the images are not
redistributable, so the repository carries this record of them instead of the
files. A row here is enough to identify a file, re-check that it is the same
file, and know what it may be used for.

Hashes are the first 16 hex characters of the SHA-256 of the file as received.
Dimensions are read from the file header, not from any decode.

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
