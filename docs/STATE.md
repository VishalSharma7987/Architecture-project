# Project State

Updated: 2026-08-10 · Commit: `c24c432`

This file records **where we are and what is still undecided**. The ADRs in
[`docs/adr/`](adr/) record **why decisions were made**. Neither replaces the other:
the carried decisions below are the class of knowledge that lives in neither the
code nor the commit messages, and losing them once already cost a session.

**Start every session with:** read this file and `docs/adr/`, then verify the gate
before doing anything.
**End every session with:** update this file to reflect the session, and commit it
with the work.

---

## Where we are

| | |
|---|---|
| Stage | **Stage 1** — not fully exited (see Blockers) |
| Last completed task | **B13** (adversarial review) **+ its blocking remediation** |
| Next task | **B7 (+ B8 folded in)** |
| Upcoming | B9 → B10 → B11 → B12 |

Two deliberate departures from the master prompt's task order:

- **B13 ran before B7.** The store contract, the schema and the persistence layer
  all changed in Stage 0/1. An adversarial pass against the current state was
  worth more than one against a state already left behind.
- **B8 is folded into B7.** B8's deliverable is a single shared memoisation point
  replacing six `useMemo`s. All six call `resolveRooms`, which B7 rewrites. Done
  separately, the memoisation work happens twice.

Revised order: **B13 → B7 (+B8) → B9 → B10 → B11 → B12.**

---

## Gate

Verified at `c24c432` on 2026-08-10:

