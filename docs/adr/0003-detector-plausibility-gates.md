# ADR 0003 — Detector plausibility gates (B5b)

**Status:** accepted · **Date:** 2026-08-12 · **Supersedes in part:** §3's protection of `detectWalls.ts`'s scoring

---

## Context

`samples/real-plan-cv-untitled.json` is a user's real saved project. It reported
**3 rooms and 176 sq ft on a 950 sq ft building**, and every wall in it came from
the detector. Measured:

| | |
|---|---|
| source raster | **400 × 300 px**, covering 11.03 m × 8.27 m — **36.3 source px/m** |
| calibration | `source: 'ai'`, `lockedByUser: false` — **never measured** |
| thicknesses | **10 distinct**, 23.6 – 275.8 mm, **19 of 30 under 90 mm** |
| in source pixels | 0.86 – 10.0 px; ten walls **sub-pixel** |
| topology | 60 nodes, 32 of degree 1 → `pruneDangles` removes 38 in 4 passes → **66% of the graph destroyed** |

### The root cause

```
raster.ts:113   400 px → upscale ×3.5 → 1400 px   (nearest-neighbour; no new information)
detectWalls     sizedDefaults(k = 1400/2000 = 0.7)
                minThicknessPx = max(2, 3 × 0.7) = 2.10 upscaled px = 0.60 SOURCE px
```

`MIN_RASTER_DIMENSION` manufactures pixels; `sizedDefaults` then sizes its
thresholds against the manufactured dimension. **The two mechanisms that exist
to make small drawings work are what let sub-pixel noise through.**

This is the second measured argument for changing the detector. The first is
ADR 0002's: `scoreSegments` preferring **75 imaginary walls totalling 77,592 px**
to **7 real ones totalling 6,300 px**, because it ranks a candidate by total
detected length alone.

---

## Decision

Four gates, in a new pure module `src/blueprint/plausibility.ts`.

### Gate 1 — resolution, measured in SOURCE pixels

Split in two so the scale-free half can run first:

- **1a raster size** — refuse below **600 px** on the longest *source* edge. A
  building is 8–20 m across; at the resolution floor below that needs 320–800 px
  for the building alone. Runs before `MIN_RASTER_DIMENSION`, because upscaling
  to satisfy a downstream threshold is the defect rather than the remedy.
- **1b resolution** — refuse below **40 source px/m**, warn to **80**.

**Derivation.** A drawn line's width in pixels is a property of the pen and is
roughly constant across renderings — 1–3 px. A wall body's width scales with
resolution. They separate only when the body is several times the pen. With a
bold pen at 3 px and a 2× margin, and the thinnest wall that must survive taken
as the **115 mm half-brick partition** (universal in Indian residential work):

```
115 mm ≥ 6 px  ⟹  52 px/m      (refuse below — rounded to 40)
115 mm ≥ 9 px  ⟹  78 px/m      (trust above — rounded to 80)
```

The detector's own defaults were tuned at **100 px/m**, putting a 115 mm wall at
11.5 px — the known-good point, corroborating the derivation from the other end.

**The warn band is not decoration.** A cliff at exactly 40 refuses someone at 39
and accepts someone at 41 with no perceptible difference. Between the two, shell
walls are measurable and thin partitions are not, which a user can act on.

**Source pixels, never raster pixels.** This file reads **126.9 px/m** at raster
scale — better than the 100 px/m the defaults were tuned at — and **36.3** at
source. A gate that measures the raster passes the document it exists to reject.

`sizedDefaults` additionally gains a **source-pixel floor**, so no threshold can
resolve below one pixel of the original image.

### Gate 2 — scale provenance: **refuse now, review later**

Refuse to build walls unless the calibration is a measurement — `manual`,
`dxf-units`, `vector` or `ocr`. `ai` and `none` are refused.

§8 ranks `ai` lowest and says its result is always *"estimated"*, never
*"calibrated"*. The decisive property is irreversibility: **detected coordinates
become permanent geometry, and nothing rescales existing walls.** An estimate on
screen is reversible; an estimate baked into 30 walls is not.

**L1 does not forbid the alternative.** The amended wording permits model-derived
numbers through *"a ranked, labelled, user-overridable channel that no automated
process can escalate"*, and `CalibrationService` is exactly that. Arguing L1 here
would be citing the text this project already struck. The argument is §8's frozen
scale, not L1.

**Rejected — proceed and mark the reconstruction low-confidence.** It labels 30
walls whose geometry the user cannot act on; their only remedy is to delete all
30 and start again. A warning you cannot act on is an alibi, not a safeguard.

