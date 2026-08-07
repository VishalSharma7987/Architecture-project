# 14 — Open Questions

Everything I could not determine from the repository, phrased for the team, ranked by how much it blocks understanding.

---

## Tier 1 — blocks understanding of intent; cannot be answered from the code

### Q1. Was `applyPlanScale`'s unconditional overwrite intended to be conditional?

`isCalibrated()` exists ([calibration.ts:42](../../src/blueprint/calibration.ts#L42)), is exported, and is imported by exactly one file where it drives only a warning label. `applyPlanScale` ([detectOpenings.ts:126-159](../../src/blueprint/detectOpenings.ts#L126-L159)) never consults it. Its own comment says *"Must run BEFORE the walls are built, since they inherit this scale"* — which addresses ordering but is silent on the interaction with a user-supplied scale.

**Cannot be answered from the code because:** nothing in any comment, commit message (2 commits) or doc mentions the interaction. Full trace in [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md#q1).

### Q2. Is the AI edit path's destruction of furniture, rooms, stairs, plot and upper floors known?

[useDesignAI.ts:86-89](../../src/ai/useDesignAI.ts#L86-L89) calls `loadDesign({name, walls})`, and `loadDesign` defaults everything else to empty. The `generate` flow warns *"This replaces the N walls currently in the design"*; the `edit` flow carries **no warning at all** ([AIPanel.tsx:83-108](../../src/components/AIPanel.tsx#L83-L108)) and destroys strictly more.

**Cannot be answered from the code because:** the comment at [useDesignAI.ts:109-110](../../src/ai/useDesignAI.ts#L109-L110) explains why *ids* are stripped from the outbound payload, but nothing explains why only `walls` come back in.

### Q3. Did a test suite exist, and what happened to it?

Evidence it did: **121 `data-testid` attributes (100 distinct)**; `samples/blueprint-expected.json`, a golden file with no consumer; `RasterLike` defined *"so the detector runs outside a browser too"*; three README sentences describing specific tests (*"a test asserting the app makes zero external requests"*, `walkMotion.ts` *"kept separate to test"*, `wallGeometry.ts` *"kept pure and tested by mapping a box's end faces back onto the wall's original endpoints"*).

**Cannot be answered from the code because:** git history is 2 commits deep and contains no test files at any point.

### Q4. Was the codebase authored with substantial AI assistance, and does that change how it should be reviewed?

Not asked to judge quality — asked because it changes what a reviewer should check. The signals: **zero TODO/FIXME/HACK/XXX** in 21,765 LOC; uniformly long explanatory comments in a single consistent register throughout every module; 2 commits containing the entire codebase; `data-testid` coverage without tests; several dead exports that look like completeness rather than use (`SITE_RULES`, `northScreenAngle`, `buildPdfBytes`).

**Cannot be answered from the code.** It matters because the failure mode of this authorship pattern is exactly what Q1 and Q2 are: locally excellent modules with an unexamined interaction between them.

### Q5. What is the deployment target, and is the missing backend a known gap or an unstarted task?

`aiPlugin` runs only under `vite dev` ([aiPlugin.ts:121](../../server/aiPlugin.ts#L121)). This is stated twice in the source. There is no CI, no Dockerfile, no `vercel.json`, no `start` script.

**Cannot be answered from the code because:** *"a real deployment needs those two endpoints reimplemented on an actual server"* ([README.md:229](../../README.md#L229)) says what is needed and nothing about where or when.

### Q6. Why do `openingDetector.ts` and `designAgent.ts` state opposite AI policies?

`openingDetector.ts:6-8`: *"this project **deliberately does not use Claude/Anthropic**"*. `designAgent.ts:13`: `MODEL = 'anthropic/claude-sonnet-4.5'`.

**Cannot be answered from the code because:** the last commit is *"Run AI generate/edit through OpenRouter"* — so the two files may simply have been written under different constraints at different times, but nothing records which is current policy.

---

## Tier 2 — blocks safe change; answerable with a build or a run, which the audit could not perform

### Q7. Is TypeScript `strict` actually on?

Neither `tsconfig.app.json` nor `tsconfig.node.json` sets `"strict"`, and neither `extends` a base. `[U]` **Confirm with `npx tsc --showConfig`.** It determines whether the ~40 unchecked array accesses and the `as` assertions in the vision parsers are actually unchecked.

### Q8. Does `three-stdlib` resolve at build time?

Imported by [CharacterAvatar.tsx:6](../../src/scene/CharacterAvatar.tsx#L6) and [FrameBuilding.tsx:3](../../src/scene/FrameBuilding.tsx#L3); declared in **neither** `dependencies` nor `devDependencies`. `[U]` **Confirm with `npm run build`** or `ls node_modules/three-stdlib`. If drei ever drops it or a stricter package manager is used, both files break.

### Q9. Does the app currently build and run?

The audit did not execute `npm run dev`, `npm run build` or `tsc` (constraint 6). Combined with `typescript@~6.0.2` and `vite@^8.1.1` — both well ahead of typical tooling support — and the staged-but-uncommitted change set, this is genuinely unknown. `[U]`

### Q10. Can the autosave restore race the share-link load?

`App` calls `useSharedDesign()` (line 42, **async** decode) before `useAutosave({enabled: !readOnly})` (line 50, **synchronous** restore). `readOnly` only becomes `true` after the decode resolves. `[U]` **Confirm by opening a share link with a non-empty autosave draft present.** The comment at [useSharedDesign.ts:14-16](../../src/persistence/useSharedDesign.ts#L14-L16) asserts the share link wins; the code does not obviously guarantee it.

### Q11. What happens under StrictMode's double-invoked effects?

`useAutosave` guards with a module-scope `restored` flag ([:16](../../src/persistence/useAutosave.ts#L16)) — that one is safe. But `useBlueprintStructure` guards with `handled.current` (a **ref**, [:54](../../src/blueprint/useBlueprintStructure.ts#L54)), and refs survive StrictMode's double-mount **only if the component is not remounted**. `[U]` **Confirm by loading a blueprint and switching to 3D in dev** — the risk is two vision calls and two wall-build attempts.

### Q12. What is the practical share-link ceiling, and where does it fail?

`createShareLink` produces a URL of unbounded length with no check ([shareLink.ts:48-56](../../src/persistence/shareLink.ts#L48-L56)). README estimates ~800 chars for a small plan. `[U]` **Measure with a three-storey furnished design.** Failure is silent at creation and only surfaces as *"That share link is damaged or incomplete."* after transport truncation.

### Q13. At what plan size does editing become unusable?

O(n²) room detection runs 6+ times per wall edit, on the main thread ([10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md) Q9, P1). `[U]` **Measure with 50, 200 and 500 walls, all panels open.** No profiling harness exists.

### Q14. How long does a blueprint detection block the tab?

Four full binarisations plus four band pipelines over up to 4 megapixels, synchronously ([detectWalls.ts:725-745](../../src/blueprint/detectWalls.ts#L725-L745)). `[U]` **Measure with a 2000×2000 scan.** `yieldToPaint` only ensures the label paints first; it does not chunk the work.

### Q15. Does `getImageData` succeed on an SVG-sourced image?

`isImageFile` accepts `image/svg+xml` (MIME prefix match, [load.ts:47](../../src/blueprint/load.ts#L47)). `[U]` **Confirm by importing an SVG.** Canvas tainting rules for SVG images vary; the catch at [raster.ts:143-147](../../src/blueprint/raster.ts#L143-L147) would produce *"This image is not readable by the page."*

---

## Tier 3 — product and policy questions the code raises but cannot answer

### Q16. What are the licence terms for `character.glb` and the two Mixamo FBX clips?

1.18 MB + 822 KB + 1.50 MB in `public/`, no accompanying licence file. Comments identify them as a *"skinned construction-worker mesh"* on a *"Mixamo skeleton"* with *"Mixamo FBX clips"*. `[U]` **This is the only unresolved licence exposure in the project** — the npm tree is entirely permissive.

### Q17. Should the ~4 MB of binary working files at the repo root be committed?

`textures.zip`, `animations.zip`, `usd.usdc`, `stl.stl`, `glb.glb`, `fbx.fbx`, `obj.obj`/`.mtl`, `dae.dae`, `blender(construction+worker).blend`, `blueborder.webp`. **All staged**, none imported by any source file. Once committed they are permanent git history.

### Q18. Is the three-storey limit a product decision or a placeholder?

Hard-coded in four places: `FLOOR_NAMES` ([useDesignStore.ts:258](../../src/store/useDesignStore.ts#L258)), the initial `floors` array ([:720](../../src/store/useDesignStore.ts#L720)), `newDesign` ([:1136](../../src/store/useDesignStore.ts#L1136)), and `loadDesign`'s `[0,1,2].map` ([:1100](../../src/store/useDesignStore.ts#L1100)). A 4-floor file **loses floor 4 silently**. `emptyFloor(index)` already handles `index > 2` with a `Floor ${index}` fallback name, which suggests the limit is not intrinsic.

### Q19. Should stairs cut an opening in the slab above?

Currently a flight rises into a solid slab. `[X]` No code path modifies `FloorSlab` for stairs. The store explicitly declines to copy stairs upward *"the flight on this floor already rises into the one above"* ([:867-870](../../src/store/useDesignStore.ts#L867-L870)) — so the two-storey relationship is acknowledged, and the void is not.

### Q20. Is first-person walk's lack of collision intentional?

`ThirdPersonControls` uses `moveWithCollisions`; `WalkControls` does not ([WalkControls.tsx:118-143](../../src/scene/WalkControls.tsx#L118-L143)). README documents *"There is no wall collision … a deliberate omission for this milestone"* ([:138-139](../../README.md#L138-L139)) — but that statement predates `collision.ts` existing at all.

### Q21. Should the calibration input accept feet-and-inches?

Hardcoded to metres — `<span>metres</span>` ([BlueprintPanel.tsx:460](../../src/components/BlueprintPanel.tsx#L460)) and `Number(knownLength)` ([:144](../../src/components/BlueprintPanel.tsx#L144)) — in an app whose default unit is `ftin` and which owns a `parseLength` that already accepts `12'6"`. `LengthField` exists and is used elsewhere.

### Q22. What is the intended answer for Indic text in exported PDFs?

`prepareText` maps anything outside WinAnsi to `?` ([pdf.ts:248-267](../../src/export/pdf.ts#L248-L267)). The module documents an escape hatch — *"draw the text into a canvas … encode that as JPEG, and place it with `addImagePage`"* ([:41-47](../../src/export/pdf.ts#L41-L47)) — which is used for `₹` (via transliteration to `Rs.`) but for nothing else. A project or room name in Devanagari prints as question marks in the deliverable.

### Q23. Is the free vision model a permanent choice?

`'google/gemma-4-26b-a4b-it:free'` is hardcoded with its own warning: *"If this id 404s it has been renamed"* ([openingDetector.ts:21-23](../../server/openingDetector.ts#L21-L23)). A free model id is not a stable contract, and the code has no fallback list — only multiple keys for the same id.

### Q24. Should `samples/` and its golden file be wired to anything?

10 fixture blueprints, a 275-LOC generator, and `blueprint-expected.json` with no consumer. `gen-blueprint.mjs` is not referenced by any `package.json` script.

### Q25. What does `constructionRate` mean, and who sets it?

Rupees per square foot of built-up area, applied uniformly across all storeys ([statement.ts:196](../../src/export/statement.ts#L196)). Not persisted per-project in any way distinct from the rest of `settings`, not validated against any range, placeholder `1800` ([RoomSchedulePanel.tsx:428](../../src/components/RoomSchedulePanel.tsx#L428)). Whether it is meant to be a firm's standing rate or a per-project input is not recorded.

---

## Areas an external reader must not assume anything about

| Area | Why |
|---|---|
| **Runtime behaviour of any kind** | The app was never run. Every behavioural claim in this audit is read from source. |
| **`plan/planSheet.ts` beyond line 180** | 694 LOC unread `[U]`. The sheet's actual wall/dimension/title-block/scale-bar rendering is undocumented here. |
| **`scene/FurnitureModels.tsx` beyond line 80** | 273 LOC of per-type box composition unread `[U]`. |
| **`scene/RoomLabels.tsx` beyond line 70** | 179 LOC — the declutter loop and JSX — unread `[U]`. The header comment describes the algorithm; the implementation was not verified. |
| **`samples/gen-blueprint.mjs`** | 275 LOC unread. Not shipped in the app bundle. |
| **Whether `strict` is on** | Q7 |
| **Whether the build succeeds** | Q9 |
| **Git history as a signal** | 2 commits, 1 contributor. No churn signal, no bisect surface, no review trail. Every "hot spot" in this audit is size- or fan-in-based, and that substitution is stated wherever it appears. |
| **The uncommitted working tree** | 31 files staged, `+27,338 / −550`. This audit describes the **working tree**. `HEAD` is a materially different codebase — `src/scene/Avatar.tsx` exists there and `CharacterAvatar.tsx` differs. |
