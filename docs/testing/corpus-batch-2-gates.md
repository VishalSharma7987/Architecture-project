# Batch 2 through the gates

What the B5b gates did with the seven files in [corpus-manifest.md](corpus-manifest.md), plus two
measurements taken to answer questions the gates themselves cannot answer
because they refuse too early.

Machine-readable rows: [corpus-baseline-2.csv](corpus-baseline-2.csv) (9 rows — the 7 new files plus the
2 carried over). **No threshold was changed to produce any number here, and
none may be changed because of them.** These are seven marketing sheets; tuning
against them would tune the detector away from the drawings it exists to read.

---

## 1. What the harness says

| File | 1a size | 2 scale | 1b res | 3A min | 3B dist | First refusal |
|---|---|---|---|---|---|---|
| `Media (3)` | pass | **fail** | not-reached | not-reached | not-reached | `scale-provenance` |
| `Media (4)` | pass | **fail** | not-reached | not-reached | not-reached | `scale-provenance` |
| `Media (5)` | pass | **fail** | not-reached | not-reached | not-reached | `scale-provenance` |
| `Media (6)` | pass | **fail** | not-reached | not-reached | not-reached | `scale-provenance` |
| `Media (7)` | pass | **fail** | not-reached | not-reached | not-reached | `scale-provenance` |
| `Media (8)` | pass | **fail** | not-reached | not-reached | not-reached | `scale-provenance` |
| `Media (9)` | pass | **fail** | not-reached | not-reached | not-reached | `scale-provenance` |
| `first-floor-557px.png` | **fail** | fail | not-reached | not-reached | not-reached | `raster-size` |
| `51f2f7db…webp` | **fail** | fail | not-reached | not-reached | not-reached | `raster-size` |

**Do any pass Gate 1a (≥ 600 source px)?** All seven, comfortably. Longest edges
are 1024–1600 px, against a floor of 600. Gate 1a is aimed at the 400 px raster
in row 9 and the 557 px one in row 8 — and it still catches exactly those two
and nothing else. It has now been shown to discriminate rather than merely to
refuse.

**What does Gate 2 do?** Refuses all seven, as predicted, with:

> This drawing has no scale yet. Measure a known length on it first — walls
> built now would be the wrong size permanently.

Two things worth stating plainly about that:

The refusal is **correct and useful**. Six of the seven carry an overall
dimension in the image (`16'×45'`, `17'×53'`, `17'-6"`, `17.5 ft × 20 ft`,
`17'-5"×20'`) — so a user *could* satisfy Gate 2 in one measurement, which is
precisely the interaction Gate 2 is asking for. The gate is not a wall; it is a
prompt with teeth.

The refusal is also **doing no discriminating work here**. It fires on all seven
identically, which means the batch tells us nothing about whether Gate 2's
threshold is right. A gate that refuses everything is indistinguishable from a
gate that refuses nothing, as evidence.

**Everything after Gate 2 is `not-reached`, not `pass`.** The harness says so in
the CSV rather than leaving a blank, which is why the two measurements below had
to be taken separately.

---

## 2. Gate 4 — measured, wired against unwired

Gate 4 is scale-free: it reads the mask and the segments in pixels. So it can be
measured without inventing a calibration, which is what `npm run corpus:probe`
does. To tell "Gate 4 refused this" apart from "the existing filters found
nothing", the same seven images were measured twice — once against `main`, once
against a build with B5c's candidate ranking reverted to a bare total-length
sort. The revert was a measurement, not a change; it was restored immediately.

Both runs are on **PNG transcodes** of the JPEGs, since the headless path has
only a PNG decoder. `primaryInk` is the ink fraction of the primary mask.

| File | primaryInk | segs **unwired** | segs **wired** | junc | families | dominant |
|---|---|---|---|---|---|---|
| `Media (3)` | 0.203 | 34 | 34 | 1.00 | 3 | 0.765 |
| `Media (4)` | 0.151 | 46 | 46 | 1.00 | 5 | 0.478 |
| `Media (5)` | 0.225 | 42 | 42 | 1.00 | 6 | 0.738 |
| `Media (6)` | 0.262 | 36 | 36 | 1.00 | 4 | 0.528 |
| `Media (7)` | **0.397** | **20** | **0** | — | — | — |
| `Media (8)` | **0.393** | 15 | 15 | 1.00 | 7 | 0.333 |
| `Media (9)` | 0.295 | 56 | 56 | 1.00 | 6 | 0.696 |

### Does the ink-fraction ceiling refuse a coloured render?

**Once out of seven, and it is the right one.**

`Media (7)` — a 3D isometric render — is the only row that changes: 20 segments
unwired, **0 wired**. Its primary mask calls 39.7% of the sheet ink, over the
0.35 ceiling, so `maskIsCredible` rejects it; no other candidate survives
either, and the detector returns nothing. Twenty plausible-looking "walls"
extracted from a perspective render are exactly the output B5c exists to
suppress, and it suppressed them.

`Media (8)` is the honest complication. It is the **same artefact class** as
`Media (7)`, its primary mask is over the ceiling too (0.393), and yet it still
returns 15 segments — because a *different* candidate mask, below the ceiling,
won instead. That is Gate 4 working as designed at the candidate level rather
than failing at the image level: the over-inked reading was rejected, and a
less-inked one was preferred. But the result is that **the ink ceiling does not
reliably refuse 3D renders — it refused one of the two.** Anyone reading row 5
as "Gate 4 catches renders" should read row 6 next.

### Does the junction ratio refuse anything?

**No. It is 1.00 on every image that produced any segments at all.**

