# ADR 0001 — Stage 0: stop the bleeding

**Status:** implemented
**Date:** 2026-08-07
**Baseline:** commit `8e1d02d` working tree
**Covers:** B1 (AI edit data loss) · B2 (production AI reachability) · B3 (CalibrationService)
**Gate at time of writing:** `tsc -b` clean · `npm run build` exit 0 · `vitest run` 60/60 · `oxlint` clean

---

## Context

The audit found four BROKEN items. Three of them turned out to be the same defect wearing different clothes:

> **A write path accepts a partial update and silently invents the rest.**

- `loadDesign({name, walls})` — every field not supplied defaults to empty, so an AI edit deleted the furniture, room names, stairs, plot, north rotation, construction rate, floor finish and both upper storeys.
- `updateBlueprint({metresPerPixel})` — any caller could set the scale, so a vision model's reading silently replaced a measurement the user had taken by hand.
- `viewEpoch` — one counter meant both "refit the camera" and "discard the undo history", so any operation needing the first got the second for free.

The fix in all three cases is the same shape: **make the partial write unrepresentable**, rather than adding a conditional at the call site.

---

## Decisions

### D1 — `viewEpoch` splits into `viewEpoch` and `historyEpoch`

`src/store/useDesignStore.ts`

Refitting the viewport and throwing away the user's undo stack are different claims. They shared a counter, and the recorder watched the wrong one.

| Action | `viewEpoch` | `historyEpoch` |
|---|---|---|
| `loadDesign`, `newDesign` | ✅ | ✅ — a different document; the old history describes something that is no longer open |
| `replaceWalls` (AI generate/edit) | ✅ | ❌ — an edit, and edits are undoable |
| `setActiveFloor` | ✅ | ❌ |

**Consequence, deliberate and beyond B1's stated scope:** switching floors no longer wipes the undo stack. It used to, for the same reason an AI edit did. `activeFloor` is in `DesignSnapshot`, so one ⌘Z after a floor switch moves back a floor — which is a coherent thing for undo to do, and strictly better than losing the stack.

### D2 — `replaceWalls(walls, name?)`, and `loadDesign` is for documents only

`src/store/useDesignStore.ts`, `src/ai/useDesignAI.ts`

The model is shown `{name, walls}` and can only return walls. It is never told the furniture, the plot or the upper storeys exist, so it cannot have an opinion about them, and reading its silence as "delete them" is not a reading anyone asked for.

`replaceWalls` swaps the walls, normalises them on the way in (they came from outside the editor and have not been through `updateWall`), clears the selection (the old ids are gone), bumps `viewEpoch`, and **does not** bump `historyEpoch`.

**Rejected:** merging returned walls against existing ones by geometric proximity. The model is instructed to return the complete plan, ids are stripped precisely so it cannot echo stale ones, and a merge heuristic would introduce exactly the kind of invented geometry L1 forbids.

**Rejected:** forbidding partial `loadDesign` calls by convention (§10 rule 4). Five call sites exist and one partial call — the damaged-share-link reset at `useSharedDesign.ts:38` — is correct. A rule that flags correct code gets ignored. The real defect was one function serving two contracts; splitting it lets the type system enforce what a comment could not.

### D3 — AI availability is resolved at build time

`src/ai/endpoint.ts`

`server/aiPlugin.ts` mounts `/api/ai/*` from `configureServer`, which runs under `vite dev` and nowhere else. In every deployed build the endpoints 404, `response.json()` throws on the HTML error page, and the user is told *"The server returned a malformed response"* — true, useless, and indistinguishable from a bug.

```
AI_BASE_URL = import.meta.env.DEV ? '' : normalise(import.meta.env.VITE_AI_BASE_URL) ?? null
```

Unset ⇒ `null` ⇒ the AI controls are disabled with an explanation, and `useBlueprintStructure` skips the doomed round trip entirely while still building walls from the deterministic detector.

**Rejected:** a `/api/ai/status` capability probe. Costs a round trip on every load, needs caching, and is still wrong offline. The answer is known when the bundle is built.

**The key-boundary cost, and how it is paid.** The audit's strongest structural finding was `grep import.meta.env src/ → 0 hits`. This introduces one. So the guarantee is restated as a fitness function instead of a memory — `src/ai/endpoint.test.ts` fails the build if any other file reads `import.meta.env`, if any `VITE_` variable other than `VITE_AI_BASE_URL` is read, if a secret's name appears in `src/`, or if anything imports from `server/`. That is a stronger check than the grep it replaces, and it runs on every commit.