| Check | Result |
|---|---|
| `npm test` | **258 passing / 258** · 15 files / 15 |
| `npm run build` | **pass** (exit 0) |
| `npx tsc -b` | **clean** (exit 0) |
| `npm run lint` | **0 errors** (exit 0), 5 warnings |
| `strict` | **`true`** — [`tsconfig.app.json:25`](../tsconfig.app.json#L25) |
| Key boundary | **intact** — no `ANTHROPIC` / `OPENROUTER` / `sk-ant-` / `sk-or-` in `dist/` |

The 5 lint warnings are genuine advisories, not suppressions: 3 ×
`react/no-array-index-key`, 2 × `eslint/no-shadow`.

CI runs all four checks on every push and pull request —
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

Known test-log noise: jsdom prints `Not implemented: navigation to another
Document` when the error-boundary suite clicks through to `location.reload`. The
assertion runs before it. Not a failure.

---

## Shipped

**Stage 0 and Stage 1** — `3ba61fc` (+ `1bf5cec`, a build fix):

| Task | What shipped | Tests |
|---|---|---|
| **B0** | Triage: build succeeded · `strict` was off · staged work = 4 coherent features + 3 required assets + 11 junk binaries | — |
| **B1** | AI edit no longer destroys furniture / rooms / stairs / plot / north / rate / floors; both AI flows undoable | 8 |
| **B2** | Build-time AI availability detection; honest degradation; `AbortController` timeouts; key boundary as a fitness function | 9 |
| **B3** | `CalibrationService` authority ladder; schema v2 + migration runner; blueprint persisted and undoable | 43 |
| **B4** | Autosave watches the whole document; quota failures surfaced; two-step confirmations; cross-tab detection | 19 |
| **B5** | Vitest harness; golden file wired; pure-module coverage; corpus taxonomy specified | 122 |
| **B6** | `strict: true`; lint 2 rules → 3 categories; README's 10 contradictions corrected | — |

**Infrastructure** — `afb49d9`: GitHub Actions CI, and this file.

**B13 and its remediation** — five commits, review findings F1–F5 / M1–M3:

| Finding | Commit | What changed | Tests |
|---|---|---|---|
| **F1 + F2** | `20845d9` | Projects stored one key each, with a rebuildable index and a migration off the legacy blob | +20 |
| **F4** | `853b9eb` | App-level `ErrorBoundary` with export/discard recovery, plus a boot guard that breaks the crash-reload loop | +15 |
| **F3** | `84ca16c` | History forgets blueprint pixels, so undo can no longer hand back a revoked object URL | +10 |
| **M1** | `b5c71a0` | The checked-out floor invariant enforced by a fitness test instead of a comment | +5 |
| **M3** | `c24c432` | Undo engine extracted from module scope into `createHistory(...)` | +7 |

**Still open from B13: F5 and M2.** F5 (`resolveRooms` is O(n²) and runs five
times per edit) *is* B7 — see Open questions 6. M2 (`detectWalls.ts` is protected,
untyped and circularly tested) is gated on the corpus — see Open questions 7.

Docs: [`adr/0001-stage-0-data-safety.md`](adr/0001-stage-0-data-safety.md) ·
[`adr/0002-stage-1-changeability.md`](adr/0002-stage-1-changeability.md) ·
[`testing/corpus.md`](testing/corpus.md)

---

## Decisions that are not in the code

> Numbered **SD1–SD8** — "session decisions". ADR 0002 has its own internal D1–D6
> covering different subjects. The two lists are unrelated; the SD prefix exists
> so they can never be confused again.

### SD1 — `loadDesign` / `replaceWalls` are separate contracts

Master prompt §10 rule 4 says "never call `loadDesign` with a partial field set."
There are five call sites and one partial call is **correct** — the damaged-share-link
reset. Rather than keep a rule that flags correct code, the contract was split:
`loadDesign` for whole documents, `replaceWalls` for the AI paths. The type system
now enforces what the prose described.

**§10 rule 4 is superseded by this. Do not "fix" the split back.**
⚠ **Unverified** — see the standing principle below; the master prompt has never
been available to check this against.

Code: [`useDesignStore.ts`](../src/store/useDesignStore.ts) — `replaceWalls` and
`loadDesign`, with the rationale in the doc comment above them.

### SD2 — CLOSED. Floor switching does not clear undo, and that is settled

`setActiveFloor` no longer bumps `viewEpoch`, so switching floors keeps the undo
stack. `activeFloor` is in `DesignSnapshot`, so one ⌘Z after a floor switch
reverses the switch rather than an edit.

**This was briefly re-raised as an open question. It is not one.**
[`adr/0001:39`](adr/0001-stage-0-data-safety.md#L39) already decided it deliberately:
undoing a floor switch is a coherent thing for undo to do, and strictly better than
losing the stack. Corroborated in
[`audit/06_DATA_FLOW.md:406`](audit/06_DATA_FLOW.md#L406) and
[`audit/07_CURRENT_FEATURES.md:95`](audit/07_CURRENT_FEATURES.md#L95).

Do not reopen without a concrete user-facing complaint.

### SD3 — `noUncheckedIndexedAccess` is deliberately off

`strict` cost **zero** errors. `noUncheckedIndexedAccess` costs **309**, with **212 in
`detectWalls.ts` alone** — nearly all `array[i]` in provably-safe numeric loops.
Adding ~300 `!` assertions inside a protected module would teach the next reader
that `!` is punctuation.

Reasoning is recorded in [`tsconfig.app.json:17-23`](../tsconfig.app.json#L17-L23)
so it is found at the point of temptation, and in
[`adr/0002:72-88`](adr/0002-stage-1-changeability.md#L72-L88).

**Revisit only when `detectWalls.ts` moves into a Web Worker** — that rewrite
touches the hot loops anyway, and typed-array access removes most of the 212 for
free. Not as a standalone pass.

### SD4 — Two unshipped CV bugs were caught by the harness on its first run

Both were in the staged work and both would have shipped. Both are **fixed**; the
golden suite asserts against all three PNG fixtures and passes.

- **(a) `paperContrastMasks` was selecting the paper** — 87–95% of the image marked
  as ink. On a gridded sheet the grid sliced that white field into 75 strips that
  outscored the 7 real walls. Two fixtures detected **zero real walls**.
- **(b) `mergeWallFaces` fused a partition with a door's swing arc**, returning
  **0.64 m** thickness instead of 0.12 m — straight into the 3D model and the cost sheet.

Full diagnosis: [`adr/0002:37-53`](adr/0002-stage-1-changeability.md#L37-L53).
**The follow-up is still open — see B5b in Open questions.**

### SD5 — Every ★ regression test is demonstrated red before green

**A regression test that was never seen to fail is a test that proves nothing.**

This is not ceremony. In this session's F1 work, the first draft of the ★ tests
*passed against the unfixed code* — they wrote to a key the old implementation
never touched, so they proved nothing about the bug they named. They were rewritten
to seed through the legacy blob and assert by scanning stored values rather than a
known key, at which point three of them went red as intended. **Watch for exactly
that failure mode**: a test that cannot fail against the bug it describes.

For a fitness function with no live violation to catch (M1), demonstrate it by
introducing a deliberate violation, confirming it is caught, and deleting the probe.

### SD6 — Projects are one key each; the index is a cache, never the record

Storage is per-project (`PROJECT_KEY_PREFIX` + percent-encoded name) with a
summary index beside it. The index exists only to keep listing cheap.

**Names always come from the keys.** A missing or corrupt index is rebuilt by
listing; a failed index write is not a failed save. Treating the index as
authoritative would reintroduce F1 by another route — a project missing from it
would be invisible, and invisible is one step from deleted.

A project this build cannot parse is **hidden from the list but never removed**.
Migration off the legacy blob carries such entries across unvalidated, because
those are precisely the documents the old code destroyed.

### SD7 — History forgets blueprint pixels, and redo pays for it

`setBlueprint` revokes the outgoing object URL, but the outgoing blueprint is also
in the undo snapshot — so undo used to return a `Blueprint` whose `src` had already
been revoked, which fails to load silently and bypasses the panel's own "remembers
the file but not the image" message (it tests `!blueprint.src`, and a revoked URL
is still a string).

`forgetPixels()` nulls `src` on the way into a snapshot. Undo now returns the state
a reopened project is already in, which the panel explains and the user fixes by
re-picking the file.

**Accepted cost:** redo also comes back without pixels, even when that image is
still on screen. The smaller of the two surprises. The alternative — keeping every
replaced image alive in case an undo wants it — trades a confusing bug for an
unbounded one.

**Consequence:** `blueprintChanged` must compare `fileName`/`width`/`height`,
because `src` used to be what distinguished one drawing from another. Without that,
swapping underlays looks like no change and silently stops being undoable.

### SD8 — A crashed boot holds the draft back once, and says so

A flag is raised before a draft is restored and lowered in an effect once the app
mounts. React runs effects only after the whole tree commits, so a throw during
render leaves it raised — which is exactly the question "did the last boot finish?".

That boot leaves the draft **closed, not deleted**, then lowers the flag, so a
one-off crash cannot lock a design out of the app permanently.

The status is `held-back`, deliberately **not** `failed`: saving works and the work
is intact. Starting empty in silence would read as data loss.

---

## Open questions / follow-ups

### 1. B5b — the detector's scorer has no sanity gate `OPEN` · blocks B11

`scoreSegments` scores a candidate binarisation by **total detected wall length**
and nothing else. That is a proxy a degenerate mask can win by producing **more
garbage**, which is exactly what SD4(a) did: 75 imaginary walls totalling 77,592 px
beat 7 real ones totalling 6,300 px.

SD4(a)'s fix corrected the *mask predicate*. The **scorer is unchanged** and remains
capable of preferring a degenerate reading from some other cause.

**Needed:** an **ink-fraction sanity ceiling** (reject a mask marking an implausible
share of the image as ink, before its segments are scored at all) and a
**segment-count / total-length sanity signal** (many short segments summing to a
large total is the signature of sliced annotation, not walls).

**Must land before B11 (DXF)**, which inherits the same trust in the score.
Not recorded in ADR 0002 — that ADR diagnoses the mechanism but schedules no remedy.
⚠ Touches `detectWalls.ts`, which the carried notes mark protect-only.

### 2. 11 binary files (~49 MB) are tracked in git history `OPEN` · decision required

Identified by the B0 triage as junk, then committed anyway in `3ba61fc`. All at repo
root, none imported by any source file:

`animations.zip` · `blender(construction+worker).blend` (**37.7 MB**) · `blueborder.webp` ·
`dae.dae` · `fbx.fbx` · `glb.glb` · `obj.mtl` · `obj.obj` · `stl.stl` · `textures.zip` ·
`usd.usdc`

The 3 assets the app actually loads are correctly placed under `public/` and are
**not** part of this.

**Deliberately not removed.** Deleting them from the working tree does not shrink the
clone — they are permanent history, and only a rewrite reclaims the space. That is a
dedicated session with explicit approval.

**Open decision:** accept the 49 MB permanently, or schedule a rewrite session.

### 3. CI `RESOLVED 2026-08-10`

GitHub Actions, running `tsc -b`, `lint`, `test` and `build` on every push and pull
request — [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

### 4. The real architect corpus `OPEN` · **Stage 1 blocker** — see Blockers

### 5. ADR-numbering collision `RESOLVED 2026-08-10`

The carried decisions are now **SD**1–8, so they can no longer be confused with ADR
0002's internal D1–D6.

### 6. F5 — room detection is O(n²) and runs five times per edit `OPEN` · **this is B7**

`splitAtIntersections` tests every segment against every segment; `buildGraph`'s
`nodeAt` is a linear scan per endpoint over the *post-split* count. Five independent
`useMemo`s recompute it whenever walls change — `FloorPlanEditor`, `InspectorPanel`,
`RoomSchedulePanel`, `RoomLabels`, `VastuPanel` — synchronously, mid-drag.

**Two notes for B7, both from the B13 review:**
- Deduplicating five quadratic calls into one quadratic call still leaves it
  quadratic. Fix `nodeAt` (spatial bucketing on `WELD`) as well as the memoisation.
- **There is no perf baseline in the repo**, so B7 currently has no way to prove it
  helped. Establish one first.

### 7. M2 — `detectWalls.ts` is the module nobody can safely change `OPEN`

Simultaneously: protect-only, the single largest exclusion from
`noUncheckedIndexedAccess` (212 of 309 errors, SD3), validated only by fixtures
co-authored with it, and scored by a heuristic with no sanity gate (B5b). Each
constraint is defensible; together they mean no confident change is possible.

It has already demonstrated this: a bad merge duplicated 83 lines inside it and
**only the compiler caught it** — not a test, not review.

**Sequence:** real corpus → B5b's sanity gate → Worker move (taking
`noUncheckedIndexedAccess` for that directory during the rewrite). Do not attempt
B11 before the gate.

### 8. Other genuinely unresolved items

| | Item | Status |
|---|---|---|
| **8a** | **Asset licensing.** `character.glb` and the two Mixamo FBX clips ship in `public/` with no licence file. Audit Q16 calls this *"the only unresolved licence exposure in the project"*. Compounded by item 2, since the source `.blend` and export formats are committed too. | OPEN — needs a human answer |
| **8b** | **Production backend.** `aiPlugin` runs only under `vite dev`, and Vercel serves the static build, so **the AI endpoints do not exist in production** — a successful deploy does not mean the AI features work there. Users get B2's degradation path. Whether that is intended is not recorded. | OPEN — audit Q5 |
| **8c** | **Contradictory AI-policy comments.** `openingDetector.ts` states the project *"deliberately does not use Claude/Anthropic"*, while `designAgent.ts` sets a Claude model id via OpenRouter. One is stale. Documentation defect, not behavioural. | OPEN — audit Q6 |
| **8d** | **Coverage gaps left deliberately.** `export/pdf.ts` (byte-level — needs a PDF parser, its own dependency decision), `plan/planSheet.ts`, `export/statement.ts`, and most React components. The 121 `data-testid` attributes are waiting. | OPEN |

---

## Blockers

### The real architect-drawing corpus — Stage 1 cannot exit without it

**What:** ≥50 real architect drawings, tagged on six axes (wall rendering, sheet and
polarity, annotation load, geometry, dimensioning, provenance), with per-tag pass
rates and per-tag floors. Fully specified in
[`docs/testing/corpus.md`](testing/corpus.md), including `geom-angled` and
`geom-curved` at an expected **0%** so the gap is sized rather than hidden.

**Why it blocks:** everything in `samples/` is generated by `gen-blueprint.mjs`, and
three of six fixtures were authored in the same change set as the detector code they
exercise — the golden test's own header records this. A green golden suite means the
detector still does what it did yesterday. It is not evidence about real drawings.
**Until real drawings exist, no claim about detection accuracy is supportable**, and
B11 (DXF) inherits the same blind spot.

**Who unblocks it: the human, not the agent.** Sourcing requires people and licences.

1. **Local practices** — the only source of Indian conventions (hatched brick, ft-in
   dimension strings, Devanagari labels, sanction title blocks). 10 drawings each from
   five practices.
2. **Public academic datasets** (CubiCasa5K and similar) — good for style breadth, but
   predominantly European: thin-line walls, metric, different symbols. **Check licence
   terms before anything ships**; research-only is common. Breadth, not representativeness.
3. **House-plan sites** — plentiful and Indian, but copyright-encumbered. Local dev
   corpus only, never committed.

**Structure when they arrive:**

- Keep the generated `samples/` **committed** as a regression floor. It caught two real
  bugs and is still valuable for exactly that — it is circular only for *tuning*.
- Put real drawings in a **gitignored `corpus/`**.
- Commit a **manifest** (hash · tags · source · licence) so per-tag pass rates are
  reproducible without redistributing anyone's drawings.

Neither `corpus/` nor a manifest exists yet.

---

## Do not

- **Do not redo Stage 0 or Stage 1.** Verified clean at `c24c432` on 2026-08-10.
- **Do not restart the roadmap.**
- **Do not rewrite history** — no `reset`, `rebase`, or force-push — without explicit
  approval. This includes the 49 MB of binaries in open question 2.
- **Do not modify `detectWalls.ts`** unless the work is explicitly authorised. It is
  marked protect-only and is the subject of open questions 1 and 7.
- **Do not rewrite or "clean up" `CharacterAvatar.tsx`** without a concrete, current
  issue. It was corrupted once by a bad merge and has already been repaired.
- **Do not claim real-world detection accuracy without the real corpus.** The golden
  suite is a regression floor, not an accuracy measurement.
- **Do not re-merge the `loadDesign` / `replaceWalls` split** (SD1).
- **Do not reopen `activeFloor`-in-snapshot** (SD2) without a user-facing complaint.
- **Do not enable `noUncheckedIndexedAccess` as a standalone pass** (SD3).
- **Do not accept a ★ regression test that was never demonstrated red** (SD5) — and
  check that it fails for the *right reason*.
- **Do not treat the project index as the source of truth** (SD6). Names come from
  the keys. Do not "optimise" listing by trusting it.
- **Do not put `src` back into `DesignSnapshot`** (SD7), and do not remove
  `fileName`/`width`/`height` from `blueprintChanged` — that pairing is load-bearing.
- **Do not move undo state back to module scope** (M3). The engine is a factory so a
  second document is possible later.

---

## Standing principles

### Work only from available evidence

> **When required source or specification context is unavailable, explicitly state the
> limitation and scope claims to the evidence that is actually available. Do not
> silently fill gaps.**

Concretely: **`MASTER_PROMPT.md` has never been available** — not as
`space-designer-master-prompt-v2.md`, not as `docs/MASTER_PROMPT.md`, across four
sessions. Every reference to §3, §7, §9.2 and §10 in this file and in the ADRs is
carried forward and **has not been verified against the source document**. SD1's
claim that §10 rule 4 is superseded is, at present, unfalsifiable.

Note that a carried citation is now compiled into
[`tsconfig.app.json:20`](../tsconfig.app.json#L20), which tells every future reader
that `detectWalls.ts` is protect-only. Each repetition makes it more load-bearing
and no more true.

**Highest-value fix available:** commit the master prompt to `docs/MASTER_PROMPT.md`.
It is the only referenced authority in this project not under version control.

B13's deliverables 3, 4 and 5 — verifying Stage 0/1 against §7 as written, auditing
every carried §-reference, and sweeping for §3/§10 contradictions — **remain
undelivered** for this reason, and must not be attempted from memory.

### A contradiction is a finding, not something to smooth over

If the repository disagrees with a brief, a doc, or this file, report the disagreement
with evidence rather than reconciling it silently. SD2's status, the B5b follow-up and
the first draft of the F1 tests all surfaced exactly that way.
