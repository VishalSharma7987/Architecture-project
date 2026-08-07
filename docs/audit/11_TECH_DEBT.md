# 11 — Technical Debt

Observations with locations. No fixes proposed. Duplication (Q5) and dead code (Q6) are catalogued in full in [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md); this file records the rest and cross-references.

---

## 1. Missing tests — the largest single debt

`[X]` **Zero tests. Zero test infrastructure. Zero CI.**

The exposure, by module, ranked by "how badly a silent regression here would hurt":

| Module | LOC | Why it needs tests | Currently verified by |
|---|---|---|---|
| [export/pdf.ts](../../src/export/pdf.ts) | 975 | Byte-level file format. A wrong xref offset produces *"a file that some viewers open and others reject outright, which is the worst kind of bug to find later"* — the author's own words at [:824-828](../../src/export/pdf.ts#L824-L828) | nothing |
| [blueprint/detectWalls.ts](../../src/blueprint/detectWalls.ts) | 851 | Nine tuning constants, four binarisation strategies, a scoring heuristic. `RasterLike` exists *"so the detector runs outside a browser too"* ([:100](../../src/blueprint/detectWalls.ts#L100)) — i.e. it was designed to be testable. `samples/blueprint-expected.json` is the golden file that was going to test it. | nothing |
| [persistence/schema.ts](../../src/persistence/schema.ts) | 499 | **The single validation gate for every untrusted input**, including AI output. Its malformed-vs-odd distinction has ~15 branches. | nothing |
| [scene/wallGeometry.ts](../../src/scene/wallGeometry.ts) | 313 | `rotationY = atan2(-dz, dx)` — *"easy to get backwards and invisible on a symmetric layout"* ([:19-24](../../src/scene/wallGeometry.ts#L19-L24)). README claims it is *"kept pure and tested by mapping a box's end faces back onto the wall's original endpoints"* ([README.md:285-286](../../README.md#L285-L286)) — **that test does not exist**. | nothing |
| [plan/rooms.ts](../../src/plan/rooms.ts) | 251 | Planar-graph face traversal with half-edge angular ordering and a winding-sign filter. Every area, cost and Vastu figure depends on it. | nothing |
| [units/length.ts](../../src/units/length.ts) | 254 | Five regexes parsing `12'6"`, `12'-6"`, `6 3/4"`, `381cm`. Feeds every typed dimension. | nothing |
| [scene/collision.ts](../../src/scene/collision.ts) | 301 | Swept-circle separation with an inside-the-box degenerate branch. | nothing |
| [vastu/analyse.ts](../../src/vastu/analyse.ts) | 399 | Sutherland-Hodgman clipping and a tie-break rule. | nothing |
| [scene/walkMotion.ts](../../src/scene/walkMotion.ts) | 68 | Explicitly *"kept separate to test"* ([README.md:190](../../README.md#L190)). | nothing |

**~3,900 LOC of pure, deliberately-testable algorithm with no test.** The seams were built; nothing was hung on them.

Supporting evidence that a suite once existed or was planned: **121 `data-testid` attributes (100 distinct)**, `samples/blueprint-expected.json`, `RasterLike`'s browser-free shape, and three README sentences describing specific tests. `[U]` Whether the suite was removed or never written cannot be determined from this repository — the git history is 2 commits deep.

---

## 2. God files

| File | LOC | Distinct responsibilities |
|---|---|---|
| [plan/draw.ts](../../src/plan/draw.ts) | 1,658 | **17 paint layers** + `pickStair` (a hit test) + `siteFrame` (plot geometry resolution) + 6 constant blocks (`COLORS`, `DIMENSION`, `ROOM`, `VASTU`, `PLOT`, `STAIR`) + `TREAD_COUNT` (a third copy of the stair maths) |
| [store/useDesignStore.ts](../../src/store/useDesignStore.ts) | 1,328 | Every core type · every constant · ~50 actions · the floor check-out mechanism · the undo recorder · four module-scope history variables |
| [export/pdf.ts](../../src/export/pdf.ts) | 975 | Font metrics tables · WinAnsi transliteration · text wrapping · table pagination with repeating headers · JPEG header parsing · object/xref/trailer serialisation |
| [components/InspectorPanel.tsx](../../src/components/InspectorPanel.tsx) | 887 | Five inspectors (wall/opening, floor, furniture, room, stair) · `WallLengthField` · `flightSteps` · `COMFORT` rules · `PanelShell` |
| [plan/planSheet.ts](../../src/plan/planSheet.ts) | 874 | A second complete renderer + scale-bar selection + title block + north arrow |
| [blueprint/detectWalls.ts](../../src/blueprint/detectWalls.ts) | 851 | Otsu · 4 mask strategies · transpose · run-length + union-find · band measurement · collinear merge · face fusion · junction snapping · scoring · coordinate mapping |
| [components/Toolbar.tsx](../../src/components/Toolbar.tsx) | 665 | Two toolbar tiers · `Segmented` · `FloorSelector` · `PanelsMenu` (with a portal and two window listeners) · `Divider` |
| [components/ProjectsMenu.tsx](../../src/components/ProjectsMenu.tsx) | 655 | Save/load/delete/new/import + **six** export actions + two dropdown layers + `MenuAction` + `ExportGroup` |
| [components/BlueprintPanel.tsx](../../src/components/BlueprintPanel.tsx) | 612 | Upload · appearance · **calibration** · CV detection · AI detection · two destructive resets |
| [blueprint/detectOpenings.ts](../../src/blueprint/detectOpenings.ts) | 544 | Vision fetch · **`applyPlanScale` (writes the design scale)** · opening placement · room naming · furniture placement · fixture quick-fill · `fitToRoom` · JPEG re-encode |

`[V]` Ten files over 500 LOC account for **8,949 LOC — 41% of the codebase.**

---

## 3. Duplicated logic

Sixteen instances, catalogued in full as **Q5** in [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md). The ones that will hurt most:

| Rank | Duplication | Why it matters |
|---|---|---|
| 1 | Two full plan renderers (`draw.ts` / `planSheet.ts`, 2,532 LOC combined) | Any change to how the plan looks must be made twice, in two different vocabularies |
| 2 | Three sources of truth for the stair tread count (`InspectorPanel.flightSteps`, `Stairs.flightSteps`, `draw.TREAD_COUNT`) | Two of the three use different key names for the same value (`riser` vs `rise`) |
| 3 | Duplicated `PlanAnalysis`/`RawOpening`/`RawLabel`/`PlanBox` across the `server`↔`src` boundary | A field added on one side is silently dropped on the other. This is the cost of an otherwise-correct boundary. |
| 4 | Two "walk" controllers with **different physics** | One collides, one does not |
| 5 | `clamp` ×5, `wallLength` ×3, `isTextEntry` ×3 (one subtly different), `triggerDownload` ×3 (one with a latent bug the other two were written to avoid) | Small, but the `triggerDownload` case shows the pattern: a fix applied to one copy does not reach the others |

---

## 4. Dead code

Ten dead exports, six dead parameters/branches, and ~4 MB of unreferenced binary assets — catalogued as **Q6** in [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md).

Worth singling out, because they are misleading rather than merely unused:

| Item | Why it misleads |
|---|---|
| `clearAutosave` — [storage.ts:127](../../src/persistence/storage.ts#L127) | Its existence implies the draft is cleared somewhere. **It never is** — not by `newDesign`, not by loading a project. |
| `serializeDesign`'s `stairs?` param — [schema.ts:76](../../src/persistence/schema.ts#L76) | Four call sites carefully pass `floors[0].stairs`. The parameter does nothing. |
| `aiPlugin(_anthropicKey, …)` — [aiPlugin.ts:77](../../server/aiPlugin.ts#L77) | `vite.config.ts` still reads `ANTHROPIC_API_KEY` from the environment and passes it. `.env.example` still documents it. It is discarded. |
| The four `Anthropic.*Error` branches — [aiPlugin.ts:56-67](../../server/aiPlugin.ts#L56-L67) | They look like the error-handling strategy. They are unreachable, so **every real upstream failure falls through to the generic 500**. |
| `SITE_RULES`, `BRAHMASTHAN_RULE` — [ruleset.ts:130,156](../../src/vastu/ruleset.ts#L130) | Exported alongside the rules that *are* used, suggesting the analysis covers water tanks. It does not. |
| `clearWalls` — [useDesignStore.ts:1212](../../src/store/useDesignStore.ts#L1212) | Sits in the public `DesignState` interface next to the `clearFloor` that replaced it. |

---

## 5. Hardcoded values and magic numbers

### Well-handled — named, centralised, and reasoned

`[V]` Genuinely good practice, worth recording as a counterweight:

| Location | What |
|---|---|
| [scene/config.ts](../../src/scene/config.ts) | 9 named blocks (`CAMERA`, `CONTROLS`, `GRID`, `GROUND`, `WALL`, `SELECTION`, `SLAB`, `WALK`, `AVATAR`, `DOOR`, `BLUEPRINT`), each value carrying a comment explaining *why* that number |
| [useDesignStore.ts:186-213](../../src/store/useDesignStore.ts#L186-L213) | `BLUEPRINT_DEFAULTS`, `WALL_DEFAULTS`, `OPENING_DEFAULTS`, `LIMITS` |
| [detectWalls.ts:52-62](../../src/blueprint/detectWalls.ts#L52-L62) | `DEFAULT_DETECT_OPTIONS` — 9 knobs, each documented, and **rescaled by image size** rather than fixed |
| [draw.ts:41-211](../../src/plan/draw.ts#L41-L211) | `COLORS`, `DIMENSION`, `ROOM`, `VASTU`, `PLOT`, `STAIR` — every threshold in screen pixels with a stated reason |
| [pdf.ts:352-367](../../src/export/pdf.ts#L352-L367) | `STYLE` |

### Not centralised — magic numbers at their point of use

| Value | Site | What it controls |
|---|---|---|
| `7` | [FloorPlanEditor.tsx:32](../../src/plan/FloorPlanEditor.tsx#L32) `HIT_TOLERANCE_PX` | Named, but local to one file |
| `200`, `100` | [useDesignStore.ts:698,705](../../src/store/useDesignStore.ts#L698) | Undo coalesce window and history depth — named, but buried in the store |
| `2.2` | [detectOpenings.ts:31](../../src/blueprint/detectOpenings.ts#L31) `SNAP_TOLERANCE_M` | How far an AI-placed opening may be from a wall |
| `0.15` | [detectOpenings.ts:39](../../src/blueprint/detectOpenings.ts#L39) `FURNITURE_MARGIN_M` | |
| `1100`, `0.82` | [detectOpenings.ts:20,539](../../src/blueprint/detectOpenings.ts#L539) | Vision-upload dimension and JPEG quality |
| `[0.6,1.4]`, `[0.5,3.0]` | [detectOpenings.ts:491-494](../../src/blueprint/detectOpenings.ts#L491-L494) `OPENING_BAND_M` | The believability band for AI widths |
| `0.9`, `1.2` | [detectOpenings.ts:482-485](../../src/blueprint/detectOpenings.ts#L482-L485) `OPENING_DEFAULT_M` | **Duplicates `OPENING_DEFAULTS` in the store** — two tables of the same fact |
| `6500`, `8000` | [useBlueprintStructure.ts:132](../../src/blueprint/useBlueprintStructure.ts#L132) | Banner dismissal timers, inline |
| `4000` | [useAutosave.ts:6](../../src/persistence/useAutosave.ts#L6) | Named and exported |
| `2` | [openingDetector.ts:36](../../server/openingDetector.ts#L36) `ATTEMPTS_PER_KEY` | |
| `1_000_000`, `8_000_000` | [aiPlugin.ts:19,23](../../server/aiPlugin.ts#L19) | Body caps |
| `6000`, `1200` | [designAgent.ts:15](../../server/designAgent.ts#L15), [openingDetector.ts:26](../../server/openingDetector.ts#L26) | `max_tokens` |
| `3000×2121`, `0.92` | [documents.ts:65,77](../../src/export/documents.ts#L65) | Print raster size and JPEG quality — both well-commented |
| `2000×1414` | [imageExport.ts:10](../../src/persistence/imageExport.ts#L10) | PNG sheet size — **a different sheet size from the PDF's**, by design |
| `30 sq ft` | [RoomLabels.tsx:31](../../src/scene/RoomLabels.tsx#L31) | Minimum area for an unnamed 3D caption |
| `72/30`, `84/24` | [DimensionLabels.tsx:15-16](../../src/scene/DimensionLabels.tsx#L15-L16), RoomLabels | Two different declutter boxes for two overlays that share a design |
| `0.10`–`0.14` alpha | [rooms/catalog.ts:10-25](../../src/rooms/catalog.ts#L10-L25) | Room tints |

### Hardcoded strings that are policy, not presentation

| Value | Site | Note |
|---|---|---|
| `'anthropic/claude-sonnet-4.5'` | [designAgent.ts:13](../../server/designAgent.ts#L13) | Model id. Not configurable. |
| `'google/gemma-4-26b-a4b-it:free'` | [openingDetector.ts:23](../../server/openingDetector.ts#L23) | Model id, with a comment warning it will eventually 404 |
| `'https://openrouter.ai/api/v1/chat/completions'` | both server files | Duplicated endpoint constant |
| `'space-design.projects.v1'`, `'space-design.autosave.v1'` | [storage.ts:3-4](../../src/persistence/storage.ts#L3-L4) | Versioned keys — good |
| `'#design='` | [shareLink.ts:13](../../src/persistence/shareLink.ts#L13) | |
| `'/character.glb'`, `'/animations/Walking.fbx'`, `'/animations/Idle.fbx'` | [CharacterAvatar.tsx:21-23](../../src/scene/CharacterAvatar.tsx#L21-L23) | |
| `'metres'` | [BlueprintPanel.tsx:460](../../src/components/BlueprintPanel.tsx#L460) | **The calibration input's unit is hardcoded** in an app whose default display unit is ft-in and which owns a parser that accepts `12'6"` |
| `['Ground Floor','First Floor','Second Floor']` | [useDesignStore.ts:258](../../src/store/useDesignStore.ts#L258) | The three-floor limit, expressed as an array literal |

---

## 6. Tight coupling

| # | Coupling | Evidence |
|---|---|---|
| **C1** | **59 of 80 `src/` files reference `useDesignStore`** | Any change to `Wall` or `Point` reaches three-quarters of the codebase. `[V]` `grep -rl useDesignStore src \| wc -l` |
| **C2** | **`useBlueprintStructure` is mounted in `App` and fires on a *view-mode change*** | A component-tree hook, keyed on `viewMode`, that makes a network call and writes the design scale. There is no way to switch to 3D without arming it. [App.tsx:45](../../src/App.tsx#L45), [useBlueprintStructure.ts:118](../../src/blueprint/useBlueprintStructure.ts#L118) |
| **C3** | **`detectOpenings.ts` reaches into the store six times** | `updateBlueprint`, `addOpening`, `updateOpening`, `nameRoom`, `addFurniture`, `updateFurniture`. A module named "detect" is a mutator. |
| **C4** | **`FURNITURE_DRAG_TYPE` couples both viewports to a UI panel's module** | [FurniturePanel.tsx:11](../../src/components/FurniturePanel.tsx#L11) ← `SceneCanvas`, `FloorPlanEditor` |
| **C5** | **`scene/config.BLUEPRINT` couples the calibration clamp to the 3D scene's tuning file** | [config.ts:121-126](../../src/scene/config.ts#L121-L126) ← `BlueprintPanel` only |
| **C6** | **`plan/draw.ts` imports `SELECTION` from `scene/config.ts`** | A 2D renderer depending on 3D config |
| **C7** | **`vastu/zones.ts` imports `planBounds` from `scene/wallGeometry`** | Pure analysis depending on a module named for the 3D scene. `wallGeometry` is in fact viewport-agnostic — the **name and location** are the coupling, not the dependency. |
| **C8** | **`statement.ts` index-aligns `names[i]` to `report.rooms[i]`** | [statement.ts:321-330](../../src/export/statement.ts#L321-L330). Correct only while `resolveRooms` and `analyseVastu` preserve the same order. Nothing enforces it. |
| **C9** | **`avatarState` is written by two controllers and read by two consumers, with no ownership** | [avatarState.ts](../../src/scene/avatarState.ts) |
| **C10** | **`FurniturePanel` imports from `blueprint/detectOpenings`** | Two deterministic fixture-placement functions live in the AI-detection module |
| **C11** | **The undo recorder is a module-scope singleton coupled to one store instance** | [useDesignStore.ts:710-712, 1276-1280](../../src/store/useDesignStore.ts#L1276-L1280) |
| **C12** | **The "checked-out floor" pattern couples ~30 call sites to a documented invariant** | `floors[activeFloor]` is *"deliberately allowed to go stale"* ([useDesignStore.ts:311-321](../../src/store/useDesignStore.ts#L311-L321)). Correctness depends on every reader remembering to use `allFloors()`. `[V]` Six call sites do; `Toolbar.FloorSelector` needed a comment explaining why ([Toolbar.tsx:452-456](../../src/components/Toolbar.tsx#L452-L456)). |

---

## 7. Documentation debt

| # | Item |
|---|---|
| **D1** | **The README is ~6 milestones stale** and contains **10 statements the code contradicts** — catalogued as C1–C10 in [01_PROJECT_OVERVIEW.md](01_PROJECT_OVERVIEW.md). Three of them describe **tests that do not exist**. |
| **D2** | **The README's `Layout` section omits 6 of 14 source folders** — `blueprint/`, `vastu/`, `export/`, `rooms/`, `site/`, `units/` (~5,300 LOC) |
| **D3** | **Two server modules state opposite AI policies** — `openingDetector.ts:6-8` vs `designAgent.ts:13` |
| **D4** | **`schema.ts` documents a migration mechanism that does not exist** ([:33-35](../../src/persistence/schema.ts#L33-L35)) |
| **D5** | **`.env.example` documents `ANTHROPIC_API_KEY` as *"Only used by the AI generate/edit features"*** — it is used by nothing |
| **D6** | **`[X]` No architecture doc, no ADRs, no CONTRIBUTING, no CHANGELOG.** The *only* durable design rationale is in source comments — which are unusually good (see [12_STRENGTHS.md](12_STRENGTHS.md)) but are per-function, not per-system. |
| **D7** | **The blueprint panel's "no walls found" message is stale**: *"hatched, outlined, or angled ones are invisible to it"* ([BlueprintPanel.tsx:533-536](../../src/components/BlueprintPanel.tsx#L533-L536)) — but `mergeWallFaces` ([detectWalls.ts:631-687](../../src/blueprint/detectWalls.ts#L631-L687)) now handles outlined walls specifically. |

---

## 8. Type-safety debt

| # | Item | Evidence |
|---|---|---|
| **T1** | **`strict` is not set** in `tsconfig.app.json` or `tsconfig.node.json`, and neither `extends` a base. `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` are on; `strict`, `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess` are absent. `[U]` Confirmable with `npx tsc --showConfig`. |
| **T2** | **`three-stdlib` is imported but not declared** in `package.json` — it resolves only as a hoisted transitive of drei. [CharacterAvatar.tsx:6](../../src/scene/CharacterAvatar.tsx#L6), [FrameBuilding.tsx:3](../../src/scene/FrameBuilding.tsx#L3) |
| **T3** | **`DesignResult.walls` is `unknown[]`** and returned from the server unvalidated ([designAgent.ts:106-110](../../server/designAgent.ts#L106-L110)). Safe in practice because the **client** validates — but the server's contract is untyped. |
| **T4** | **Array indexing is unchecked throughout** — `picks[0]`, `polygon[0]`, `both[1]`, `FACINGS[index]`, `box[0].minX`, `floors[0].stairs`. Each is guarded by a preceding length check or a total function, but `noUncheckedIndexedAccess` would flag every one. |
| **T5** | **`as` assertions in the vision parsers** — `{ type, x, y, width } as RawOpening` ([openingDetector.ts:116,125](../../server/openingDetector.ts#L116)), `{x0,y0,x1,y1} as PlanBox` ([:166](../../server/openingDetector.ts#L166)). The preceding `typeof` checks make them sound; the assertion still defeats the checker. |
| **T6** | **`allFloors` takes a structural subset rather than `DesignState`**, so it can be called with a hand-built object ([Toolbar.tsx:454](../../src/components/Toolbar.tsx#L454), [Building.tsx:44](../../src/scene/Building.tsx#L44), [RoomSchedulePanel.tsx:68-75](../../src/components/RoomSchedulePanel.tsx#L68-L75)) — flexible, but nothing checks that the caller passed *the current* values. |
| **T7** | **Lint covers two rules.** `.oxlintrc.json` enables `react/rules-of-hooks` and `react/only-export-components`. `[X]` No `no-unused-vars`, no exhaustive-deps, no import restrictions. One `eslint-disable-next-line react-hooks/exhaustive-deps` exists at [SceneCanvas.tsx:56](../../src/scene/SceneCanvas.tsx#L56) — for a rule that is not enabled. |

---

## 9. Operational debt

| # | Item |
|---|---|
| **O1** | **No production backend.** The three `/api/ai/*` endpoints exist only under `vite dev`. [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md) #4. |
| **O2** | `[X]` **No CI, no deployment config, no container, no infra of any kind.** `ls -a` shows no `.github/`, `.gitlab-ci.yml`, `Dockerfile`, `vercel.json`, `netlify.toml`, `Procfile`. |
| **O3** | `[X]` **No error reporting, no analytics, no logging.** The only observability is `console.error('[ai]', error)` at [aiPlugin.ts:114,172](../../server/aiPlugin.ts#L114) — server-side, in dev only. |
| **O4** | **No cost controls on a paid model.** No token counting, no cache, no rate limit, no budget. [09_AI_INVENTORY.md](09_AI_INVENTORY.md). |
| **O5** | **~4 MB of binary working files staged for commit at the repo root** — `textures.zip`, `animations.zip`, `usd.usdc`, `stl.stl`, `glb.glb`, `fbx.fbx`, `obj.obj`/`.mtl`, `dae.dae`, `.blend`, `.webp` — none imported by any source file. Once committed, they are permanent git history. |
| **O6** | **Asset licences unresolved** — `character.glb` and the two Mixamo `.fbx` clips carry no licence file. [02_TECH_STACK.md](02_TECH_STACK.md). |
| **O7** | **Two commits, one contributor.** No review history, no bisect surface, no blame signal. Churn-based hotspot analysis is impossible. |
| **O8** | **`.env` is present in the working tree** and correctly gitignored ([.gitignore:24-26](../../.gitignore)) `[V]`. Its keys were not read.
