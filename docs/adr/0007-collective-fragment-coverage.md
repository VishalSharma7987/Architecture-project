# ADR 0007 — A wall reported in pieces is a wall that was found

**Status:** accepted · 2026-08-18 · B44
**Changes the MEANING OF THE BENCHMARK, not the product.** No detector code
was touched. Follows ADR 0004/0005/0006's form.

> ⚠ This validates the scoring rule against controlled fixtures. It does not
> establish detector performance on arbitrary real-world floor-plan images.

## Context

B43 left the detector finding every wall of every convention at every
legible resolution. What remained were "spurious" detections that were not
false walls at all: the two pieces of a wall interrupted by a door or a
window.

The old rule (`scoreWallGraphLegacy`) judged **every detection independently**
against a 50%-of-the-wall overlap test. Measured on a 1000 px wall:

| fragments | collective | old verdict |
|---|---|---|
| 45% + 45% | **90%** | **0 matched, 2 spurious** |
| 34% + 53% | 87% | 1 matched, 1 spurious |
| 20% + 20% | 40% | 0 matched, 2 spurious |
| one at 49% | 49% | 0 matched, 1 spurious |
| one at 50% | 50% | 1 matched |

The first row is the defect in one line: **ninety per cent of a wall,
correctly placed, nothing invented, scored as completely missed.**

## The rejection criterion, fixed before implementing

Because this changes the instrument that measured the previous four
sessions, the criterion was written down first:

> R1 40% collective must still score MISSED · R2 B43's chain-parallel
> artefact must contribute no coverage · R3 parallel neighbours never merged
> · R4 collinear walls with a gap never merged · R5 duplicates cannot
> double-count · R6 solid stays 7/7 · R7 annotation cannot cover a wall ·
> **R8 the PRE-B43 detector, under the NEW rule, must still score WORSE than
> the post-B43 one — a scorer that erases a real improvement is measuring
> nothing.**

All eight hold. R8's measurement is the strongest single piece of evidence
and is in the table below.

## Decision — option B, one-to-many with interval-union coverage

Each detection is assigned to **at most one** true wall (nearest centreline,
ties on overlap then id). Each wall's coverage is the **union** of its
assigned fragments' intervals, clipped to the wall. A wall is found when
coverage ≥ `COVERAGE_THRESHOLD` (0.8).

### Why not option A, grouping detections first

Grouping before matching must answer "do these two belong together?" from
detection geometry alone, which needs a **gap tolerance** — and that is
exactly the decision that can silently merge two real collinear walls.
Assigning to a true wall first asks an easier question, and one the scorer is
entitled to answer, because a scorer is the thing that knows the truth.

It also **eliminates the gap constant entirely**: the gap between fragments
is simply length nothing covers, so the coverage threshold accounts for it
with nothing to tune.

### Why not option C, lowering the 50% rule

It is per-segment, so it cannot distinguish "two pieces of one wall" from
"one bad short detection". Lowering it to 40% would make a single 40%
detection a correct wall. That is gameable and it makes the benchmark less
trustworthy, which is the opposite of this session's purpose.

### May the scorer use ground-truth opening positions?

It **may** — it is the scorer, and knowing the truth is its job. **It does
not**, and that is a deliberate advantage: a rule that depended on declared
openings could never be run against a real drawing, where no ground truth
exists. This rule is not fixture-only. Nothing replaces it when real images
arrive, because nothing needs to.

### The threshold, derived

An opening costs a wall ~13% of itself (the fixture's window is 1.2 m of a
9 m wall; its door 0.9 m of a 7 m wall). Real fragmented walls measure
86–87%. The hard negative is 40%. Anything in 0.45–0.85 separates them, and
the **top** of that band is chosen deliberately: a stricter threshold is the
safe direction for a scorer, because the failure it risks is calling a real
wall missed — visible and conservative — rather than calling a wrong reading
correct.

## The historical matrix — every figure that moves

Recomputed by checking out `detectWalls.ts` at each session's commit.
Format: `matched(spurious)`, old → new.

| session | variant | 104 px/m | 52 px/m | 26 px/m |
|---|---|---|---|---|
| B40 | solid | 7(0) → 7(0) | 7(0) → 7(0) | 7(0) → 7(0) |
| B40 | outlined | **5(1) → 4(0)** | 6(1) → **6(0)** | 0(0) → 0(0) |
| B41 | solid | 7(0) → 7(0) | 7(0) → 7(0) | 7(0) → 7(0) |
| B41 | outlined | **5(1) → 4(0)** | 6(1) → **6(0)** | 4(0) → 4(0) |
| B42 | solid | 7(0) → 7(0) | 7(0) → 7(0) | 7(0) → 7(0) |
| B42 | outlined | **5(1) → 4(0)** | 6(1) → **6(0)** | 7(1) → **7(0)** |
| B43 | solid | 7(0) → 7(0) | 7(0) → 7(0) | 7(0) → 7(0) |
| B43 | outlined | 7(2) → **7(0)** | 7(1) → **7(0)** | 7(1) → **7(0)** |

Exactly two kinds of movement, and no others:

1. **`spurious` falls to 0 in seven cells.** Every one was a legitimate
   fragment of a wall being counted as a false positive. **No detector
   behaviour changed — only what the benchmark calls it.**
2. **`matched` falls 5 → 4 at outlined/104 px/m for B40, B41 and B42.** The
   new rule is **stricter** there: `shell-n` was reported as a single
   fragment covering 62%, which cleared the old 50% test and does not clear
   the new 80% one. A wall two-thirds detected is not a found wall.

**`solid` does not move in any of its twelve cells** — the safety check.

That the new rule made three historical numbers **worse** is the clearest
available evidence that it is not merely permissive.

## A measured limitation, recorded rather than hidden

The rule counts coverage, not **coherence**. A wall "found" as twenty
disconnected slivers totalling 85% scores exactly as well as one found in two
clean pieces either side of a door. This was found by deliberately building a
harder negative after the rule passed every case on the first attempt.

It is **not guarded**, and the reason is itself a rule of this project: no
detector output has ever produced more than 2 fragments for one wall, so a
guard would be a constant invented against an imagined fixture — the very
failure §10 rule 6 names. Instead the observed fragment count is **pinned by
test**: if a detector change ever starts shattering walls, the pin moves and
the limitation becomes live and must be addressed then.

## Consequences

- `scoreWallGraphLegacy` is **kept and exported**. A benchmark whose old
  numbers cannot be reproduced is not auditable, and every figure in
  findings 60–63 was computed with it.
- `doubled` changes meaning: a wall in two pieces is fragmented, not
  doubled. Doubling now means genuinely overlapping duplicates.
- `thicknessOk` is stricter: **every** fragment must be the right thickness,
  where the old rule read `found[0]` and could not see a mixed pair.
- `spurious` now means what its name always claimed: a detection lying on no
  true wall.
