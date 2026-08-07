# ADR 0002 — Stage 1: make the codebase changeable

**Status:** implemented
**Date:** 2026-08-07
**Covers:** B5 (test harness) · B6 (strict mode)
**Gate:** `tsc -b` clean · `npm run build` exit 0 · `vitest run` 201/201 · `oxlint` 0 errors

---

## Context

21,490 LOC, **zero tests**, and ~3,900 LOC of pure algorithm — a hand-rolled PDF byte writer, a CV pipeline, a planar-graph room detector, the untrusted-input validator, the unit parser — carrying the whole product. Three README sentences described tests that did not exist.

The architecture was already unusually test-*ready*: pure modules importing only `type` from the store, `RasterLike` defined *"so the detector runs outside a browser too"*, 121 `data-testid` attributes, and `samples/blueprint-expected.json` sitting there as a golden file with no consumer. The seams were built; nothing was hung on them.

---

## Decisions

### D1 — Vitest + jsdom, with a separate TypeScript project for tests

`vitest.config.ts` is deliberately **not** `vite.config.ts`: the app config installs `aiPlugin`, which reads API keys and mounts middleware. A suite that can reach OpenRouter is a suite whose results depend on someone's credit balance.

`tsconfig.test.json` is a third project. Tests live beside the code they cover but are not the app — they use `node:fs` for the architecture fitness checks, and pulling `@types/node` into the app project would quietly legitimise importing node built-ins from client code. `tsc -b` checks all three.

### D2 — What the golden file can and cannot assert

`samples/README.md` says *"Import any of the above, export the result, diff against this."* That fails on every fixture, for two reasons that are both correct behaviour:

1. The golden file lists **11 openings**. `detectWallSegments` deliberately does not detect openings — a door is a gap `mergeCollinear` heals, and openings come from the vision model. Diffing them would test the LLM.
2. The file is `version: 1`, which now migrates to v2 and gains a `blueprint` field it cannot know about.

So the comparison is **wall geometry only**, by centreline within 0.02 m (2 px at 100 px/m) and by length **overlap** rather than endpoints — `snapJunctions` legitimately pulls an end onto a crossing wall's centreline. Full rationale and the assertion list: [`docs/testing/corpus.md`](../testing/corpus.md).

`pngjs` decodes straight into `RasterLike`, using the browser-free seam for the first time. No headless browser in the unit suite.

### D3 — ★ Two real CV defects, found by the harness on its first run

Both in the **staged, unshipped** work. Both would have shipped.

**(a) `paperContrastMasks` was selecting the paper.** The dominant colour is quantised to 5 bits per channel, so on a white sheet the paper reference lands at 252 rather than 255 — and every pure-white pixel is then "lighter than the paper". That is 87–95% of the image marked as ink.

On a plain sheet the resulting blob is rejected downstream for being far too thick, so the fault was invisible. On a **gridded** sheet the grid lines slice that white field into long thin strips with excellent aspect ratios, and `scoreSegments` — which maximises total detected length — preferred **75 imaginary walls totalling 77,592 px to 7 real ones totalling 6,300 px**.

`blueprint-detailed.png` and `blueprint-dark.png` detected **zero real walls**.

Fix: both directional masks now also require `distance[i] > distThreshold` — the Otsu split already computed for the first mask, and already the boundary between "this is the paper" and "this is drawn on it". This keeps exactly the rescue the masks were added for (a colour-flooded plan where the walls are the dark side of a tinted floor) while excluding the floor and the margin themselves. All three fixtures now return the identical 7 walls.

**(b) `mergeWallFaces` fused a wall with a door's swing arc.** It checked that two bands overlap, but never that they are the same *length* — and a short band lying entirely alongside a long one is fully overlapped by it while having nothing to do with it. The 98 px arc beside a 500 px partition passed every other guard (span 64 px, under the 96 px ceiling; similar pen weights), so the partition came back **0.64 m thick and displaced 0.26 m — five times its real size**, straight into the 3D model and the cost sheet.

Fix: `FACE_LENGTH_RATIO = 0.6`. Two faces of one wall run its whole length together; generous at 0.6 because one face may be interrupted by a door the other is not, or trimmed by a junction snap.

**Neither fix touches the protected parts of §3** — not the four-way scoring approach, not the `mergeWallFaces`-before-`typicalThickness` ordering. Both are predicate corrections with a failing test in front of them.

### D4 — Coverage, in the §7 Stage 1 order

