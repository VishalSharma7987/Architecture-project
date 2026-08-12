# Batch 3 through the gates

The first four drawings of the right artefact class. Rows:
[corpus-baseline-3.csv](corpus-baseline-3.csv) (13 — batch 3 plus everything carried over).

**No threshold was changed and none may be changed because of this batch**
(§10 rule 6). Several numbers below sit just under a gate's floor. That is the
finding, not an invitation.

---

## 0. The measurement method, and why it is not committed

The harness reports what the gates say. Three questions in the brief need more
than that — px/m per axis, per-candidate mask behaviour, skew — and none can be
answered from the CSV. They were measured with one-off scripts, run, and
deleted, because the brief scopes this commit to documentation and manifest.
**That is a judgement call and it costs reproducibility**; say the word and the
probes can be committed under `scripts/`.

The methods, so the numbers can be rebuilt:

- **Outer wall rectangle** — total dark pixels per column and per row inside a
  region given by hand, then the peak spans at ≥55% of the maximum. Longest
  *contiguous* run was tried first and fails: outer walls are broken by door and
  window openings, so no unbroken run survives. Regions used: img1 `x55-400
  y100-545`, img2 `x45-425 y375-760`, img3 `x95-400 y45-430`, img4 `x30-445
  y20-470`. A region has to be given by hand because there is no crop step
  (finding 36).
- **Edge trace** — per row the first and last dark column, per column the first
  and last dark row, reported as **medians** so a few stray marks do not move
  the answer the way a min/max bounding box would.
- **Skew** — for each column, the first dark row below a start line;
  least-squares fit through the hits. The slope is the skew.
- **Candidate masks** — `inkMask` and `paperContrastMasks` are both exported, so
  all four candidates were reconstructed without opening any internal seam.
  Per-candidate segment counts come from painting each mask into a pure
  black-on-white raster and re-detecting: a **proxy** for the private
  `segmentsFromMask`, validated by checking the best candidate's count equals
  the real `detectWallSegments` output. It did, on all four.

---

## 1. What the harness says

| Ref | File | source | longest | 1a | 2 | first refusal |
|---|---|---|---|---|---|---|
| img1 | `image(10)` | 474 × 693 | **693** | pass | **fail** | `scale-provenance` |
| img2 | `image(11)` | 474 × 842 | **842** | pass | **fail** | `scale-provenance` |
| img3 | `image(12)` | 473 × 496 | **496** | **fail** | fail | `raster-size` |
| img4 | `image(13)` | 473 × 494 | **494** | **fail** | fail | `raster-size` |

Exact messages:

> **img1, img2** — This drawing has no scale yet. Measure a known length on it
> first — walls built now would be the wrong size permanently.

> **img3, img4** — This image is 496 px on its longest edge. A floor plan needs
> at least 600 px before a wall is more than a few pixels wide. Re-upload it
> larger — enlarging this one adds no detail.

Everything after the first refusal is `not-reached` in the CSV. The measurements
in §3 onward are probe output, taken past the refusals deliberately, and are
**not** gate results.

---

## 2. (a) Gate 1a — is this a false positive?

**Two of four refuse at raster size: img3 at 496 px and img4 at 494 px, against
a 600 px floor. img1 (693) and img2 (842) pass.**

The brief's framing — *"if a GOOD drawing refuses at raster size, that is the
first evidence of a FALSE POSITIVE"* — needs one correction before the evidence
can be read, and it is the most important sentence in this report:

> **All four files are 473–474 px wide.** Four drawings, four different aspect
> ratios, all within one pixel of the same width. That is a fixed-width resize
> in transit. **We do not have these drawings; we have thumbnails of them.**

So the refusal has to be scored against two different questions:

| The question | The verdict |
|---|---|
| Is Gate 1a refusing a **good drawing**? | **Yes.** img3 and img4 are clean orthographic CAD line work with closing dimension chains. Nothing about the drawing justifies a refusal. |
| Is Gate 1a refusing **the file it was given**? | **No error.** A 494 px sheet cannot support wall detection, and the measurements in §6 prove it: at 24–35 px/m a 115 mm partition is under 3 pixels. |
| Is the **advice** right? | **Yes, and precisely so.** *"Re-upload it larger — enlarging this one adds no detail"* is exactly the correct instruction, and the original does exist. |

**So this is not a false positive, and it is not a clean true positive either.**
It is Gate 1a correctly refusing a degraded copy of a drawing that would
probably pass. Calling it a false positive would blame the gate for the
transmission; calling it a clean pass for the gate would hide that we have never
once tested it against a drawing at native resolution.

