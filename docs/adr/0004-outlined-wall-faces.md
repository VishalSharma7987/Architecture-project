# ADR 0004 — Outlined wall faces reach `mergeWallFaces`

**Status:** accepted · 2026-08-18 · B41
**Supersedes nothing. Overrides a §3 clause — see "What this overrides".**

## Context

`detectWalls.ts` is protected by §3 ("Rewriting any of the following without
a specific, argued reason is a regression… extend rather than replace") and
by §10 rule 9, which pins the `mergeWallFaces` → `typicalThickness`
ordering. ADR 0003 is the precedent for recording what a change to it
overrides, and on what measurement.

B40 measured the failure this ADR responds to. Rendered with **outlined**
walls — two thin parallel faces rather than a solid poché band, the
convention half the reference drawings use (finding 23) — the same plan that
reads 7 of 7 solid at 26 px/m detects as **zero segments**. Not poorly:
nothing at all, on a drawing a human reads instantly.

The mechanism, measured rather than reasoned:

- `minThicknessPx` floors at 2 px (`Math.max(2, sourceFloor, 3 * k)`)
  however small the drawing is;
- an outlined wall at 26 px/m has **1 px faces**;
- that floor was applied **twice** — once inline on `findBands`' output and
  again inside `keep` — and **both before `mergeWallFaces`**, the function
  whose entire purpose is to pair those two faces into one wall.

So the case `mergeWallFaces` exists for could never reach it. B40 confirmed
the pairing itself is sound: at 104 px/m it fuses correctly, `doubled` is 0
at every scale, and fused walls report their true footprint.

Two remedies were measured and rejected before this one:

| Rejected | Why |
|---|---|
| Lower `minThicknessPx` | B40 measured it: unpaired 1 px faces survive alongside bands over 12 px on a 6 px shell. It admits noise, it does not read walls. |
| Rely on blur closing the gap | B40 measured it too: degradation takes outlined from 0 to 7/7 — with 4–6 spurious detections and half the thicknesses wrong. That is the detector succeeding for the wrong reason, twice noted in this project. |
| A stroke-width family split (B39's `annotationInk`) | Structurally impossible here: outlined faces sit in the SAME 1–2 px family as the annotation (finding 60). Retired for this case. |

## Decision

Thin bands are admitted as **pairing candidates only**, and must earn their
place by pairing.

1. Bands below `minThicknessPx` are collected separately from the solid
   ones, filtered by `keepAsFaceCandidate` — every test `keep` makes except
   the thickness floor, with `minAspect` measured against the floor rather
   than against a hairline's own width.
2. They are paired **among themselves**, by `mergeWallFaces`, unchanged.
3. The deferred floor is then applied to the fused result. A pair reports
   the wall's FOOTPRINT and clears the floor on the same number a solid wall
   would; a face that found no partner still reports its own 1 px and is
   dropped exactly as before.
4. The pairing ceiling for thin candidates is **`MAX_WALL_METRES` (0.5 m)
   converted through the drawing's scale**, not `maxThicknessPx`.

**Without a scale the whole path is OFF and detection is byte-identical to
before.** `DetectOptions.metresPerPixel` is optional; absent, no thin band is
ever collected.

## Why the scale is load-bearing, and why it is optional

A 1 px dimension chain and a 1 px wall face are indistinguishable by width,
and pairing alone cannot separate them — measured: with `maxThicknessPx` as
the ceiling, the chain paired with the shell's outer face 19 px away and was
reported as a **19 px wall on a drawing whose shell is 6 px**. Only a
plausible SEPARATION can reject that, and a plausible separation is a
real-world quantity. This is exactly the path B39 named when its own
width-based filter failed.

It is optional because guessing is worse than declining. Without a scale
there is no way to tell a 19 px gap from a wall, so the feature does not
engage and the caller is left exactly where B40 found them. B38's
`metresPerPixel` supplies it, and Gate 2 independently refuses to build
walls from an unmeasured scale — so the app's committing path always has one.

## What this overrides

**§3's protection of `detectWalls.ts`, on the "argued reason" clause.** The
argued reason is B40's matrix, reproduced in finding 60, and it is a
measurement rather than an opinion.

**§10 rule 9 is NOT overridden and is preserved by construction.** The
`mergeWallFaces` → `typicalThickness` ordering is untouched: the thin-face
pairing happens strictly before the existing `mergeWallFaces(rough, …)`
call, which still runs before `typicalThickness`. The four-way binarisation,
`scoreSegments`, `inkMask`, `paperContrastMasks`, `findBands`,
`mergeCollinear`, `mergeWallFaces` and `snapJunctions` are all unmodified.
What changed is which bands are handed to a step that already existed.

## Consequences — ⚠ SYNTHETIC (§10 rule 6)

Measured on B40's fixture. No corpus number exists to compare against; the
corpus still holds zero usable drawings.

| | 104 px/m | 52 px/m | 26 px/m |
|---|---|---|---|
| solid, crisp and degraded | 7/7, 0 spurious | 7/7, 0 | 7/7, 0 |
| outlined crisp, **before** | 5/7 (+1) | 6/7 (+1) | **0/7** |
| outlined crisp, **after** | 5/7 (+1) | 6/7 (+1) | **4/7, 0 spurious** |

- **Solid does not move in any cell.** Asserted as the full matrix row.
- Detections now sit on **centrelines**: offset 0.0 px on every matched wall
  at both resolutions, closing B40's face-riding observation. A fused pair
  spans both faces, so its centre is the wall's centre by construction.
- 104 and 52 px/m are unchanged because their 2 px faces are **at** the
  floor, not below it — they never enter the new path. The change helps
  exactly where B40 measured the failure and nowhere else.

**Still failing, and located precisely:** the three outlined partitions at
26 px/m. Their faces pair, but the fused band reports **2 px** where the
drawn footprint is **3 px**, and `thicknessFloorRatio` then drops them
(0.4 × the 6 px shell is 2.4). At the true 3 they would survive, so the
floor is correct and the one-pixel under-measure inside `mergeWallFaces` is
the whole defect. Fixing it means changing that function's internals, which
wants its own argued session.

## Rejected alternative: adopt a CV library

Declined again on B39's seven questions. The bundle cost is real (OpenCV.js
is ~8–10 MB against a 1.56 MB bundle) and, decisively, **the defect was an
ordering error in code we already own** — no library would have been
consulted about which of our own bands reach our own pairing step.
