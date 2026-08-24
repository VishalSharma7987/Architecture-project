# ADR 0005 — Collinear means end-to-end, not side-by-side

**Status:** accepted · 2026-08-18 · B42
**Overrides a §3 clause — see "What this overrides". Follows ADR 0004's form.**

## Context

B41 left one defect: three outlined partitions at 26 px/m were lost because
the fused band reported **2 px** where the drawing occupies **3 px**, and
`thicknessFloorRatio` then dropped them (0.4 × the 6 px shell is 2.4).
B41 attributed the under-measure to `mergeWallFaces` and recorded it as
B42's subject.

**That attribution was wrong, and measuring it rather than trusting it is
the whole content of this ADR.**

A controlled probe — two parallel faces of known stroke, drawn at a known
separation, footprint known by construction — reports:

| stroke | gap | footprint | reported (pre-B42) |
|---|---|---|---|
| 1 | 1 | 3 | **2** ← the only wrong cell |
| 1 | 2 | 4 | 4 |
| 1 | 3…10 | 5…12 | exact |
| 2 | 1…8 | 5…12 | exact |

`mergeWallFaces`' span arithmetic is `max(vMax) − min(vMin) + 1`, which is
correct, and every case it handles comes back exact. **The minimal pair
never reaches it.**

`mergeCollinear` runs first, and its centre test is

```js
if (Math.abs(a.centre - b.centre) > Math.max(2, thin / 2)) continue
```

Two 1 px faces with a 1 px gap have centres exactly **2** apart, and `2 > 2`
is false — so they are not skipped. They are unioned as one band, `measure`
re-measures the union, and it reports the **ink count down each column**
(2 px of ink) rather than the **3 px span** the wall occupies. The centre it
reports, 60.5, is the giveaway: it is the true centre of a 3-row footprint
carrying a 2-row measurement.

The deeper point: `mergeCollinear` exists to rejoin **one line broken along
its length** — a wall interrupted by a door. It had no test that the two
bands are actually end-to-end, so two bands running side by side for their
entire length were eligible to be "rejoined". Its gap term,
`max(bMin − aMax, aMin − bMax) − 1`, is hugely negative for a fully
overlapping pair, which passes its ceiling rather than failing it.

**This is the same shape of defect as B41's**: a step earlier in the
pipeline consumes the case before the step designed for it can act. B41 was
the thickness floor; B42 is `mergeCollinear`.

## Decision

`mergeCollinear` gains one guard: two bands overlapping along the wall by
more than `FACE_OVERLAP_RATIO` of the shorter are **not** collinear
fragments, and are left for `mergeWallFaces`.

```js
const shared = Math.min(a.uMax, b.uMax) - Math.max(a.uMin, b.uMin) + 1
if (shared > Math.min(aLength, bLength) * FACE_OVERLAP_RATIO) continue
```

`FACE_OVERLAP_RATIO` is reused rather than a new constant introduced: it
already encodes "these two bands run together" for `mergeWallFaces`, and
this is the same question asked with the opposite intent.

## What this overrides

**§3's protection of `detectWalls.ts`, on the "argued reason" clause.** The
argued reason is the probe table above — a measurement, not an opinion.

**§10 rule 9 is NOT overridden.** The `mergeWallFaces` → `typicalThickness`
ordering is untouched. Nothing was reordered and the pairing was not
rewritten: `mergeWallFaces`, `measure`, `findBands`, `keep`,
`typicalThickness`, `snapJunctions`, the four-way binarisation and
`scoreSegments` are all unmodified. One `continue` was added to a different
function, and it makes `mergeCollinear` do what its own name and doc comment
already claim.

## Consequences — ⚠ SYNTHETIC (§10 rule 6)

| | 104 px/m | 52 px/m | 26 px/m |
|---|---|---|---|
| solid, crisp and degraded | 7/7 (0) | 7/7 (0) | 7/7 (0) |
| outlined crisp, **B41** | 5/7 (1) | 6/7 (1) | 4/7 (0) |
| outlined crisp, **B42** | 5/7 (1) | 6/7 (1) | **7/7 (1), thickness-ok 7** |

- **Outlined at 26 px/m is now read completely**, at true footprints, with
  centrelines within 0.5 px. Hatched matches it.
- **Solid does not move in any cell**, and never could: solid walls produce
  one band per wall, which `mergeCollinear` only ever joins end-to-end.
- The remaining "spurious" detection at 26 px/m is **not a false wall** — it
  is the second fragment of the door-split partition, which the scorer
  counts as spurious because it covers under half its wall.

**The brief's hypothesis that solid footprints were also off by one, merely
masked by a generous floor, is REFUTED by measurement**: nine thicknesses
from 2 px to 40 px all report exactly what was drawn. That negative is
pinned by test so the solid path cannot drift silently.

**Still failing, unchanged and pre-existing:** `shell-w` at 52 and 104 px/m,
and `shell-n` found only right of its window at 104 px/m. At those
resolutions the faces are 2 px — **at** `minThicknessPx`, not below it — so
they take the ordinary solid path and neither B41's nor B42's change is
involved. That is a separate defect at a separate resolution and wants its
own measured session.