| Module | LOC | Stmts | The trap it guards |
|---|---|---|---|
| `persistence/schema.ts` | 499 | **87%** | `1e999` → Infinity; v1 migration; blueprint round-trip |
| `units/length.ts` | 254 | **91%** | **format/parse are not inverses** (§4-4); the grid step is unit-dependent (§4-8) |
| `plan/rooms.ts` | 251 | **99%** | T-junction split; outer face by winding sign; L-shapes; half-open PIP (§4-8) |
| `scene/wallGeometry.ts` | 313 | **83%** | **`atan2(-dz, dx)`** (§4-3) — the README's own described test, finally written |
| `scene/collision.ts` | 301 | **98%** | the degenerate inside-the-box branch (§4-6); sweep vs tunnelling |
| `blueprint/detectWalls.ts` | 851 | **96%** | the golden harness above |
| `blueprint/calibration.ts` | — | **77%** | the authority ladder (ADR 0001) |
| `vastu/zones.ts` + `site/*` | 529 | via suite | **rotate-then-box** (§4-5); sector centring; setback edge mapping |

201 tests, 11 files. Overall statement coverage 52%; the modules a regression would actually hurt are 77–99%.

Deliberately **not** covered yet: `export/pdf.ts` (975 LOC, byte-level — needs a PDF parser to assert against, which is its own decision), `plan/planSheet.ts`, `export/statement.ts`, and every React component beyond the four hooks already exercised.

### D5 — ★ `strict: true` costs nothing; `noUncheckedIndexedAccess` costs 309 errors

Turning on `strict` produced **zero errors**. The codebase was written to it for its whole life without it being enabled. It is now on, so that cannot drift.

`noUncheckedIndexedAccess` produces **309 errors** (618 as reported, double-counted across projects):

| File | Errors |
|---|---|
| `blueprint/detectWalls.ts` | 212 |
| `plan/draw.ts` | 74 |
| `rooms/resolve.ts` | 62 |
| `export/pdf.ts` | 58 |
| everything else | ~212 |

Almost all are `array[i]` inside numeric loops whose index is provably in range. Silencing them with `!` would touch a module §3 marks protect-only, add ~300 assertions that each say "trust me", and teach the next reader that `!` is punctuation.

**Not enabled.** The rule is worth having on code written under it, not retrofitted with a sed script. Revisit per-directory. The reasoning is recorded in `tsconfig.app.json` itself so the next person does not rediscover it.

### D6 — Lint expanded from two rules to three categories

`correctness: error`, `suspicious: warn`, `perf: warn`, plus `no-unused-vars`, `no-explicit-any`, `eqeqeq` and `exhaustive-deps`.

Four rules turned **off**, each because it is wrong here:

| Rule | Why off |
|---|---|
| `react/react-in-jsx-scope` | React 19 with `jsx: "react-jsx"`. 24 false positives. |
| `no-await-in-loop` | Both hits are deliberate **sequential key failover**. `Promise.all` would fire every key at once and defeat the point. |
| `no-map-spread` | Advises in-place mutation. The store's immutability is load-bearing: `designChanged` is a pure reference compare, so mutating in a `map` would silently stop the undo recorder noticing edits. Actively harmful advice. |
| `import/no-named-as-default-member` | Noise on the `Anthropic.*Error` chain. |

**0 errors, 13 warnings**, all genuine advisories.

---

## Consequences

- Two shipped-quality CV bugs caught before release, by the first thing that ever exercised that code.
- `strict` on, at zero cost, permanently.
- A harness that runs in ~2 s, with no browser and no network.
- `three-stdlib` now declared (it was imported by two files and in neither dependency list).

### The thing this does NOT do

**The corpus is still missing, and that is the real Stage 1 deliverable.** Every fixture in `samples/` is generated by `gen-blueprint.mjs`, and three of the six were written in the same change set as the detector code they exercise. A green golden suite means the detector still does what it did yesterday.

[`docs/testing/corpus.md`](../testing/corpus.md) specifies the replacement: ≥50 real architect drawings, tagged on six axes (wall rendering, sheet and polarity, annotation load, geometry, dimensioning, provenance), with per-tag pass rates and per-tag floors — including `geom-angled` and `geom-curved` at an expected **0%**, tracked so the gap is sized rather than hidden.

Until that exists, no claim about detection accuracy on real drawings is supportable.

---

## Not done

| Item | Reason |
|---|---|
| CI on every push | No CI provider is configured and choosing one is an infrastructure decision. `npm test` is the seam. |
| `export/pdf.ts` coverage | Asserting on bytes needs a PDF parser; worth doing, but it is its own decision about a dependency. |
| Component tests | The 121 `data-testid` attributes are waiting. Not on the critical path for Stage 2. |
| The corpus itself | Requires real drawings, which requires someone to collect them. |