This is not luck and it is not a threshold being too loose. `requireJunction`
already discards non-junctioning bands upstream, and its escape hatch only opens
when *nothing* junctions. So by the time segments reach Gate 4, they junction
essentially by construction, and the ratio is pinned at 1.

**The junction ratio's only demonstrated catch remains the synthetic parallel-strips
fixture from B5c.** On seven real sheets it has never once been the deciding
signal. That does not make it wrong — the strips case is real and it catches it —
but it does mean the ink fraction is carrying Gate 4 alone in practice, and the
junction ratio should not be described as validated. **Recorded as STATE.md finding 34.**

---

## 3. `Media (9)` cropped — would the plan panel pass all four gates?

**Report only. No crop tool was built, and none is proposed here.**

The sheet's top-left panel was cut out with `ffmpeg` (830 × 800 from the origin)
purely to measure it. The change is dramatic:

| | whole sheet | plan panel only |
|---|---|---|
| primary ink fraction | 0.295 | **0.082** |
| segments | 56 | 10 |
| thickness families | 6 | **1** |
| dominant share | 0.696 | **1.00** |
| distinct thicknesses (raster px) | 22 values, 4–79 | **13, 14, 15, 16** |

Four numbers that were noise became four numbers that describe a building. One
wall type at 100% share, and a thickness spread of 13–16 px, is what a real
drawing looks like to these gates. The 62% of the sheet that is photographs was
producing five spurious thickness families on its own.

**The answer to "would it pass all four gates", gate by gate:**

| Gate | Verdict | Why |
|---|---|---|
| 1a raster size | **pass** | 830 px longest edge, against 600. |
| 2 scale provenance | **pass**, given the premise | The question says "and calibrated". The sheet carries `17'-5"` and `20'` dimension lines, so a user could supply this in one measurement. |
| 1b resolution | **pass** | ≈131 source px/m, against a trust floor of 80. |
| 3B distribution | **pass** | 1 family, dominant share 1.00. |
| 4 mask credibility | **pass** | ink 0.082, well under 0.35. |
| **3A thickness minimum** | **FAIL** | All 10 walls measure **59–72 mm**, under the 75 mm floor: *"10 of 10 walls came out under 75 mm — the thinnest is 59 mm. Nothing is built that thin, so those are lines on the drawing rather than walls."* |

**So: no. It passes five gates and fails Gate 3A.**

### Why 3A fails, and why I do not trust my own number

The scale above is **derived, not measured**, and it is derived unsoundly. I
took the detected wall bounding box and divided by the sheet's stated `17'-5" ×
20'`. Those two divisions disagree:

- from the width: 697.8 source px ÷ 5.309 m = **131.4 px/m**
- from the height: 688.6 source px ÷ 6.096 m = **113.0 px/m**

**They agree to only 85.9%.** The stated plot is 0.871 as wide as it is tall;
the drawn plan is 1.013. The drawing has been **stretched to fill its panel and
is not to a single scale** — a fact that no amount of careful calibration by a
user would fix, because there is no correct answer to give the calibration
dialogue.

That 15% uncertainty straddles the gate. At 131 px/m the walls are 59–72 mm and
3A fails hard. At 113 px/m they are 68–84 mm and 3A is a partial fail with some
walls over the 75 mm line. **I cannot say which, and the honest report is that
Gate 3A's verdict on this panel depends on a scale the drawing does not
consistently define.**

Two findings fall out of that, and both are more useful than the pass/fail:

1. **The gate that would refuse the best drawing in the corpus is 3A, on a
   scale-dependent judgement** — while Gate 2, whose entire job is scale, has
   already passed by then because *a* scale was supplied. Gate 2 checks scale
   *provenance*, not scale *consistency*. A drawing can have an impeccably
   measured calibration and still not be to scale. **Recorded as STATE.md finding 35.**
2. **Whether the 59–72 mm reading is the drawing's fault or the detector's is
   not established.** The panel's wall poché looks like ordinary 115 mm brick.
   If the walls really are drawn thin relative to their stated dimensions, 3A is
   right to refuse. If the detector is under-measuring the band, 3A is refusing
   a good drawing for a bad reason. **Distinguishing these needs a hand trace,
   which needs ground truth, which the corpus does not yet have.** It is not
   resolved here and must not be assumed either way.

---

## 4. What this batch did and did not establish

**Established:**

- Gate 1a discriminates: it refuses the 400 px and 557 px rasters and passes all
  seven 1024–1600 px ones.
- Gate 4's ink ceiling refuses a real 3D render (`Media (7)`, 20 segments → 0)
  and is the first gate in this project shown to change an outcome on a real
  image.
- Cropping to the plan panel collapses 6 thickness families to 1 and the ink
  fraction from 0.295 to 0.082. **Sheet composition, not wall rendering, is the
  dominant source of implausibility in this batch.**
- The harness's headless raster path was broken (`document is not defined`) and
  had never executed, because nothing had previously cleared Gate 1a. Fixed this
  session.

**Not established, and not to be claimed:**

- **Nothing about detector accuracy.** No wall was compared to a ground truth,
  because there is no ground truth. Every number here is about the *gates*.
- **Nothing about whether any threshold is correctly placed.** Gate 2 refused
  7/7 identically, which is no evidence at all. Gate 3A's one data point is
  built on a scale that disagrees with itself by 15%.
- **Nothing about the junction ratio**, which was 1.00 everywhere and decided
  nothing.
- **Nothing about the real target population.** Zero delivered working drawings
  were received. These are marketing sheets, and a detector tuned to read them
  would be a detector tuned to read the wrong thing.
