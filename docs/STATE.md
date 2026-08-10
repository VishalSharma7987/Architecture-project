# Project State

Updated: 2026-08-10 · Commit: `1bf5cec`

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
| Last completed task | **B6** |
| Next task | **B13** (adversarial review) |
| Upcoming | **B7 (+ B8 folded in)** |

Two deliberate departures from the master prompt's task order:

- **B13 runs before B7.** The store contract, the schema and the persistence layer
  all changed in Stage 0/1. An adversarial pass against the current state is worth
  more than one against a state already left behind, and it closes Stage 0/1.
- **B8 is folded into B7.** B8's deliverable is a single shared memoisation point
  replacing six `useMemo`s. All six call `resolveRooms`, which B7 rewrites. Done
  separately, the memoisation work happens twice.

Revised order: **B13 → B7 (+B8) → B9 → B10 → B11 → B12.**

---

## Gate

Verified at `1bf5cec` on 2026-08-10:

| Check | Result |
|---|---|
| `npm test` | **201 passing / 201** · 11 files / 11 |
| `npm run build` | **pass** (exit 0) |
| `npx tsc -b` | **clean** (exit 0) |
| `npm run lint` | **0 errors** (exit 0), 5 warnings |
| `strict` | **`true`** — [`tsconfig.app.json:25`](../tsconfig.app.json#L25) |
| Key boundary | **intact** — no `ANTHROPIC` / `OPENROUTER` / `sk-ant-` / `sk-or-` in `dist/` |

The 5 lint warnings are genuine advisories, not suppressions: 3 ×
`react/no-array-index-key`, 2 × `eslint/no-shadow`.

CI runs all four checks on every push and pull request —
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

---

## Shipped

Stage 0 and Stage 1, delivered in `3ba61fc` (+ `1bf5cec`, a build fix).

| Task | What shipped | Tests |
|---|---|---|
| **B0** | Triage: build succeeded · `strict` was off · staged work = 4 coherent features + 3 required assets + 11 junk binaries | — |
| **B1** | AI edit no longer destroys furniture / rooms / stairs / plot / north / rate / floors; both AI flows undoable | 8 |
| **B2** | Build-time AI availability detection; honest degradation; `AbortController` timeouts; key boundary as a fitness function | 9 |
| **B3** | `CalibrationService` authority ladder; schema v2 + migration runner; blueprint persisted and undoable | 43 |
| **B4** | Autosave watches the whole document; quota failures surfaced; two-step confirmations; cross-tab detection | 19 |
| **B5** | Vitest harness; golden file wired; pure-module coverage; corpus taxonomy specified | 122 |
| **B6** | `strict: true`; lint 2 rules → 3 categories; README's 10 contradictions corrected | — |

Docs: [`adr/0001-stage-0-data-safety.md`](adr/0001-stage-0-data-safety.md) ·
[`adr/0002-stage-1-changeability.md`](adr/0002-stage-1-changeability.md) ·
[`testing/corpus.md`](testing/corpus.md)

---

## Decisions that are not in the code

> **Numbering warning.** These are *session-carried* decisions D1–D5. ADR 0002 has
> its own internal D1–D6 covering different subjects. They are not the same list
> and the numbers do not correspond. Always qualify which you mean.

### D1 — `loadDesign` / `replaceWalls` are separate contracts

Master prompt §10 rule 4 says "never call `loadDesign` with a partial field set."
There are five call sites and one partial call is **correct** — the damaged-share-link
reset. Rather than keep a rule that flags correct code, the contract was split:
`loadDesign` for whole documents, `replaceWalls` for the AI paths. The type system
now enforces what the prose described.

**§10 rule 4 is superseded by this. Do not "fix" the split back.**

Code: [`useDesignStore.ts:601`](../src/store/useDesignStore.ts#L601) (`replaceWalls`),
[`:604`](../src/store/useDesignStore.ts#L604) (`loadDesign`), rationale at
[`:581-600`](../src/store/useDesignStore.ts#L581-L600).

### D2 — CLOSED. Floor switching does not clear undo, and that is settled

`setActiveFloor` no longer bumps `viewEpoch`, so switching floors keeps the undo
stack. `activeFloor` is in `DesignSnapshot`
([`useDesignStore.ts:867`](../src/store/useDesignStore.ts#L867)), so one ⌘Z after a
floor switch reverses the switch rather than an edit.

**This was briefly re-raised as an open question. It is not one.**
[`adr/0001:39`](adr/0001-stage-0-data-safety.md#L39) already decided it deliberately:
undoing a floor switch is a coherent thing for undo to do, and strictly better than
losing the stack. Corroborated in
[`audit/06_DATA_FLOW.md:406`](audit/06_DATA_FLOW.md#L406) and
[`audit/07_CURRENT_FEATURES.md:95`](audit/07_CURRENT_FEATURES.md#L95).

Do not reopen without a concrete user-facing complaint.

### D3 — `noUncheckedIndexedAccess` is deliberately off

`strict` cost **zero** errors. `noUncheckedIndexedAccess` costs **309**, with **212 in
`detectWalls.ts` alone** — nearly all `array[i]` in provably-safe numeric loops.
Adding ~300 `!` assertions inside a §3-protected module would teach the next reader
that `!` is punctuation.

Reasoning is recorded in [`tsconfig.app.json:17-23`](../tsconfig.app.json#L17-L23)
so it is found at the point of temptation, and in
[`adr/0002:72-88`](adr/0002-stage-1-changeability.md#L72-L88).

**Revisit only when `detectWalls.ts` moves into a Web Worker (master prompt §9.2)** —
that rewrite touches the hot loops anyway, and typed-array access removes most of the
212 for free. Not as a standalone pass.

### D4 — Two unshipped CV bugs were caught by the harness on its first run

Both were in the staged work and both would have shipped. Both are **fixed**; the
golden suite asserts against all three PNG fixtures and passes.

- **(a) `paperContrastMasks` was selecting the paper.** The dominant colour quantises
  to 252 on a white sheet, so every pure-white pixel read as "lighter than the paper" —
  87–95% of the image marked as ink. On a gridded sheet the grid sliced that white
  field into 75 strips that outscored the 7 real walls.
  `blueprint-detailed.png` and `blueprint-dark.png` detected **zero real walls**.
- **(b) `mergeWallFaces` fused a partition with a door's swing arc**, returning
  **0.64 m** thickness instead of 0.12 m — straight into the 3D model and the cost sheet.

Full diagnosis: [`adr/0002:37-53`](adr/0002-stage-1-changeability.md#L37-L53).

**The follow-up is still open — see B5b in Open questions.** (a) is a failure of the
*scoring heuristic*, not just a threshold, and the scorer was not changed.

### D5 — Every ★ regression test was demonstrated red before green

Reverting the AI-edit call failed 4 with the right symptoms; disabling the calibration
ladder failed 3; reverting the autosave dirty check failed 10.

**Preserve this property: a regression test that was never seen to fail is a test that
proves nothing.** New ★ tests must be demonstrated red before they are accepted.

---

## Open questions / follow-ups

### 1. B5b — the detector's scorer has no sanity gate `OPEN` · blocks B11

[`detectWalls.ts:797-801`](../src/blueprint/detectWalls.ts#L797-L801) scores a
candidate binarisation by **total detected wall length** and nothing else. Master
prompt §3 defends the four-way binarisation because it *scores* candidates rather
than guessing the drawing's style — that defence assumes the score is meaningful.
Total length is a proxy a degenerate mask can win by producing **more garbage**, which
is exactly what D4(a) did: 75 imaginary walls totalling 77,592 px beat 7 real ones
totalling 6,300 px.

D4(a)'s fix corrected the *mask predicate*. The *scorer* is unchanged and remains
capable of preferring a degenerate reading from some other cause.

**Needed:**
- an **ink-fraction sanity ceiling** — reject a mask that marks an implausible share of
  the image as ink, before its segments are scored at all;
- a **segment-count / total-length sanity signal** — many short segments summing to a
  large total is the signature of sliced annotation, not of walls.

**Must land before B11 (DXF)**, which inherits the same trust in the score.
Not currently recorded in ADR 0002 — that ADR diagnoses the mechanism at
[`:43`](adr/0002-stage-1-changeability.md#L43) but schedules no remedy.

### 2. 11 binary files (~49 MB) are tracked in git history `OPEN` · decision required

Identified by the B0 triage as junk, then committed anyway in `3ba61fc`. All at repo
root, none imported by any source file:

`animations.zip` · `blender(construction+worker).blend` (**37.7 MB**) · `blueborder.webp` ·
`dae.dae` · `fbx.fbx` · `glb.glb` · `obj.mtl` · `obj.obj` · `stl.stl` · `textures.zip` ·
`usd.usdc`

The 3 assets the app actually loads are correctly placed under `public/` and are
**not** part of this: `public/character.glb`, `public/animations/Idle.fbx`,
`public/animations/Walking.fbx`.

**Deliberately not removed.** Deleting them from the working tree does not shrink the
clone — they are permanent history, and only a history rewrite reclaims the space.
That is a dedicated session with explicit approval, not a side effect of other work.

**Open decision:** accept the 49 MB permanently, or schedule a rewrite session.

### 3. CI `RESOLVED 2026-08-10`

[`adr/0002:128`](adr/0002-stage-1-changeability.md#L128) listed CI as not done
because "choosing a provider is an infrastructure decision". GitHub Actions was
chosen — the repository is already on GitHub, so it adds no new provider.

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `tsc -b`, `lint`,
`test` and `build` on every push and pull request.

### 4. The real architect corpus `OPEN` · **Stage 1 blocker** — see Blockers

### 5. Other genuinely unresolved items found in the repository

| | Item | Status |
|---|---|---|
| **5a** | **Asset licensing.** `character.glb` and the two Mixamo FBX clips ship in `public/` with no accompanying licence file. Audit Q16 calls this *"the only unresolved licence exposure in the project"* — the npm tree is entirely permissive. Now compounded by open question 2, since the source `.blend` and export formats are also committed. | OPEN — needs a human answer, not a code change |
| **5b** | **Production backend.** `aiPlugin` runs only under `vite dev` ([`aiPlugin.ts:121`](../server/aiPlugin.ts#L121)). Vercel serves the static build, so **the AI endpoints do not exist in production** — the deploy succeeding does not mean the AI features work there. B2's honest-degradation path is what users hit. Whether that is intended for now is not recorded. | OPEN — audit Q5 |
| **5c** | **Contradictory AI-policy comments.** [`openingDetector.ts:8`](../server/openingDetector.ts#L8) states the project *"deliberately does not use Claude/Anthropic"*, while [`designAgent.ts:13`](../server/designAgent.ts#L13) sets a Claude model id via OpenRouter. One of the two is stale. Documentation defect, not a behavioural one. | OPEN — audit Q6 |
| **5d** | **Coverage gaps left deliberately.** `export/pdf.ts` (975 LOC, byte-level — asserting on bytes needs a PDF parser, which is its own dependency decision), `plan/planSheet.ts`, `export/statement.ts`, and every React component beyond the four hooks already exercised. The 121 `data-testid` attributes are waiting. | OPEN — [`adr/0002:129-130`](adr/0002-stage-1-changeability.md#L129-L130) |
| **5e** | **ADR-numbering collision.** Session-carried D1–D5 (above) and ADR 0002's internal D1–D6 are different lists with overlapping numbers. Cheap to misread. | OPEN — resolve by renaming one series |

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
exercise — the golden test's own header records this at
[`detectWalls.golden.test.ts:37`](../src/blueprint/detectWalls.golden.test.ts#L37).
A green golden suite means the detector still does what it did yesterday. It is not
evidence about real drawings. **Until real drawings exist, no claim about detection
accuracy is supportable**, and B11 (DXF) inherits the same blind spot.

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

- **Do not redo Stage 0 or Stage 1.** Verified clean at `1bf5cec` on 2026-08-10.
- **Do not restart the roadmap.**
- **Do not rewrite history** — no `reset`, `rebase`, or force-push — without explicit
  approval. This includes the 49 MB of binaries in open question 2.
- **Do not start B7 before B13.**
- **Do not rewrite or "clean up" `CharacterAvatar.tsx`** without a concrete, current
  issue. It was corrupted once by a bad merge and has already been repaired.
- **Do not claim real-world detection accuracy without the real corpus.** The golden
  suite is a regression floor, not an accuracy measurement.
- **Do not re-merge the `loadDesign` / `replaceWalls` split** (D1).
- **Do not reopen `activeFloor`-in-snapshot** (D2) without a user-facing complaint.
- **Do not enable `noUncheckedIndexedAccess` as a standalone pass** (D3).
- **Do not accept a ★ regression test that was never demonstrated red** (D5).

---

## Standing principles

### Work only from available evidence

> **When required source or specification context is unavailable, explicitly state the
> limitation and scope claims to the evidence that is actually available. Do not
> silently fill gaps.**

Concretely: `space-designer-master-prompt-v2.md` is **not in this repository** and has
not been available in the last two sessions. Every reference to §3, §7, §9.2 and §10 in
this file and in the ADRs is carried forward from earlier sessions and **has not been
re-verified against the source document**. B13 cannot be run against the authoritative
specification until the master prompt is loaded, and must not be run against a
remembered version of it.

### A contradiction is a finding, not something to smooth over

If the repository disagrees with a brief, a doc, or this file, report the disagreement
with evidence rather than reconciling it silently. Both D2's status and the scorer
follow-up in B5b surfaced exactly that way.