**The sharper worry runs the other way.** img1 and img2 *passed* Gate 1a at 693
and 842 px — and §6 shows both then fail every downstream gate on resolution
grounds anyway. Gate 1a's 600 px floor let through two images that Gate 1b
refuses at 36.0 and 33.6 px/m. **On this batch the 600 px floor is too low, not
too high.** That is an argument for raising it, which is exactly the tuning §10
rule 6 forbids on four samples, and it is recorded rather than acted on.

---

## 3. (b) img1 — does a stated 1:100 CAD drawing agree with itself?

img1 states `SCALE 1:100 MTS.` and carries closing chains on both axes:
`2.00 + 4.00 + 3.00 = 9.00` across, `3.00 + 5.00 + 3.00 = 11.00` down.

Detected wall bands, source px: columns `60-64` `131-135` `149-153` `203-206`
`274-278` `381-385`; rows `127-130` `234-237` `412-416` `519-523`.

| Axis | Stated | Outer face to outer face | px/m |
|---|---|---|---|
| across | 9.00 m | 60 → 385 = **325 px** | **36.11** |
| down | 11.00 m | 127 → 523 = **396 px** | **36.00** |

**Agreement 99.7%.** On a centreline basis (321 px / 392.5 px) it is 99.97%.

That is corroborated rather than asserted. Taking 36.0 px/m and the left wall
centre at x = 62, the top chain's division points should fall at 2.00 m → x 134,
6.00 m → x 278, 9.00 m → x 386. The detected bands are `131-135`, `274-278`,
`381-385`. **All three land inside a detected wall.** The vertical chain checks
the same way: the row gaps measure 2.97 / 4.97 / 2.97 m against a stated
3.00 / 5.00 / 3.00.

**img1 is square, and its stated scale, its dimension chains and its geometry
all agree.** This is what a correct drawing looks like, and it is the first one
the corpus has held.

---

## 4. (c) img3 — two vertical figures, and which one I used

img3 states `31'-0"` across, and both `37'-0"` and `45'-3"` down. **They measure
different extents**, and the drawing tells you which: the plan is an L — a main
block with a **study room projecting below it on the right**.

Measured separately (left portion `x130-240`, right portion `x240-360`), the
main block's bottom wall is at y ≈ 343–349 and the study wing's at y ≈ 405–410.

| Reading | Stated | px | px/m |
|---|---|---|---|
| across | 31'-0" = 9.4488 m | 126 → 352 = 226 | **23.92** |
| down, **main block** | 37'-0" = 11.2776 m | 72 → 349 = 277 | **24.56** |
| down, **incl. study wing** | 45'-3" = 13.7922 m | 72 → 410 = 338 | **24.51** |

**The two vertical readings agree with each other to 0.2%.** That is the
evidence for the interpretation, not a guess about it: if `45'-3"` did not
include the wing, the two figures could not both land on ~24.5 px/m.

**I used the 37'-0" main-block reading** for the axis comparison, because it is
the one whose extent is bounded by walls on both ends and therefore measurable
the same way as the horizontal.

**Across vs down: 23.92 vs 24.56 — 2.6% apart.** Square within scan noise.

---

## 5. (d) img2 — a real photograph through four binarisations

| # | Candidate | ink | segments | ceiling (0.35) |
|---|---|---|---|---|
| 0 | `inkMask` | 0.097 | **31** | ok |
| 1 | `paperContrast` by distance | 0.076 | 10 | ok |
| 2 | `paperContrast` darker-than-paper | 0.076 | 10 | ok |
| 3 | `paperContrast` lighter-than-paper | 0.000 | 0 | ok |

**`inkMask` wins** — 31 segments, matching `detectWallSegments` exactly. The
plain Otsu reading beat both paper-contrast masks on a photographed print, which
is the case the paper-contrast masks were written for.

**Does the ink ceiling engage? No.** The highest candidate is 0.097, under a
0.35 ceiling by a factor of three. Across all four images in this batch the
maximum is 0.154 (img4). **Gate 4's ink ceiling has nothing to do on line work**
— it exists for colour-flooded and rendered sheets, and correctly stays silent
here.

**Does the junction ratio engage? No — 1.00 on all four, again.** A real scan
does not change it. **Finding 34 stands and is now measured across 11 images**
(7 marketing sheets, 4 line drawings) without the ratio ever once deciding an
outcome. The cause is structural, as recorded: `requireJunction` discards
non-junctioning bands upstream, so what reaches Gate 4 junctions by
construction.

**What the photograph actually does to the detector** is not visible in Gate 4
at all. It shows up in threshold sensitivity. Measuring img2's plan boundary at
three thresholds:

| threshold | across px | down px | implied px/m across | down | agreement |
|---|---|---|---|---|---|
| 120 | 327 | 312 | 32.4 | 33.3 | 97.3% |
| **140** | **341** | **313** | **33.8** | **33.4** | **98.9%** |
| 160 | 346 | 339 | 34.3 | 36.2 | 94.8% |

At 170 the left half of the sheet floods into a single 310 px band — the uneven
lighting swallows the drawing whole.

**The threshold choice moves the answer by ±5%, which is larger than the
drawing's own axis disagreement (1.1%).** For a photographed print the
measurement uncertainty exceeds the effect Gate 2b would be trying to detect.
That is a direct and inconvenient input to Part B.

Measured skew, against the CAD drawings as controls:

| | skew | rms |
|---|---|---|
| img1 (CAD) | 0.03° | 1.0 px |
| img4 (CAD) | 0.00° | 2.1 px |
| **img2 (photograph)** | **0.59°** | **2.5 px** |

0.59° over a 341 px width displaces one corner by 3.5 px — about 1%. **Skew is
not what makes img2 hard.** Uneven lighting is.

---

## 6. (e) Gate 3 — does a real CAD drawing show 2–3 thickness families?

**No. It shows five to ten.** Measured against each drawing's own derived px/m:

| Ref | px/m | walls | families | dominant | Gate 1b | Gate 3A | Gate 3B |
|---|---|---|---|---|---|---|---|
| img1 | 36.05 | 45 | **10** | 0.489 | **fail** | **fail** 23/45 under 75 mm | **fail** median 2.0 source px |
| img2 | 33.6 | 31 | **7** | 0.323 | **fail** | **fail** 1/31, thinnest 72 mm | **fail** 7 families |
| img3 | 24.2 | 35 | **8–9** | 0.371 | **fail** | **fail** 14/35 under 75 mm | **fail** median 2.1 source px |
| img4 | 35.14 | 64 | **5–6** | 0.438 | **fail** | **fail** 5/64, thinnest 50 mm | **fail** 6 families |

img1's thicknesses in mm: 41, 55, 82, 110, 137, 192, 247, 302, 329, 439, 453,
**1057**. A drawing whose walls are 115 mm and 230 mm.

**So 3B fires on every real CAD drawing in the corpus, and it is right to.** The
detector is measuring strokes, exactly as 3B's message says. But the reason is
not the drawings:

> At 24–36 px/m a 115 mm partition is **2.8 to 4.1 source pixels wide**. The
> line that draws it is 1–2. There is no measurement to be made at this
> resolution, and `MIN_RASTER_DIMENSION` upscaling the 474 px sheet to 1400
> (×2.0 to ×2.8) manufactures pixels without manufacturing detail — **finding
> 28, reproduced on good input**.

**This is therefore not evidence that 3B fires on good input.** It is evidence
that 3B fires on **thumbnails of good input**, which is a different and much
weaker claim, and the two must not be run together. The question the brief
asked — *does a real CAD drawing show 2–3 families?* — **remains unanswered**,
and cannot be answered until one arrives at native resolution.

Two smaller findings from the same measurements:

- **The family count is not stable.** img3 clusters into 8 families measured in
  raster px and 9 measured in metres; img4 into 5 and 6. `thicknessFamilies`
  splits on a relative ±7% gap, so rescaling should be a no-op — the flips are
  float rounding on pairs sitting exactly at the boundary. It changes no
  verdict here (4 is the ceiling and every count exceeds it), but a signal that
  moves when you change units is fragile, and it is fragile *because* stroke
  measurements pack the values so densely.
- **The fourth binarisation candidate has produced zero segments on every image
  ever measured** — batch 2 and batch 3, 11 images. It is the
  *lighter-than-paper* mask, and it is for `sheet-blueprint`: white lines on
  blue. **The corpus contains no blueprints.** Unexercised, not dead — but it
  has never once been tested against the case it exists for.

---

## 7. (f) The honest headline

**No. Not one of the four could produce a correct wall network today.**

Two refuse before anything is decoded — img3 and img4, at **Gate 1a**, because
they are 496 and 494 px. Two more refuse at **Gate 2**, for want of a scale that
img1 in fact states on its face.

And if every one of those refusals were lifted — if a scale were supplied and
the size floor waived — **all four would still fail, at Gate 1b, on
resolution**: 36.0, 33.6, 24.2 and 35.1 px/m against a 40 px/m floor. Then at
3A, and then at 3B.

**The binding constraint is not any gate. It is that all four files are 474 px
wide.** Every gate that fires is firing on that one fact, restated in its own
vocabulary. The drawings are right; img1 in particular is a clean, square,
self-consistent, scale-stated CAD plan and would very likely pass the entire
chain at native size.

**The corpus still holds zero usable drawings — and for the first time the
reason is fixable by one email rather than by a different contributor.**