A base URL is an address, not a credential. Vite inlines every `VITE_`-prefixed variable into the bundle, which is exactly why the API keys are deliberately *not* prefixed.

### D4 — Timeouts on both AI fetches

`AbortController` at 120 s for design generation, 90 s for a vision read. There were none; a hung upstream left the panel spinning with no way out but a reload. Generous rather than tight, because the panel already tells the user a plan takes 20–60 s and cutting a slow-but-working generation off at 30 s would break the feature to fix the hang.

### D5 — `proposeCalibration` is the only writer of `metresPerPixel`

`src/blueprint/calibration.ts`

The authority ladder from §8, with rank ascending as trust descends:

| Rank | Source | Locks? |
|---|---|---|
| 1 | `manual` — two picks and a typed length | **yes** |
| 2 | `dxf-units` | no |
| 3 | `vector` | no |
| 4 | `ocr` | no |
| 5 | `heuristic` | no |
| 6 | `ai` | no |
| 7 | `none` — the 0.01 default | no |

A proposal is refused when the current scale is `lockedByUser` and the proposal is not `manual`, or when its rank is worse than the incumbent's. `applyPlanScale` became a proposal rather than a write, and returns early with `kind: 'kept-measured'` when a measurement is in force.

Also unified, because they were the same bug in two places:

- **The clamp.** `[1e-5, 1]` now applies to every source. The manual path had it; the AI path had none, so a hallucinated `widthFeet` could set any scale at all.
- **The origin rule.** The image scales about an anchor — the user's first pick, or the image's own centre when none is given. The AI path used to re-centre on the world origin, sliding the underlay out from beneath anything already traced.
- **`calibratedSrc`.** A module-scope string that was never cleared, by anything. Provenance now lives on the blueprint object, so it cannot leak past the image it describes.

**Vocabulary.** `ScaleSource.kind` was `'calibrated' | 'guess'`; it is now `'estimated' | 'kept-measured' | 'guess'`. Only a user measurement earns the word *calibrated*. The banner used to read *"Sized to 40′ from the drawing"* for a number a free vision model had guessed off a JPEG — the one place this codebase's otherwise careful honesty about uncertainty failed.

**Existing walls are not rescaled.** Their metres were baked in by `segmentsToWalls` and rewriting geometry the user may have hand-edited is worse than the inconsistency. The count comes back as `staleWalls` and the panel says so.

### D6 — `unlockCalibration` demotes the source, not just the flag

Found by a failing test. Clearing `lockedByUser` alone achieves nothing: the source still reads `manual`, which outranks every automated source, so the rank check goes on refusing them and "unlock" is a button that does not work. It now sets `source: 'none'` as well — *"I am no longer vouching for this number"* — while the value stays in force until something better replaces it.

### D7 — Schema v2, and the migration mechanism (L7)

`src/persistence/schema.ts`

`schema.ts` has carried a comment promising a migration path since v1 and had none — the only version handling was a forward-rejection. Building it *before* it was needed is the whole point of L7.

```ts
const MIGRATIONS: Record<number, (doc) => doc> = {
  1: (doc) => ({ ...doc, blueprint: null, version: 2 }),
}
```

Applied in sequence, so a v1 file opened in a v5 build runs 1→2→3→4→5 rather than needing an N×N table. A gap throws — a missing migration is a programming error, not a bad file. `ParseResult` now carries `originalVersion`; `parseDesign` used to return `version: DESIGN_VERSION` and discard what the file actually said.

**v1 → v2 adds `blueprint: PersistedBlueprint | null`** — everything about the underlay except its `src`.

`Blueprint.src` becomes `string | null`. An object URL is valid for one session of one tab, so it cannot be persisted; the placement and the calibration around it can. A reopened project remembers it was traced from `site-plan.png` at 1 px = 1.9 cm, and `loadBlueprintFromFile` restores that measurement when the same file is picked again — matched on **name and pixel dimensions both**, since a resaved or cropped export under the same name would otherwise inherit a scale that no longer describes it.

TypeScript found all three places a detached blueprint would have crashed at runtime (`buildStructure.ts:50`, `detectOpenings.ts:586`, `BlueprintPanel.tsx:209`). Each now reports the state honestly instead.