> ### The recorded target: hold the reconstruction outside the document
>
> The right answer is neither refusing nor committing: detection produces a
> **proposal held outside `walls`** until the scale is measured. The user sees
> the preview immediately — not blocked — and no estimate is baked in.
>
> **This ADR ships refusal as an INTERIM, not as the final answer.** The target
> requires the review gate (Engine 4), which does not exist. Refusal is cheap
> today because `buildWallsFromBlueprint` already fails closed and
> `StructurePhase` already carries a reason to the status line.
>
> **Do not mistake the interim for the decision.** Manual calibration is rank 1
> and costs two picks plus a typed length, so for a dimensioned drawing this is
> a redirect. For an undimensioned image whose real size the user does not know,
> it is a genuine block — and in that case every number the reconstruction would
> produce is meaningless anyway, which is the trade being made.

### Gate 3 — thickness, in two independent checks

- **3A per-wall minimum** — reject below **75 mm**, warn to 100 mm. 75 mm is the
  thinnest partition actually built in the target market. `LIMITS.wallThickness.min`
  (20 mm) is a modelling clamp and is deliberately not reused.

  **The loophole is closed by SOURCE, not by type.** A user may hand-draw a 50 mm
  glazed screen; the detector may not claim to have *measured* one at 36 px/m.
  Gating on `provenance.source` keeps it un-gameable and needs no new field.

- **3B distribution shape** — three signals: **median thickness in source pixels
  ≥ 3**, **families ≤ 4**, **dominant family share ≥ 40%**. The first is the
  strongest, because it is scale-free, upscale-proof, and it reads what the
  detector produced rather than a proxy for it.

**They are independent in both directions.** 3B fires with 3A passing on
180/185/190/195/200/205 mm — no implausible wall, but noise rather than families.
3A fires with 3B passing on 29 good walls and one 20 mm artefact.

### Gate 4 — scorer sanity, in front of the length ranking

- **ink-fraction ceiling at 35%.** ADR 0002's failing mask marked **87–95%**.
- **junction ratio ≥ 50%**, applied once there are ≥ 4 segments.

**Why junction ratio and not segment count or mean length.** ADR 0002's numbers
rule both out: the 75 imaginary segments averaged **1,035 px** against the 7 real
ones at **900 px** — *the fakes were longer*. What separates them is that real
walls form a connected network and strips sliced out of a white field by a grid
do not. `hasJunction` already exists; this uses it **before** the score instead
of after, which is new information from code that is already there.

---

## What this overrides, and what it does not

**Overrides:** §3's protection of `detectWalls.ts`'s scoring. §3 requires *a
specific argued reason* and *extension over replacement*. Both argued reasons now
exist — ADR 0002's measurement and this fixture — and STATE.md open question 1
already records that §3's own justification for protecting the score was
withdrawn as measurably false.

**Untouched, deliberately:**

- the **four-way binarisation structure** — `candidateMasks` still produces the
  same candidates;
- **`scoreSegments` itself** — still total detected length, still the ranking
  among candidates that pass;
- the **`mergeWallFaces` → `typicalThickness` ordering** (§10 rule 9).

The gate decides who enters the comparison. The existing score still decides who
wins it.

---

## Consequences

- A user with a small or uncalibrated image is **refused rather than given bad
  walls**, and told which measurement failed and what to do.
- The auto-build path into 3D fails closed. **Never auto-create a bad 2D model so
  that something appears in 3D.**
- Thresholds are derived from architectural facts and the detector's own tuning
  point, **not fitted to this fixture** — but they are **unvalidated**, and no
  accuracy claim rests on them until the corpus exists (§10 rule 6).
- **No confidence score.** Every gate is pass/warn/fail. Two outputs are bounded
  0–1 (junction ratio, dominant share) but both describe *the reading*, while
  `Provenance.confidence` is *per element* — writing a document-level number onto
  each wall would assert something never measured, the error C1 corrected.
  `confidence` stays absent, and now means it more precisely: **the gates
  assessed the reading, not the wall.**

## Rejected alternatives

| | Why not |
|---|---|
| Widen the weld tolerance to close the gaps | Session 2 measured this. The misses are 100–952 mm; a tolerance that wide fuses legally distinct walls and merges real rooms silently. |
| Repair the topology downstream | Session 3B measured it on this file: 3 rooms before, 3 after. 20 of 60 endpoints are beyond any safe tolerance. |
| Replace `scoreSegments` | §3, and it is not the defect. The score is a reasonable tiebreak among *credible* candidates; it was being asked to judge credibility. |
| Lower `MIN_RASTER_DIMENSION` | Upscaling is not the problem — sizing thresholds against upscaled pixels is. Small images still need upscaling for the band walk to work. |
