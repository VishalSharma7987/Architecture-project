# ADR 0006 — Wall faces pair with the nearest partner, not the first

**Status:** accepted · 2026-08-18 · B43
**Overrides a §3 clause — see "What this overrides". Follows ADR 0004/0005.**

## Context

B42 left three symptoms, which the B43 brief grouped as one shape — a wall
interrupted by an opening whose fragments each cover under half the wall:

- `shell-n` at 104 px/m, only the 24% right of its window;
- `shell-w` at 52 and 104 px/m;
- the "spurious" at 26 px/m, the second fragment of a door-split partition.

**The grouping was wrong, and measuring instead of accepting it is this
ADR's content.** `shell-w` has **no opening at all**, so openings cannot
explain it.

A bare outlined rectangle — four walls, no openings, no annotation — reads
perfectly at every position and margin tested. Adding one hairline parallel
to the west wall, at a varying distance outside its outer face:

| chain offset | west wall | what was reported instead |
|---|---|---|
| none | found, t=24 | — |
| 100 px | found, t=24 | — |
| 80 px | found, t=24 | — |
| **68 px** | **LOST** | a 70 px band at x=101, in open paper |
| **60 px** | **LOST** | a 62 px band at x=105 |
| **40 px** | **LOST** | a 42 px band at x=115 |

`maxThicknessPx` is 73.7 at this image size. Inside that ceiling the chain
**consumes the wall's outer face**: `mergeWallFaces` scans bands in centre
order and pairs each with the FIRST acceptable partner it meets. The chain
sorts earlier than the wall, reaches the wall's outer face first, and takes
it. The wall's own inner face is then left alone at 2 px and dropped by the
thickness floor. **The plan loses a whole wall and gains an impossible one.**

This also explains `shell-n` without reference to its window: the top
dimension chain pairs with the LEFT fragment of the north wall (594 px of a
936 px wall — a length ratio of 0.63, just over the 0.6 the pairing
requires) and consumes it. The RIGHT fragment is 229 px, a ratio of 0.24,
too short for the chain to accept — so it survives and is the only piece
reported. The opening decided *which* fragment was stolen, not *that* one
was.

**This is the third instance of one pattern**, which the brief asked to
watch for:

| | the step that consumed the input | the step that needed it |
|---|---|---|
| B41 | `minThicknessPx`, applied twice | `mergeWallFaces` |
| B42 | `mergeCollinear` absorbing a parallel pair | `mergeWallFaces` |
| **B43** | **an annotation band pairing first** | **the wall's own second face** |

It is also SD4(b) once more — `mergeWallFaces` fusing a partition with a
door's swing arc and reporting 0.64 m — the same greedy-first-partner defect
with a different neighbour.

## Decision

`mergeWallFaces` collects every acceptable pairing and takes them **nearest
span first**, instead of pairing each band with the first acceptable partner
in centre order.

Ties break on position (`span`, then `i`, then `j`) so two identical
drawings always pair identically (**L6**).

**Nothing about which pairings are ACCEPTABLE changed.** Every test —
the span ceiling, the pen-weight ratio, `FACE_OVERLAP_RATIO`,
`FACE_LENGTH_RATIO` — is the one that was already there, unmoved. Only the
choice among the pairs they admit is different, and it is a **narrowing**:
this cannot create a pair the previous code would have refused. That
distinction matters because the brief warned that widening `mergeCollinear`
was close to the defect B42 had just fixed; this widens nothing.

## What this overrides

**§3's protection of `detectWalls.ts`, on the "argued reason" clause.** The
argued reason is the offset table above — a measurement.

**§10 rule 9 is NOT overridden.** The `mergeWallFaces` → `typicalThickness`
ordering is untouched, and no pipeline stage moved. `mergeCollinear`,
`measure`, `findBands`, `keep`, `typicalThickness`, `snapJunctions`, the
four-way binarisation and `scoreSegments` are all unmodified. The change is
confined to how one function chooses among candidates it had already
accepted.

## Consequences — ⚠ SYNTHETIC (§10 rule 6)

| matched of 7 (spurious) | 104 px/m | 52 px/m | 26 px/m |
|---|---|---|---|
| solid, crisp and degraded | 7 (0) | 7 (0) | 7 (0) |
| outlined crisp, **B42** | 5 (1) | 6 (1) | 7 (1) |
| outlined crisp, **B43** | **7 (2)** | **7 (1)** | **7 (1)** |
| hatched crisp, **B43** | **7 (2)** | **7 (1)** | **7 (1)** |

**Every wall of every convention is now found at every legible resolution,
at its true footprint** (`thickness-ok` 7 in every cell), with `doubled` 0
throughout and solid unmoved.

**The leftover detections are not false walls.** Every one lands on a real
wall: they are the two pieces either side of an opening — `shell-n` at 62% +
24% of itself, `part-a` at 34% + 53%. The scorer counts a fragment covering
under half its wall as spurious, so a legitimately fragmented wall reads as
one match plus one spurious.

**A side effect worth recording:** B42 measured a 19 px band surviving on a
6 px-shell drawing when the floor was relaxed with no scale supplied, and
attributed it to the loose scale-blind ceiling. It is gone — not because the
ceiling moved, but because the chain now loses to the wall's own face
whatever the ceiling allows. B41's scale gate and B43's nearest-first rule
address the same hazard from two directions, and the second does not need
the first.

## Rejected alternative: change the scorer instead

The brief's option (b) — relax the 50% overlap rule so a wall found in two
correctly-positioned pieces scores as found rather than as one miss plus one
spurious. **Not done, deliberately.**

It remains a real and open question: two fragments totalling 86% of a wall
*are* a better reading of reality than "missed". But a scorer change
retroactively alters every number in every previous session's matrix, and
the honest order is to fix the instrument's subject before the instrument.
With B43 the detector no longer misses any wall, so the scorer question is
now purely about how to *describe* a fragmented wall rather than about
whether one was found — a much safer decision to take on its own, with the
whole matrix recomputed and the moved historical figures named.