### D8 — `blueprint` joins `DesignSnapshot`, selectively compared

Calibration must be undoable — that it was not is why the scale bug was unrecoverable. But comparing the blueprint object by reference would put an undo step behind every frame of an opacity drag, so `blueprintChanged` compares only `src`, `metresPerPixel`, `origin` and `calibration`.

**Cost:** undoing a calibration also restores whatever opacity was in force when it was made. Real, invisible, and the cheaper of the two mistakes.

---

## Consequences

### Behaviour that changed

| Before | After |
|---|---|
| AI edit deleted furniture, rooms, stairs, plot, north, rate, material, floors 1–2 | Only the walls change |
| AI generate/edit cleared the undo stack | Both are undoable |
| Switching floors cleared the undo stack | It does not |
| AI controls live in a build with no backend; failures read as *"malformed response"* | Disabled, with an explanation |
| No request timeout | 120 s / 90 s with distinct messages |
| A vision estimate could overwrite a measurement | Refused, and the refusal is reported |
| Estimates described as "calibrated" | "Estimated", "kept-measured", or "guess" |
| Calibration lost on reload, not undoable | Persisted (minus pixels) and undoable |
| Calibration input was metres-only, `type="number"` | `parseLength` — `12'6"`, `3.81m`, `381cm`, `6 3/4"` |
| Opacity drags: n/a | Deliberately excluded from undo |
| `DESIGN_VERSION = 1`, no migrations | `2`, with a runner and a v1 fixture test |

### What was preserved

Per §3 and §5, nothing on the protect-list was rewritten. `parseDesign`'s malformed-vs-odd contract is extended, not replaced. `plan/rooms.ts`, `detectWalls.ts`'s scoring and stage order, `rooms/resolve.ts`'s half-open PIP comparisons and `export/pdf.ts` are untouched. `sensibleWidth`'s band check — the one place the codebase already distrusted a model's numbers — is the pattern `proposeCalibration` is modelled on.

### Tests

60, in four files. Each ★ test was **verified to fail against the pre-fix code**, not merely written after it:

| Suite | n | Verification performed |
|---|---|---|
| `src/ai/useDesignAI.test.ts` | 8 | Reverted to `loadDesign({name, walls})` → 4 failed with exactly the right symptoms: `furniture` `[]`, upper storeys `[]`, `past.length === 0`, `plot` `null` |
| `src/blueprint/calibration.test.ts` | 22 | Disabled both ladder checks → 3 failed |
| `src/persistence/schema.test.ts` | 21 | v1 fixture + round-trip + `1e999` rejection |
| `src/ai/endpoint.test.ts` | 9 | Architecture fitness functions; L3 offline-safety check |

### Harness, pulled forward from B5

B1–B4 each ask for a failing test but the harness lands at B5, so the minimal wiring came first: Vitest + jsdom + `@testing-library/react`, `vitest.config.ts`, `src/test/setup.ts` (polyfills `crypto.randomUUID` deterministically and the object-URL API), `src/test/fixtures.ts` (`resetStore`, `seedRichDesign`, `rectangleWalls`).

`tsconfig.test.json` is a third project. Tests live beside the code they cover but are not the app: they use `node:fs` for the fitness functions, and pulling `@types/node` into the app project would quietly legitimise importing node built-ins from client code. `tsc -b` still checks them.

### Also fixed in passing

`three-stdlib` is now declared in `dependencies`. It was imported by two files and present in neither dependency list, resolving only as a hoisted transitive of drei.

---

## Not done, and why

| Item | Reason |
|---|---|
| A real production AI backend | Requires an infrastructure and cost decision that cannot be made from the repository. Honest degradation ships now; `VITE_AI_BASE_URL` is the seam. |
| Rescaling existing walls on re-calibration | Must also scale furniture, stairs, room anchors and the plot — a geometry-wide operation belonging with Stage 3. Reported as `staleWalls` in the meantime. |
| Response cache, cost tracking, model fallback list | §7 lists these as "add now regardless of stage"; they are follow-on work in Stage 8's bucket and do not gate anything. |
| Provenance on walls/openings/rooms (L5) | Model v2 proper, scheduled at B7 alongside room identity. Calibration provenance ships here because the scale bug required it. |
