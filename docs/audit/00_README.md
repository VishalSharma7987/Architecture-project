# Space Designer — Codebase Audit

**Audit date:** 2026-08-07
**Commit audited:** `8e1d02de35cd692c3eaed89018d7b167dfc7d0f7` (branch `main`)
**Working-tree state:** 31 files staged-but-uncommitted (`+27,338 / −550`). **This audit describes the WORKING TREE, not HEAD.** `[V]` `git status --short`, `git diff --cached --stat`
**Auditor role:** read-only documentation pass. No file outside `/docs/audit/` was created, edited, or deleted.

---

## Coverage statement `[V]`

| Metric | Value |
|---|---|
| Source files in scope (`.ts`/`.tsx`/`.mjs` under `src/`, `server/`, `samples/`) | 83 |
| Files read **in full** | 77 |
| Files read **in part** | 3 |
| Files **not read** | 3 |
| Approximate LOC read | ~20,300 of 21,765 (**~93%**) |

**Read in part** (rest marked `[U]`):

| File | LOC | Read |
|---|---|---|
| [src/plan/planSheet.ts](../../src/plan/planSheet.ts) | 874 | lines 1–180 (types, `renderPlanSheet` entry, layout constants). Body of `drawWalls`/`drawDimensions`/`drawTitleBlock`/`drawScaleBar`/`drawNorthArrow` `[U]` |
| [src/scene/FurnitureModels.tsx](../../src/scene/FurnitureModels.tsx) | 353 | lines 1–80 (`FurnitureModels`, `Piece`). Per-type `Model` box compositions `[U]` |
| [src/scene/RoomLabels.tsx](../../src/scene/RoomLabels.tsx) | 249 | lines 1–70 (doc comment, constants, hook head). Declutter loop and JSX `[U]` |

**Not read:**

| File | LOC | Reason |
|---|---|---|
| [samples/gen-blueprint.mjs](../../samples/gen-blueprint.mjs) | 275 | Test-fixture generator, not shipped in the app bundle. Its output (`samples/*.svg`) is a dev asset. |
| [src/index.css](../../src/index.css) | 23 | Tailwind entry only. |
| [samples/README.md](../../samples/README.md) | — | Fixture documentation. |

---

## Confidence in this audit

**High confidence** `[V]` — statements about: the store's shape and every action on it; the persistence/serialisation contract; every AI call site, prompt and parse path; the calibration write-path (Q1); wall/room/opening geometry; the 2D editor's pointer and paint pipeline; the collision and walk systems; the Vastu ruleset and analysis; the plot/setback maths.

**Medium confidence** `[I]`/`[U]` — statements about: what the print sheet actually renders (partial read); furniture 3D model geometry (partial read); runtime behaviour under React StrictMode double-invocation (reasoned from code, not observed — **the app was never run**, per the audit constraints).

**Low confidence / explicitly unknown** — everything in [14_OPEN_QUESTIONS.md](14_OPEN_QUESTIONS.md).

### Things this audit could NOT establish

1. `[U]` **Whether the app builds or runs.** `npm run build`, `npm run dev`, and `tsc` were not executed (audit constraint 6). Every claim about behaviour is read from source.
2. `[X]` **Any runtime evidence at all.** There are no tests, no CI, no logs, no screenshots in the repo.
3. `[U]` **Whether TypeScript `strict` is on.** Neither `tsconfig.app.json` nor `tsconfig.node.json` sets `"strict"`, and neither `extends` a base. Confirmable with `npx tsc --showConfig`.
4. `[X]` **Churn/hotspot analysis.** Git history has **2 commits** and **1 contributor**, so churn carries no signal. File size is used as the complexity proxy throughout, and this substitution is stated wherever it appears.

---

## Index

| File | Contents |
|---|---|
| [01_PROJECT_OVERVIEW.md](01_PROJECT_OVERVIEW.md) | What the software is, claimed vs implemented |
| [02_TECH_STACK.md](02_TECH_STACK.md) | Every dependency, what it is actually used for, licence risk |
| [03_FOLDER_STRUCTURE.md](03_FOLDER_STRUCTURE.md) | Annotated tree, hot spots |
| [04_CURRENT_ARCHITECTURE.md](04_CURRENT_ARCHITECTURE.md) | Architecture diagram, module inventory, boundary violations |
| [05_DATA_MODEL.md](05_DATA_MODEL.md) | Every core type verbatim, relationships, serialisation |
| [06_DATA_FLOW.md](06_DATA_FLOW.md) | Flow diagrams per user journey |
| [07_CURRENT_FEATURES.md](07_CURRENT_FEATURES.md) | 26 Subsystem Cards + the Q11 completion matrix |
| [08_IMPORT_PIPELINE.md](08_IMPORT_PIPELINE.md) | Image import stage by stage; PDF/DWG/DXF absence |
| [09_AI_INVENTORY.md](09_AI_INVENTORY.md) | Q2 in full: call sites, prompts, parsing, failure, cost |
| [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md) | Q5/Q6/Q9/Q10 + every bug found, by blast radius |
| [11_TECH_DEBT.md](11_TECH_DEBT.md) | Duplication, god files, magic numbers, coupling |
| [12_STRENGTHS.md](12_STRENGTHS.md) | What is genuinely well built, and why |
| [13_GAPS.md](13_GAPS.md) | What professional CAD/BIM has that this has no trace of |
| [14_OPEN_QUESTIONS.md](14_OPEN_QUESTIONS.md) | Everything undetermined, ranked by how much it blocks |

Answers to the targeted investigations live where they belong:
Q1 → [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md#q1) · Q2 → [09_AI_INVENTORY.md](09_AI_INVENTORY.md) ·
Q3, Q4 → [09_AI_INVENTORY.md](09_AI_INVENTORY.md) · Q5–Q7, Q9, Q10 → [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md) ·
Q6 (dead code) also → [11_TECH_DEBT.md](11_TECH_DEBT.md) · Q8 → [05_DATA_MODEL.md](05_DATA_MODEL.md) ·
Q11 → [07_CURRENT_FEATURES.md](07_CURRENT_FEATURES.md) · Q12 → [02_TECH_STACK.md](02_TECH_STACK.md)

## Evidence tags used throughout

| Tag | Meaning |
|---|---|
| `[V]` | Verified — the code that does this was read; a `file:line` citation follows |
| `[I]` | Inferred from naming/structure/usage; the basis is stated |
| `[U]` | Unverified belief; what would confirm it is stated |
| `[X]` | Absent — searched and not found; the search is stated |
