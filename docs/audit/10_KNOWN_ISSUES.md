# 10 — Known Issues

Observations only. Ordered by blast radius within each section.

---

<a id="q1"></a>
## Q1 — The calibration write-path ★

### The complete table

There is **exactly one** conversion factor between image space and the real world in the entire model: **`Blueprint.metresPerPixel`** ([useDesignStore.ts:179](../../src/store/useDesignStore.ts#L179)). Everything else is already metric.

Every site that reads or writes it, from `grep -rn "metresPerPixel" src` `[V]`:

| # | file:line | R/W | Triggered by | Overwrites existing? |
|---|---|---|---|---|
| 1 | [store/useDesignStore.ts:179](../../src/store/useDesignStore.ts#L179) | **decl** | type definition | — |
| 2 | [store/useDesignStore.ts:188](../../src/store/useDesignStore.ts#L188) | **decl** | `BLUEPRINT_DEFAULTS.metresPerPixel = 0.01` | — |
| 3 | [store/useDesignStore.ts:455, 992-1003](../../src/store/useDesignStore.ts#L992-L1003) | **W** (the only mutator) | `updateBlueprint(patch)` — no guard, no validation, spreads the patch | **YES, unconditionally** |
| 4 | [blueprint/load.ts:21,30](../../src/blueprint/load.ts#L21) | **W** | user picks an image file (panel or Import) | Yes — but it is a fresh `setBlueprint`, so there is nothing to overwrite |
| 5 | [components/BlueprintPanel.tsx:151-171](../../src/components/BlueprintPanel.tsx#L151-L171) | **W** | **user clicks "Set scale"** — the manual calibration | Yes, deliberately. Clamped `[1e-5, 1]`. Calls `markCalibrated(src)`. |
| 6 | **[blueprint/detectOpenings.ts:144-153](../../src/blueprint/detectOpenings.ts#L144-L153)** | **W ★** | `applyPlanScale(analysis)` — reached **only** from the 2D→3D auto-build | **YES — and it never checks whether the user has already calibrated.** No clamp. |
| 7 | [blueprint/detectOpenings.ts:174](../../src/blueprint/detectOpenings.ts#L174) | R | `placeOpenings` — normalized point → world | — |
| 8 | [blueprint/detectOpenings.ts:272-273](../../src/blueprint/detectOpenings.ts#L272) | R | `toWorld` — used by `placeRooms` and `placeFurniture` | — |
| 9 | [blueprint/buildStructure.ts:58](../../src/blueprint/buildStructure.ts#L58) | R | auto-build → `segmentsToWalls({metresPerPixel: mpp / raster.scale})` | — |
| 10 | [components/BlueprintPanel.tsx:204](../../src/components/BlueprintPanel.tsx#L204) | R | manual "Detect walls" → same `/ raster.scale` division | — |
| 11 | [blueprint/detectWalls.ts:842-849](../../src/blueprint/detectWalls.ts#L842-L849) | R (param) | `segmentsToWalls` — pixel segment → world metres. **This is where the number becomes permanent geometry.** | — |
| 12 | [plan/draw.ts:236, 349-350](../../src/plan/draw.ts#L349) | R | painting the underlay | — |
| 13 | [plan/FloorPlanEditor.tsx:128](../../src/plan/FloorPlanEditor.tsx#L128) | R | passing it into `drawPlan` | — |
| 14 | [plan/FloorPlanEditor.tsx:313-314](../../src/plan/FloorPlanEditor.tsx#L313) | R | `fitToBounds` after the image decodes | — |
| 15 | [components/BlueprintPanel.tsx:74-77, 397-398](../../src/components/BlueprintPanel.tsx#L397) | R | the `1 px = N cm` readout | — |
| 16 | [scene/config.ts:124-125](../../src/scene/config.ts#L124-L125) | **decl** | `BLUEPRINT.min/maxMetresPerPixel = 1e-5 / 1` — read by site 5 only | — |

**Two writers set the scale from a measurement: site 5 (manual) and site 6 (AI). Only site 5 records that it happened.**

The "was this calibrated?" flag: `calibratedSrc`, a module-scope `string | null` in [calibration.ts:28](../../src/blueprint/calibration.ts#L28). `[V]` Its complete usage:

```
calibration.ts:38   markCalibrated(src)  → calibratedSrc = src        ← ONE writer
calibration.ts:42   isCalibrated(src)    → calibratedSrc === src      ← ONE reader
BlueprintPanel.tsx:105   const calibrated = isCalibrated(blueprint.src)
BlueprintPanel.tsx:173   markCalibrated(blueprint.src)
```

**`isCalibrated` is imported by exactly one file**, and there it drives only two warning labels ([:401-406](../../src/components/BlueprintPanel.tsx#L401-L406), [:491-495](../../src/components/BlueprintPanel.tsx#L491-L495)) and the wording of one button. **No write path consults it.**

### The call chain: manual calibration → switch to 3D

Quoting the code at each step.

**Step 0 — the user calibrates.** [BlueprintPanel.tsx:143-179](../../src/components/BlueprintPanel.tsx#L143-L179)

```ts
const applyCalibration = () => {
  const typed = Number(knownLength)
  if (!blueprint || measured <= 0) return
  if (!Number.isFinite(typed) || typed <= 0) { …error…; return }

  const metresPerPixel = Math.min(
    BLUEPRINT.maxMetresPerPixel,
    Math.max(BLUEPRINT.minMetresPerPixel,
             blueprint.metresPerPixel * (typed / measured)),
  )
  const factor = metresPerPixel / blueprint.metresPerPixel
  const anchor = picks[0]

  updateBlueprint({
    metresPerPixel,
    origin: { x: anchor.x - (anchor.x - blueprint.origin.x) * factor,
              z: anchor.z - (anchor.z - blueprint.origin.z) * factor },
  })

  markCalibrated(blueprint.src)      // ← the ONLY record that this happened
  …
}
```

State now: `blueprint.metresPerPixel` = the measured value. `calibratedSrc` = this image's object URL. `walls.length` = **0** (the user has calibrated but not yet traced — the panel's own recommended order is *"load the image, calibrate it against a distance you know, then either trace it by hand … or let detection propose walls"* [:80-86](../../src/components/BlueprintPanel.tsx#L80-L86)).

**Step 1 — the user clicks "3D".** [Toolbar.tsx:329-335](../../src/components/Toolbar.tsx#L329-L335) → `setViewMode('3d')` → [useDesignStore.ts:784-785](../../src/store/useDesignStore.ts#L784-L785).

**Step 2 — `App` re-renders; `useBlueprintStructure`'s effect re-runs.** Its dep array is `[viewMode, blueprintSrc, blueprintVisible]` ([useBlueprintStructure.ts:118](../../src/blueprint/useBlueprintStructure.ts#L118)).

```ts
// src/blueprint/useBlueprintStructure.ts:56-66
useEffect(() => {
  if (viewMode !== '3d' || !blueprintSrc || !blueprintVisible) return   // passes
  if (handled.current === blueprintSrc) return                          // passes (first time)

  if (useDesignStore.getState().walls.length > 0) {                     // ★ THE ONLY GUARD
    handled.current = blueprintSrc
    return
  }
  handled.current = blueprintSrc
  let live = true
  void (async () => {
```

`walls.length === 0`, so **the guard does not fire.**

**Step 3 — the vision call.**
```ts
// :72-76
setPhase({ kind: 'reading' })
const analysis = await analyseBlueprint()
if (!live) return
```
→ `POST /api/ai/openings` → `gemma-4-26b-a4b-it:free` → `PlanAnalysis {widthFeet, depthFeet, box, …}`.

**Step 4 — ★ the overwrite.**
```ts
// :77-81
// 2. Size the blueprint to its real dimensions, before the walls inherit
// the scale. Guessed when the plan carried no legible dimension.
const scale: ScaleSource = analysis.ok
  ? applyPlanScale(analysis.analysis)
  : { kind: 'guess' }
```

```ts
// src/blueprint/detectOpenings.ts:126-159
export function applyPlanScale(analysis: PlanAnalysis): ScaleSource {
  const blueprint = useDesignStore.getState().blueprint
  if (!blueprint || !analysis.box) return { kind: 'guess' }

  const spanX = (analysis.box.x1 - analysis.box.x0) * blueprint.width
  const spanZ = (analysis.box.y1 - analysis.box.y0) * blueprint.height

  const estimates: number[] = []
  if (analysis.widthFeet && spanX > 0) estimates.push((analysis.widthFeet * 0.3048) / spanX)
  if (analysis.depthFeet && spanZ > 0) estimates.push((analysis.depthFeet * 0.3048) / spanZ)
  if (estimates.length === 0) return { kind: 'guess' }

  const metresPerPixel = estimates.reduce((a, b) => a + b, 0) / estimates.length
  useDesignStore.getState().updateBlueprint({
    metresPerPixel,
    origin: { x: -(blueprint.width  * metresPerPixel) / 2,
              z: -(blueprint.height * metresPerPixel) / 2 },
  })

  return { kind: 'calibrated', feet: analysis.widthFeet ?? analysis.depthFeet ?? 0 }
}
```

There is **no reference to `isCalibrated`, `calibratedSrc`, or any prior-calibration state anywhere in this function or its file.** `[X]` grep `isCalibrated` in `src/blueprint/detectOpenings.ts` → 0 hits.

**The measured value is gone.** So is the calibrated `origin` — replaced with a re-centre on the world origin, which also slides the underlay out from under anything already positioned against it.

**Step 5 — walls are built at the AI's scale.**
```ts
// useBlueprintStructure.ts:83-90
setPhase({ kind: 'building' })
const walls = await buildWallsFromBlueprint()
```
```ts
// buildStructure.ts:54-60
const segments = detectWallSegments(raster.image)
const walls = segmentsToWalls(segments, {
  metresPerPixel: blueprint.metresPerPixel / raster.scale,   // ← reads step 4's value
  origin: blueprint.origin,
})
```
→ `addWall(...)` per segment. **The AI-derived scale is now baked into every wall's world coordinates.** Nothing rescales walls afterwards — `[X]` no action exists that scales `walls`.

**Step 6 — the user is told it was calibrated.**
```
App.tsx:113-117
{structure.kind === 'built' &&
  `${structure.scale.kind === 'calibrated'
      ? `Sized to ${structure.scale.feet}′ from the drawing. `
      : 'Sized by best guess — no dimension was legible; calibrate in 2D. '}…`}
```
`applyPlanScale` returns `kind: 'calibrated'` — the same word the manual path uses. The banner reads *"Sized to 40′ from the drawing."* and disappears after 6.5 seconds ([useBlueprintStructure.ts:130-133](../../src/blueprint/useBlueprintStructure.ts#L130-L133)).

### Answer

> **After a user manually calibrates, what is the exact sequence of calls when they switch to 3D, and does any of them recompute or overwrite the scale?**

```
setViewMode('3d')                                    useDesignStore.ts:784
 └ App re-render
    └ useBlueprintStructure effect                   useBlueprintStructure.ts:56
       ├ guard viewMode/src/visible                  :57   passes
       ├ guard handled.current                       :58   passes
       ├ guard walls.length > 0                      :60   ★ passes ONLY when 0
       ├ analyseBlueprint()                          :73  → POST /api/ai/openings
       │    └ analysePlan → gemma-4-26b:free    openingDetector.ts:230
       ├ applyPlanScale(analysis)                    :79
       │    └ updateBlueprint({metresPerPixel, origin})
       │         detectOpenings.ts:145  ★★ OVERWRITES THE MANUAL CALIBRATION
       ├ buildWallsFromBlueprint()                   :85
       │    └ segmentsToWalls({mpp: <AI value> / raster.scale})
       │         buildStructure.ts:58  ★ bakes the AI scale into the walls
       ├ placeOpenings(...)                          :98
       ├ placeRooms(...) / placeFurniture(...)     :101-102
       └ setPhase({kind:'built', scale:{kind:'calibrated'}})
            → App.tsx:113  "Sized to 40′ from the drawing."
```

**YES. `applyPlanScale` overwrites it, unconditionally, whenever the active floor has no walls.**

### Reachability and severity

| | |
|---|---|
| **Fires when** | a visible blueprint is loaded **AND** the active floor has zero walls **AND** the user switches to 3D **AND** the vision model returns a usable `box` plus at least one dimension. |
| **Does NOT fire when** | any wall exists on the active floor (the `walls.length > 0` guard at [:60](../../src/blueprint/useBlueprintStructure.ts#L60)) · the blueprint is hidden · the AI is unavailable (then `{kind:'guess'}`, and **the manual scale survives** — see Q4) · the same `blueprintSrc` has already been handled this session (`handled.current`). |
| **Why the guard makes it worse, not better** | The guard exempts a floor that already has walls. The panel's recommended workflow is *calibrate → then trace or detect*, so the window in which the bug fires is **exactly the state a user is in immediately after calibrating**. |
| **Recoverability** | `[V]` **None from the UI.** `blueprint` is not in `DesignSnapshot` ([useDesignStore.ts:653-665](../../src/store/useDesignStore.ts#L653-L665)) → ⌘Z cannot restore it. It is not in `DesignDocument` ([schema.ts:38-64](../../src/persistence/schema.ts#L38-L64)) → reload cannot restore it. The user must re-calibrate **and** delete every wall built at the wrong scale. |
| **Detectability** | `[V]` **Low.** The banner says *"calibrated"*, and `isCalibrated(src)` **still returns true** — `calibratedSrc` was never cleared — so the panel's *"Not calibrated yet"* warning stays hidden. The scale readout at [:397](../../src/components/BlueprintPanel.tsx#L397) does change, but the user has no reason to look. |

### Three secondary defects on the same path `[V]`

| # | Defect | Evidence |
|---|---|---|
| Q1-b | **The two writers use different clamps.** Manual: `clamp(1e-5, 1, …)`. AI: **none**. A hallucinated `widthFeet` of 4000 on a 0.8-wide box produces a scale far outside `BLUEPRINT.min/maxMetresPerPixel`, and nothing stops it. | [BlueprintPanel.tsx:151-157](../../src/components/BlueprintPanel.tsx#L151-L157) vs [detectOpenings.ts:144-153](../../src/blueprint/detectOpenings.ts#L144-L153) |
| Q1-c | **The two writers use different origin rules.** Manual pins `picks[0]` so the image scales about the point the user aimed at. AI re-centres on the world origin, moving the underlay relative to anything already placed. | [BlueprintPanel.tsx:166-170](../../src/components/BlueprintPanel.tsx#L166-L170) vs [detectOpenings.ts:147-152](../../src/blueprint/detectOpenings.ts#L147-L152) |
| Q1-d | **`calibratedSrc` is never cleared.** Not on `setBlueprint(null)` ([BlueprintPanel.tsx:271-279](../../src/components/BlueprintPanel.tsx#L271-L279)), not on `loadDesign`, not on `newDesign`. It leaks for the life of the tab. | `[X]` grep `calibratedSrc =` → only [calibration.ts:28,38](../../src/blueprint/calibration.ts#L28) |

---

## Q5 — Duplicate and competing logic

| # | Concept | Implementations | Evidence |
|---|---|---|---|
| **5.1** | **Two full plan renderers** | [plan/draw.ts](../../src/plan/draw.ts) (1658) and [plan/planSheet.ts](../../src/plan/planSheet.ts) (874). Both project world→screen, draw walls, openings, furniture, room labels and dimensions, each with its own colour table (`COLORS` at draw.ts:41 vs `INK` at planSheet.ts:25) and its own layout constants. | The split is defended at [planSheet.ts:15-22](../../src/plan/planSheet.ts#L15-L22). The reasoning is sound; the duplication is real and unbounded — a change to how an opening is drawn must be made twice. |
| **5.2** | **`fileActiveFloor` and `allFloors` have byte-identical bodies** | [useDesignStore.ts:595-607](../../src/store/useDesignStore.ts#L595-L607) and [:616-635](../../src/store/useDesignStore.ts#L616-L635) — the same `state.floors.map((floor,i) => i===activeFloor ? {...floor, walls, furniture, roomLabels, stairs} : floor)`. Only the parameter type differs (`DesignState` vs a structural subset). | `[V]` |
| **5.3** | **Two `triggerDownload` implementations** | [documents.ts:456-466](../../src/export/documents.ts#L456-L466) and [imageExport.ts:72-83](../../src/persistence/imageExport.ts#L72-L83) — identical anchor-click + deferred `revokeObjectURL`. A third variant in [files.ts:14-27](../../src/persistence/files.ts#L14-L27) revokes **synchronously**, which the other two explicitly avoid: *"revoking inline can lose the file in some browsers"*. So the third one carries a bug the other two were written to avoid. | `[V]` The duplication is acknowledged at [documents.ts:450-455](../../src/export/documents.ts#L450-L455). |
| **5.4** | **`flightSteps` written twice** | [InspectorPanel.tsx:657-664](../../src/components/InspectorPanel.tsx#L657-L664) returns `{risers, treads, riser, going}`; [Stairs.tsx:26-33](../../src/scene/Stairs.tsx#L26-L33) returns `{risers, treads, rise, going}`. Same maths, **different key name** for the same value (`riser` vs `rise`). The plan symbol has a **third** copy of the tread count: `TREAD_COUNT` at [draw.ts:208-211](../../src/plan/draw.ts#L208-L211). | `[V]` Three sources of truth for one geometric fact. |
| **5.5** | **`rasterFromSrc` written twice** | [buildStructure.ts:11-26](../../src/blueprint/buildStructure.ts#L11-L26) and [BlueprintPanel.tsx:56-71](../../src/components/BlueprintPanel.tsx#L56-L71) — identical `new Image()` → `rasterise({element, width, height, release: () => {}})`. | `[V]` |
| **5.6** | **`wallLength` defined three times** | [useDesignStore.ts:541](../../src/store/useDesignStore.ts#L541), [detectOpenings.ts:513](../../src/blueprint/detectOpenings.ts#L513), and as `wallAxis(wall).length` at [wallGeometry.ts:9-26](../../src/scene/wallGeometry.ts#L9-L26). All are `Math.hypot(end.x-start.x, end.z-start.z)`. | `[V]` |
| **5.7** | **`clamp` defined five times** | [useDesignStore.ts:538](../../src/store/useDesignStore.ts#L538), [collision.ts:113](../../src/scene/collision.ts#L113) (one-arg symmetric form), [ThirdPersonControls.tsx:61](../../src/scene/ThirdPersonControls.tsx#L61), [detectOpenings.ts:437](../../src/blueprint/detectOpenings.ts#L437) (`clampAxis`, with a midpoint fallback), [draw.ts:666](../../src/plan/draw.ts#L666) (inline). Plus `clamp` in [pdf.ts:320](../../src/export/pdf.ts#L320) meaning something entirely different (truncate text). | `[V]` |
| **5.8** | **Two "clear the design" actions with different scope** | `clearWalls()` — `{walls:[], selection:null}` ([:1212](../../src/store/useDesignStore.ts#L1212)); `clearFloor()` — also clears `roomLabels`, `furniture`, `stairs` ([:1214-1221](../../src/store/useDesignStore.ts#L1214-L1221)). `clearWalls` has **one reference: its own declaration and definition.** `[X]` grep `clearWalls` → 2 hits, both in the store. It is dead. | `[V]` |
| **5.9** | **Two `isTextEntry` guards, byte-identical** | [useUndoShortcut.ts:5-11](../../src/components/useUndoShortcut.ts#L5-L11) and [useDeleteShortcut.ts:5-11](../../src/components/useDeleteShortcut.ts#L5-L11). A third, differently-written variant `typing()` is inline in [FloorPlanEditor.tsx:384-391](../../src/plan/FloorPlanEditor.tsx#L384-L391) — it checks `tagName === 'INPUT'` but **not `SELECT`**, so the space-to-pan handler behaves differently inside a `<select>` from the other two. | `[V]` |
| **5.10** | **Two `PlanAnalysis` / `RawOpening` / `RawLabel` / `PlanBox` type families** | [server/openingDetector.ts:59-86](../../server/openingDetector.ts#L59-L86) and [src/blueprint/detectOpenings.ts:41-55](../../src/blueprint/detectOpenings.ts#L41-L55). Structurally identical, **declared independently** because the client cannot import from `server/`. Nothing keeps them in sync — a field added server-side is silently dropped client-side. | `[V]` This is a real consequence of the (otherwise correct) `server/`↔`src/` boundary. |
| **5.11** | **Two "walk" control schemes with different physics** | `WalkControls` (first-person) moves the camera with **no collision**; `ThirdPersonControls` uses `moveWithCollisions`. Both duplicate `KEY_MAP`, the keydown/keyup/blur wiring, the camera save/restore effect and the pointer-lock lifecycle — ~80 lines each. | [WalkControls.tsx:13-22,48-116,118-143](../../src/scene/WalkControls.tsx#L118-L143) vs [ThirdPersonControls.tsx:20-29,92-182,184-256](../../src/scene/ThirdPersonControls.tsx#L184-L256) `[V]` |
| **5.12** | **Two conflicting statements of the project's AI policy** | `openingDetector.ts:6-8`: *"this project **deliberately does not use Claude/Anthropic**"*. `designAgent.ts:13`: `MODEL = 'anthropic/claude-sonnet-4.5'`. | `[V]` **CONFLICT** |
| **5.13** | **`analyseVastu` called from two places with independently-sorted room lists** | [VastuPanel.tsx:71-74](../../src/components/VastuPanel.tsx#L71-L74) sorts largest-first explicitly; [statement.ts:318](../../src/export/statement.ts#L318) passes `resolveRooms` output directly. They agree today only because `detectRooms` already sorts largest-first. `statement.ts:321-330` then **index-aligns** `names[index]` to `report.rooms[index]`, so any divergence silently mislabels every row. | `[V]` |
| **5.14** | **Two spellings of "the centre of the plan"** | `planBounds(walls).center` — the bounding-box centre, used by the walk spawn, the Vastu pivot, the camera fit. `centreOfPlan()` in [FurniturePanel.tsx:28-39](../../src/components/FurniturePanel.tsx#L28-L39) — the **mean of wall midpoints**, used for click-to-drop and "Add staircase". Different answers on any asymmetric plan. | `[V]` |
| **5.15** | **`METRES_PER_FOOT` declared twice** | [units/length.ts:16](../../src/units/length.ts#L16) (exported, the canonical one) and [detectOpenings.ts:23](../../src/blueprint/detectOpenings.ts#L23) (a private re-declaration, same value). | `[V]` |
| **5.16** | **Two `scaleLabel`-style "is this calibrated" signals** | `isCalibrated(src)` (module singleton) and `ScaleSource {kind:'calibrated'|'guess'}` (a React state in `useBlueprintStructure`). Both mean "calibrated", neither knows about the other, and the second is set to `'calibrated'` by the AI path. | `[V]` Directly implicated in Q1. |

---

## Q6 — Dead and unreachable code

### Dead exports — zero call sites `[V]` (`grep -rn "\b<name>\b" src server` returns only the definition)

| Symbol | File:line | Note |
|---|---|---|
| `SITE_RULES` | [vastu/ruleset.ts:130](../../src/vastu/ruleset.ts#L130) | Water-tank rules. Its own comment says *"They drive no results"*. |
| `BRAHMASTHAN_RULE` | [vastu/ruleset.ts:156](../../src/vastu/ruleset.ts#L156) | *"for display alongside the other rules"* — nothing displays it. |
| `zoneOfPoint` | [vastu/zones.ts:177](../../src/vastu/zones.ts#L177) | Only `zoneOfFramePoint` is used. Mentioned once in a doc comment. |
| `sectorOfPoint` | [site/orientation.ts:88](../../src/site/orientation.ts#L88) | |
| `bearingBetween` | [site/orientation.ts:66](../../src/site/orientation.ts#L66) | Used **only** by `sectorOfPoint`, which is itself dead → transitively dead. |
| `northScreenAngle` | [site/orientation.ts:101](../../src/site/orientation.ts#L101) | `CompassWidget` uses `northOffset` directly. |
| `rectCenter` | [site/plot.ts:28](../../src/site/plot.ts#L28) | |
| `buildPdfBytes` | [export/pdf.ts:168](../../src/export/pdf.ts#L168) | *"Bytes, for anywhere a Blob is the wrong shape"* — nowhere is. |
| `clearAutosave` | [persistence/storage.ts:127](../../src/persistence/storage.ts#L127) | **Notable:** nothing ever clears the autosave draft, including `newDesign()`. |
| `clearWalls` | [useDesignStore.ts:1212](../../src/store/useDesignStore.ts#L1212) | Superseded by `clearFloor`. Still in the `DesignState` interface. |

### Dead parameters and branches `[V]`

| Item | File:line | Note |
|---|---|---|
| `serializeDesign`'s `stairs?` param | [schema.ts:76](../../src/persistence/schema.ts#L76) | Accepted by four call sites, **never written to the document**. |
| `aiPlugin`'s `_anthropicKey` param | [aiPlugin.ts:77](../../server/aiPlugin.ts#L77) | *"Kept for signature stability"*, ignored. `vite.config.ts:24` still reads and passes `ANTHROPIC_API_KEY`. |
| All four `Anthropic.*Error` branches in `describeError` | [aiPlugin.ts:56-67](../../server/aiPlugin.ts#L56-L67) | **Unreachable** — no Anthropic client is ever constructed; the OpenRouter path is a bare `fetch`. |
| `DetectOptions` — 9 caller-overridable knobs | [detectWalls.ts:24-43](../../src/blueprint/detectWalls.ts#L24-L43) | Both call sites pass `{}`. Only `sizedDefaults` supplies values. |
| The `'r'` (raw) share-link branch | [shareLink.ts:52, 75-76](../../src/persistence/shareLink.ts#L75) | Only produced when `CompressionStream` is undefined. Live in principle, unreachable in every browser that supports the rest of the app. |
| `parseOpening`'s object form, `parseBox`'s object form, `parseLabel`'s object form | [openingDetector.ts:119-128, 162-168, 138-142](../../server/openingDetector.ts#L119-L128) | Fallbacks for *"the old verbose shape"* the current prompt never asks for. |

### Dead assets `[V]`

| Item | Note |
|---|---|
| `samples/blueprint-expected.json` | A golden file. `[X]` grep `blueprint-expected` in `src`/`server` → 0 hits. |
| `samples/*.svg` ×7, `samples/*.png` ×3 | Fixtures for the absent test suite. |
| `samples/gen-blueprint.mjs` (275 LOC) | Generator, not referenced by any script in `package.json`. |
| **121 `data-testid` attributes (100 distinct)** | For a suite that does not exist. |
| Repo-root binaries: `textures.zip`, `animations.zip`, `usd.usdc`, `stl.stl`, `glb.glb`, `fbx.fbx`, `obj.obj`, `obj.mtl`, `dae.dae`, `blender(construction+worker).blend`, `blueborder.webp` | ~4 MB, **staged for commit**, `[X]` imported by nothing. |
| `src/scene/Avatar.tsx` | **Deleted** in the staged changeset while `CharacterAvatar.tsx` was modified — an in-flight replacement. `[X]` No remaining reference to `Avatar`. |

### TODO / FIXME / HACK / XXX

`[X]` **Zero.** `grep -rn "TODO\|FIXME\|HACK\|XXX" src server` → no matches. This is genuinely unusual for a codebase this size and is worth reading as a signal: the author records reasoning in prose comments instead of markers. It also means **there is no in-code inventory of known-incomplete work.**

### Commented-out code blocks over 20 lines

`[X]` **None found.** 930 comment lines exist across `src/` + `server/`, and every block sampled is explanatory prose, not disabled code.

### Unreferenced files

`[X]` **None.** Every `.ts`/`.tsx` under `src/` has at least one inbound import (verified by matching each basename against every `from '…'` in the tree; the only apparent miss, `App.tsx`, is imported as `'./App.tsx'` with the extension).

---

## Q7 — State mutation map

### The mechanisms, all five `[V]`

| # | Mechanism | Scope |
|---|---|---|
| 1 | **Zustand `set()` inside a store action** | The design model. ~50 actions, all immutable. |
| 2 | **`useDesignStore.setState()` from outside an action** | **One site**: [SharedBanner.tsx:22](../../src/components/SharedBanner.tsx#L22). Plus three internal sites in the undo recorder ([useDesignStore.ts:1294, 1319](../../src/store/useDesignStore.ts#L1294)). |
| 3 | **`useState`** | Local UI only: panel status, draft text, dropdown open/closed, `pending`, `refused`, `note`, `showExit`, `showOrbitHint`, `locked`, `detected`, `knownLength`. Never design data. |
| 4 | **Module singletons, directly mutated** | `avatarState` (60 Hz), `calibration.picks` + `calibratedSrc`, `canvasRegistry.sceneCanvas`, `useAutosave.restored`, `SceneCanvas.orbitHintSeen`, the four history variables. |
| 5 | **Refs mutated per frame** | `FloorPlanEditor` ×11, `DoorLeaves` (`angle`, `side`), `CharacterAvatar` (`walkBlend`), `ThirdPersonControls` (`yaw`, `pitch`, `keys`, `running`), `DimensionLabels`/`RoomLabels` (`chips`). |

`[X]` **No reducers, no event bus, no observables, no context.** grep `dispatch|useReducer|EventEmitter|createContext|rxjs` → 0 hits.

### Every mutation of the core document model `[V]`

All in `src/store/useDesignStore.ts`:

| Action | Line | Fields written | Immutable? |
|---|---|---|---|
| `addWall` | 1150 | `walls` | ✅ `[...state.walls, wall]`; `start`/`end` cloned |
| `updateWall` | 1169 | `walls` | ✅ `patchWall` → `map` → `normalizeWall({...wall})` |
| `setWallLength` | 1181 | `walls` | ✅ |
| `removeWall` | 1204 | `walls`, `selection` | ✅ `filter` |
| `clearWalls` | 1212 | `walls`, `selection` | ✅ — **dead** |
| `clearFloor` | 1214 | `walls`, `roomLabels`, `furniture`, `stairs`, `selection` | ✅ |
| `addOpening` | 1223 | `walls` | ✅ |
| `updateOpening` | 1245 | `walls` | ✅ |
| `removeOpening` | 1255 | `walls`, `selection` | ✅ |
| `addFurniture` | 1035 | `furniture` | ✅ position cloned |
| `updateFurniture` | 1046 | `furniture` | ✅ |
| `removeFurniture` | 1067 | `furniture`, `selection` | ✅ |
| `nameRoom` | 953 | `roomLabels` | ✅ anchor cloned |
| `updateRoomLabel` | 963 | `roomLabels` | ✅ |
| `removeRoomLabel` | 976 | `roomLabels` | ✅ |
| `addStair` | 878 | `stairs` | ✅ |
| `updateStair` | 890 | `stairs` | ✅ |
| `removeStair` | 905 | `stairs`, `selection` | ✅ |
| `setPlot` | 914 | `plot` | ⚠️ **stores the caller's object by reference** — see below |
| `updatePlot` | 916 | `plot` | ✅ |
| `setSetback` | 933 | `plot` | ✅ |
| `setNorthOffset` | 1026 | `northOffset` | ✅ wrapped |
| `setPlotFacing` | 1033 | `plotFacing` | ✅ |
| `setFloorMaterial` | 1014 | `floorMaterial` | ✅ |
| `setUnits` | 1016 | `units` | ✅ |
| `setConstructionRate` | 1018 | `constructionRate` | ✅ guarded |
| `setBlueprint` | 983 | `blueprint` | ⚠️ **stores by reference**; revokes the previous object URL |
| `updateBlueprint` | 992 | `blueprint` | ✅ `origin` cloned |
| `setActiveFloor` | 811 | `floors`, `activeFloor`, the 4 checked-out arrays, `selection`, `walkMode`, `viewEpoch` | ✅ |
| `copyToNextFloor` | 833 | `floors` | ✅ deep-copies walls, openings, furniture, labels with fresh ids |
| `loadDesign` | 1076 | ~15 fields | ⚠️ **`furniture`, `roomLabels`, `stairs` and `floors` are stored by reference** — see below |
| `newDesign` | 1134 | 9 fields | ✅ |
| `undo` / `redo` | 750 / 767 | 10 snapshot fields | ✅ reference swap |

### Direct mutation of shared objects — flagged `[V]`

| # | Site | What is mutated | Assessment |
|---|---|---|---|
| **M1** | [viewport.ts:63-83](../../src/plan/viewport.ts#L63-L83) `fitToBounds`, [:94-110](../../src/plan/viewport.ts#L94-L110) `zoomAt`, and direct writes at [FloorPlanEditor.tsx:200-201, 229-230, 435, 653-654](../../src/plan/FloorPlanEditor.tsx#L653-L654) | The `Viewport` object | **Deliberate and safe.** The object lives in a single ref, is never in the store, never a React dep, and is read once per frame. Both functions document *"Mutates `vp`."* |
| **M2** | [avatarState.ts:14-24](../../src/scene/avatarState.ts#L14-L24), written by `ThirdPersonControls` ([:216-231](../../src/scene/ThirdPersonControls.tsx#L216-L231)) and `WalkControls` ([:141-142](../../src/scene/WalkControls.tsx#L141-L142)), read by `CharacterAvatar` ([:162-179](../../src/scene/CharacterAvatar.tsx#L162-L179)) and `DoorLeaves` ([:85-87](../../src/scene/DoorLeaves.tsx#L85-L87)) | A **shared module-level object mutated at 60 Hz by one writer and read by two consumers** | **Deliberate and documented** ([avatarState.ts:1-13](../../src/scene/avatarState.ts#L1-L13)). Safe because there is exactly one writer at a time and every reader is inside `useFrame`. It is a genuine global, and nothing structurally prevents a second writer. |
| **M3** | [palette.ts:231, 260](../../src/materials/palette.ts#L231) | A module-level `Map<MaterialId, Texture>` cache | Write-once per material; clones are handed out. Never disposed — see Q9. |
| **M4** | [useDesignStore.ts:914](../../src/store/useDesignStore.ts#L914) `setPlot: (plot) => set({ plot })` | The caller's `Plot` object is stored **by reference**, not cloned | Every other creator clones (`{...position}`, `{...anchor}`). The only caller builds a fresh literal ([PlotPanel.tsx:73-85](../../src/components/PlotPanel.tsx#L73-L85)) or passes `null`, so no aliasing occurs **today**. The asymmetry is a latent hazard, not a live bug. |
| **M5** | [useDesignStore.ts:1092-1096](../../src/store/useDesignStore.ts#L1092-L1096) `loadDesign` | `furniture ?? []`, `roomLabels ?? []`, `stairs ?? []`, `floors` are stored **by reference** while `walls` is defensively re-normalised via `walls.map(normalizeWall)` | Callers pass arrays straight out of `parseDesign`, which built them fresh, so no aliasing occurs today. But `floors[i].walls` are **not** run through `normalizeWall`, unlike the top-level walls — so an out-of-range wall height on an upper floor **is not clamped on load**, while the same value on the ground floor is. `[V]` This is a real inconsistency. |
| **M6** | [Walls.tsx:127-141](../../src/scene/Walls.tsx#L127-L141), [FloorSlab.tsx:48-72](../../src/scene/FloorSlab.tsx#L48-L72) | `new MeshStandardMaterial(...)` per piece inside `useMemo`, disposed in a cleanup effect | Correct pattern, but see Q9 for the allocation volume. |

**Overall:** the store's immutability discipline is **consistently applied and is load-bearing** — the undo recorder's `designChanged` is a pure reference comparison with no deep compare ([:682-695](../../src/store/useDesignStore.ts#L682-L695)). The two by-reference stores (M4, M5) are the only cracks, and neither is currently exploited.

---

## Q9 — Performance profile (static read only)

### Loops over all entities on every render / frame

| # | Site | Cost |
|---|---|---|
| **P1** | [plan/rooms.ts:86-145](../../src/plan/rooms.ts#L86-L145) `splitAtIntersections` → `splitOne` is called for every segment against **every other segment**, and for each pair also tests both endpoints. **O(n²)**. Then [:155-161](../../src/plan/rooms.ts#L155-L161) `nodeAt` does a **linear scan of all nodes for every endpoint** → another **O(n²)**. | This runs inside `detectRooms`, which runs inside `resolveRooms`, which is called from **five separate `useMemo`s** keyed on `[walls, roomLabels]` — [FloorPlanEditor.tsx:261](../../src/plan/FloorPlanEditor.tsx#L261), [InspectorPanel.tsx:469](../../src/components/InspectorPanel.tsx#L469), [RoomSchedulePanel.tsx:51](../../src/components/RoomSchedulePanel.tsx#L51), [VastuPanel.tsx:71](../../src/components/VastuPanel.tsx#L71), [RoomLabels.tsx](../../src/scene/RoomLabels.tsx) — plus `StatusBar`'s `totalFloorArea` ([StatusBar.tsx:19](../../src/components/StatusBar.tsx#L19)) and `statement.ts`'s `measureFloors` (**once per storey**). With every panel open, **one wall edit runs the O(n²) room detection six or more times.** |
| **P2** | [plan/draw.ts:294-333](../../src/plan/draw.ts#L294-L333) | 17 layers repainted in full on every frame. Sub-loops: every wall ×3 passes (stroke, openings, vertices), every room ×2 (fill, caption), every furniture item, every stair (+ its tread lines), every dimension, every Vastu cell. No dirty-rect, no layer cache, no off-screen culling except the grid's `visibleBounds`. |
| **P3** | [draw.ts:1405-1477](../../src/plan/draw.ts#L1405-L1477) `drawDimensions` | Calls `ctx.measureText` **once per wall, every frame**, to decide whether the label fits. `measureText` forces a text-metrics computation. |
| **P4** | [draw.ts:906-932, 939-955](../../src/plan/draw.ts#L939-L955) `drawRoomCaptions` → `placeCaption` | Two `clearSpan` polygon scans plus up to three `measureText` calls **per room per frame**. |
| **P5** | [DimensionLabels.tsx:98-122](../../src/scene/DimensionLabels.tsx#L98-L122) and RoomLabels' equivalent | `useFrame` declutter: for each chip, `Vector3.project(camera)`, then an **O(placed)** scan against every already-placed chip → **O(n²) per frame**, at 60 Hz, while the Dimensions switch is on. |
| **P6** | [site/plot.ts:159-183](../../src/site/plot.ts#L159-L183) `wallsOutsideBuildable` | Called from `siteFrame` **inside `drawPlan`** ([draw.ts:459-461](../../src/plan/draw.ts#L459)) — every wall tested every frame whenever a plot exists. Cheap per wall, but unmemoised. |

### Full recomputations that could be incremental

| # | Site |
|---|---|
| **P7** | [storage.ts:47-68](../../src/persistence/storage.ts#L47-L68) `readProjects()` — **runs `parseDesign` on every stored project** — is called by `listProjects`, `saveProject`, `loadProject` **and** `deleteProject`. `saveProject` therefore reads, validates and re-serialises the **entire project library** on every write. Autosave calls it **every 4 seconds** while a project is open ([useAutosave.ts:99-102](../../src/persistence/useAutosave.ts#L99-L102)). With 20 saved projects this is 20 full document validations plus a full `JSON.stringify` of all of them, four times a minute. |
| **P8** | [Walls.tsx:127-141](../../src/scene/Walls.tsx#L127-L141) — `useMemo` keyed on `[ghost, pieces, wall.material]`, and `pieces` is keyed on `[wall]`. **Any** change to a wall object (moving an opening 1 cm) rebuilds every `MeshStandardMaterial` **and calls `tiledTexture` per piece**, each of which does `base.clone()` + `needsUpdate = true` — a GPU re-upload. |
| **P9** | [statement.ts:222-232](../../src/export/statement.ts#L222-L232) `measureFloors` re-resolves rooms for **all three storeys**. Called from `RoomSchedulePanel`'s `useMemo` ([:62-90](../../src/components/RoomSchedulePanel.tsx#L62-L90)), whose deps include `walls` — so **every wall edit re-detects rooms on every floor** while that panel is open. |
| **P10** | [vastu/analyse.ts:295-327](../../src/vastu/analyse.ts#L295-L327) `dominantZone` clips **every room polygon against all nine cells** with Sutherland-Hodgman. Memoised in `VastuPanel`, but re-run wholesale on any wall change. |

### Missing memoisation on expensive paths

| # | Site |
|---|---|
| **P11** | [draw.ts:440-464](../../src/plan/draw.ts#L440-L464) `siteFrame` — `buildableRect`, `frontEdge` and `wallsOutsideBuildable` all recomputed inside the paint. The comment defends it (*"the same order of work as drawing them"*) but it is unmemoised work in the hot path. |
| **P12** | [FloorPlanEditor.tsx:100-132](../../src/plan/FloorPlanEditor.tsx#L100-L132) — **13 separate `useDesignStore.getState()` calls** inside one `drawPlan` argument object, on every frame. Each is cheap; the pattern makes the cost invisible. |
| **P13** | [StatusBar.tsx:19](../../src/components/StatusBar.tsx#L19) `totalFloorArea(walls)` runs the whole O(n²) room detection, memoised on `walls` — but the status bar is **always mounted** (`chrome && <StatusBar/>`, [App.tsx:149](../../src/App.tsx#L149)), so this is one guaranteed full room detection per wall edit even with every panel closed. |
| **P14** | [detectOpenings.ts:314, 349](../../src/blueprint/detectOpenings.ts#L314) — `placeFurniture` calls `resolveRooms` once, but `placeFixtures` calls it **again**; `detectAndPlaceOpenings` runs `placeFurniture` → `placeKitchenCounters` → `placeToiletFixtures`, i.e. **three full room resolutions** in sequence, each on a wall set the previous call may have changed. |

### Synchronous work blocking the main thread

| # | Site |
|---|---|
| **P15** ★ | [detectWalls.ts:716-745](../../src/blueprint/detectWalls.ts#L716-L745) — **four full binarisations of up to 4 megapixels, each followed by the complete band pipeline (transpose, run-length, union-find, merge, measure), synchronously on the main thread.** `yieldToPaint()` (2×rAF + `setTimeout`) exists **only so the "Detecting…" label paints first** ([BlueprintPanel.tsx:35-46](../../src/components/BlueprintPanel.tsx#L35-L46)) — it does not chunk the work. `[X]` No web worker anywhere: grep `new Worker\|worker_threads\|comlink` → 0 hits. |
| **P16** | [documents.ts:154-186](../../src/export/documents.ts#L154-L186) — per storey, a **3000×2121 canvas** is allocated, `renderPlanSheet` draws the whole sheet, then `toBlob('image/jpeg', 0.92)`. Three storeys = three ~6.4-megapixel rasterisations. `runExport` shows a busy state ([ProjectsMenu.tsx:266-288](../../src/components/ProjectsMenu.tsx#L266-L288)), which is the mitigation. |
| **P17** | [pdf.ts:829-974](../../src/export/pdf.ts#L829-L974) `serialise` — builds the entire PDF as **JavaScript strings**, then `latin1()` copies each to a `Uint8Array`, then a final pass concatenates every chunk. Two full copies of the document in memory. |
| **P18** | [palette.ts:239-262](../../src/materials/palette.ts#L239-L262) `baseTexture` — draws a 512×512 procedural pattern on first use of each material. `concretePattern` does **4,000 `fillRect` calls** ([:69-73](../../src/materials/palette.ts#L69)); `plankPattern` does 5 planks × 14 bezier strokes. Cached per material, so once each — but synchronously, on the frame a material is first used. |
| **P19** | [shareLink.ts:28-38](../../src/persistence/shareLink.ts#L28-L38) — `gzip`/`gunzip` are async (`CompressionStream`), so **not** blocking. Noted because it is the one place this pattern was avoided. |

### Per-frame network or DOM-in-a-loop

`[X]` **No per-frame network calls.** grep `fetch` inside any `useFrame`/`requestAnimationFrame` body → 0 hits.

| # | Per-frame DOM |
|---|---|
| **P20** | [DimensionLabels.tsx:119](../../src/scene/DimensionLabels.tsx#L119) — `el.style.visibility = …` written **for every chip, every frame**. Assigning the same value still touches the style object. RoomLabels does the same. With dimensions on and a 30-room plan that is ~100 style writes at 60 Hz. |
| **P21** | drei `<Html>` mounts **one real DOM node per room label and per dimension chip**, positioned by three.js each frame. A large plan with dimensions on can carry 150+ portalled DOM nodes over the canvas. |

### Memory / leak observations

| # | Site |
|---|---|
| **P22** | [palette.ts:231](../../src/materials/palette.ts#L231) — the `cache: Map<MaterialId, Texture>` is **never cleared and never disposed**. Nine 512×512 textures, bounded, so it is a fixed cost rather than a leak. But every `tiledTexture` **clone** is disposed by the consumer ([Walls.tsx:143-150](../../src/scene/Walls.tsx#L143-L150)) — and `Texture.clone()` shares the image while creating a new GPU handle, so the churn from P8 is real. |
| **P23** | [useDesignStore.ts:983-990](../../src/store/useDesignStore.ts#L983-L990) `setBlueprint` revokes the previous object URL — **correct**. But `FloorPlanEditor` creates a second `new Image()` from the same `src` ([:299-324](../../src/plan/FloorPlanEditor.tsx#L299-L324)) and `BlueprintPanel`/`buildStructure` each create more via `rasterFromSrc`. Multiple decoded copies of a large image coexist. |
| **P24** | [useDesignStore.ts:698](../../src/store/useDesignStore.ts#L698) `HISTORY_LIMIT = 100` snapshots. Each snapshot is 10 references, but those references pin whole `walls`/`floors` arrays — so 100 steps of a large design pin 100 generations of it. Bounded, but not small. |

---

## Q10 — Error handling and data-loss risk

### Silent catches

There are **25 `catch` blocks** in `src/` + `server/` `[V]`. Almost all return a **typed error result** rather than swallowing. The genuinely silent ones:

| # | Site | What is swallowed | Assessment |
|---|---|---|---|
| **E1** | [storage.ts:128-132](../../src/persistence/storage.ts#L128-L132) `clearAutosave` | Everything | Harmless — and the function is dead anyway. |
| **E2** | [ShareButton.tsx:75-78](../../src/components/ShareButton.tsx#L75-L78) | Clipboard permission failure | **Correctly handled** — `copied` stays false and the panel shows the URL in a selectable field. |
| **E3** | [openingDetector.ts:336-341](../../server/openingDetector.ts#L336-L341) | `JSON.parse` failure | **Deliberate** — falls through to the regex salvage path, commented. |
| **E4** | [designAgent.ts:182](../../server/designAgent.ts#L182) `response.text().catch(() => '')` | The error body | Minor — the status code still surfaces. |
| **E5** | [storage.ts:20-26, 51-67, 106-121](../../src/persistence/storage.ts#L20-L26) | localStorage read failures and corrupt JSON | Returns `null`/`{}`. **A corrupt `projects` key silently presents as "Nothing saved yet."** The user is not told their library failed to parse — only that it is empty. Individual unparseable projects are likewise dropped from the list with no message ([:61-62](../../src/persistence/storage.ts#L61-L62)). |
| **E6** | [buildStructure.ts:23-25](../../src/blueprint/buildStructure.ts#L23-L25), [BlueprintPanel.tsx:68-70](../../src/components/BlueprintPanel.tsx#L68-L70) | `image.onerror` | Converted to a typed result — but in `buildStructure` the caller maps `reason: 'decode'` to `setPhase({kind:'idle'})` ([useBlueprintStructure.ts:88](../../src/blueprint/useBlueprintStructure.ts#L88)), i.e. **the 3D view shows nothing and says nothing.** |
| **E7** | [CharacterAvatar.tsx:190-201](../../src/scene/CharacterAvatar.tsx#L190-L201) | Any GLB/FBX load or decode error | **Deliberate** — the boundary renders `null`. Documented. The user simply has no figure and is not told why. |

### Where a user action could throw and lose in-progress work

| # | Scenario | Consequence |
|---|---|---|
| **L1** ★ | **AI edit** — [useDesignAI.ts:86-89](../../src/ai/useDesignAI.ts#L86-L89) | **Silently destroys furniture, room names, stairs, the plot, north, the rate, the floor material and both upper storeys**, then clears undo. Autosave persists the loss within 4 s. No throw — this is the *success* path. See [09_AI_INVENTORY.md](09_AI_INVENTORY.md). |
| **L2** ★ | **2D→3D with a calibrated blueprint and no walls** — Q1 | Destroys the manual calibration, unrecoverably. No throw. |
| **L3** ★ | **Autosave's dirty check watches `walls` only** — [useAutosave.ts:73](../../src/persistence/useAutosave.ts#L73) `if (walls === savedWallsRef.current) return` | A session spent **naming rooms, arranging furniture, setting the plot and setbacks, rotating north, entering the construction rate, or changing finishes** — with no wall touched — **is never autosaved**. Close the tab and all of it is gone. The README promises *"closing the tab does not lose work"* ([README.md:117-119](../../README.md#L117-L119)). |
| **L4** | `saveProject` overwrite — [storage.ts:80-84](../../src/persistence/storage.ts#L80-L84) | Keyed on name, no confirmation. Typing an existing project's name and pressing Save destroys it. |
| **L5** | Project delete — [ProjectsMenu.tsx:412-419](../../src/components/ProjectsMenu.tsx#L412-L419) | No confirmation dialog. One click on `✕`. |
| **L6** | `copyToNextFloor` refusal | **Correctly guarded** — refuses a non-empty target *"overwriting a storey someone has already drawn is not recoverable"* ([useDesignStore.ts:416-421](../../src/store/useDesignStore.ts#L416-L421)), and the UI explains the refusal ([Toolbar.tsx:467-473](../../src/components/Toolbar.tsx#L467-L473)). A model for the others. |
| **L7** | `startOver` in the blueprint panel — [BlueprintPanel.tsx:287-290](../../src/components/BlueprintPanel.tsx#L287-L290) | Clears the whole floor. No confirmation — **but** it is a single undo step by design, and the panel says so. Acceptable. |
| **L8** | localStorage quota exceeded | `writeRaw` returns a typed error with a specific message ([storage.ts:33-43](../../src/persistence/storage.ts#L33-L43)). **But autosave ignores it**: `if (!draft.ok) return` ([useAutosave.ts:96-97](../../src/persistence/useAutosave.ts#L96-L97)) — it returns **without updating `savedWallsRef`**, so it will retry in 4 s, silently, forever. **The user is never told that autosave has stopped working.** |
| **L9** | Two tabs open on the same origin | Both write `space-design.autosave.v1` and the same project key every 4 s. Last writer wins. `[X]` No `storage` event listener, no lock, no tab id. |
| **L10** | `parseDesign` rejects a stored project on load | `loadProject` returns `null` → *"Could not open "X"."* ([ProjectsMenu.tsx:148](../../src/components/ProjectsMenu.tsx#L148)) — but `readProjects` already dropped it from the list, so the row usually vanishes rather than erroring. |
| **L11** | `readJpeg` throws mid-PDF — [pdf.ts:762, 793, 796, 807](../../src/export/pdf.ts#L762) | Caught by `runExport`, message shown. The partially-built `PdfDoc` is discarded. Correct. |
| **L12** | Share-link payload exceeds a browser/chat URL limit | `[X]` **Unchecked.** `createShareLink` returns whatever length it produces. No warning, no size readout. A link that is truncated by the transport fails at `decodeShareLink` with *"That share link is damaged or incomplete."* — accurate but late. |

### Does autosave exist, and what does it cover?

`[V]` **Yes** — [useAutosave.ts](../../src/persistence/useAutosave.ts), `AUTOSAVE_INTERVAL_MS = 4000`.

| Covers | Does **not** cover |
|---|---|
| All three storeys' walls, furniture, room labels, stairs (via `allFloors`) | **Any change that does not replace the `walls` array** (L3) |
| `plot`, `floorMaterial`, `viewMode`, `units`, `constructionRate`, `northOffset`, `plotFacing` — *when a wall change happens to trigger a save* | The `blueprint` (D1) |
| Restore on startup, guarded against StrictMode double-mount by a module-scope `restored` flag | A storage-full condition (L8) |
| Disabled in read-only, so a viewer's own draft is not overwritten ([App.tsx:48-50](../../src/App.tsx#L48-L50)) | Cross-tab conflicts (L9) |

---

## Top issues by blast radius

| # | Issue | Blast radius | Where |
|---|---|---|---|
| 1 | **AI edit destroys furniture, rooms, stairs, plot, north, rate and both upper floors; undo is cleared** | Total loss of everything except walls, on a routine action, with no warning and no recovery | [useDesignAI.ts:86-89](../../src/ai/useDesignAI.ts#L86-L89) |
| 2 | **`applyPlanScale` overwrites a manual calibration, unrecoverably (Q1)** | Every wall built afterwards is at the wrong real-world size; areas, cost and the Vastu grid all inherit it | [detectOpenings.ts:145](../../src/blueprint/detectOpenings.ts#L145) |
| 3 | **Autosave's dirty check watches `walls` only** | A whole session of non-wall work is lost on tab close, contradicting a documented promise | [useAutosave.ts:73](../../src/persistence/useAutosave.ts#L73) |
| 4 | **Every AI feature 404s in any deployed build** | Three of the app's headline features do not exist outside `npm run dev` | [aiPlugin.ts:121](../../server/aiPlugin.ts#L121) |
| 5 | **Blueprint (and its calibration) is never persisted or undoable** | Reload loses the underlay and its scale; ⌘Z cannot reverse a calibration | [schema.ts:38-64](../../src/persistence/schema.ts#L38-L64), [useDesignStore.ts:653-665](../../src/store/useDesignStore.ts#L653-L665) |
| 6 | **Zero tests over ~4,900 LOC of hand-written algorithms** | PDF writer, CV pipeline, polygon algebra and the untrusted-input validator are all unverified | `[X]` |
| 7 | **O(n²) room detection re-run 6+ times per wall edit** | Editing degrades superlinearly with plan size on the main thread | [plan/rooms.ts:86,155](../../src/plan/rooms.ts#L155) + 6 call sites |
| 8 | **First-person walk has no collision; third-person does** | Two walk modes with contradictory physics; README documents the absent one as intentional | [WalkControls.tsx:118-143](../../src/scene/WalkControls.tsx#L118-L143) |
| 9 | **PDF cannot render any non-Latin script** | Indic project or room names print as `?` in the deliverable, in an India-targeted product | [pdf.ts:34-36](../../src/export/pdf.ts#L34-L36) |
| 10 | **`readProjects` re-validates the whole library on every save — every 4 s** | Grows linearly with the number of saved projects, on the main thread | [storage.ts:47-68](../../src/persistence/storage.ts#L47-L68) |
| 11 | **A file with >3 floors loses everything above index 2, silently** | Data loss with no warning on import | [useDesignStore.ts:1099-1114](../../src/store/useDesignStore.ts#L1099-L1114) |
| 12 | **Upper-floor walls skip `normalizeWall` on load; ground-floor walls do not** | Out-of-range geometry survives on floors 1–2 only | [useDesignStore.ts:1093 vs 1099-1103](../../src/store/useDesignStore.ts#L1093) |
| 13 | **`floors[].walls` parse failures are dropped silently; top-level ones reject the file** | Two contracts for the same data | [schema.ts:350 vs 410-414](../../src/persistence/schema.ts#L410-L414) |
| 14 | **Autosave silently gives up on a storage-full error, forever** | The user believes work is being saved when it is not | [useAutosave.ts:96-97](../../src/persistence/useAutosave.ts#L96-L97) |
| 15 | **A corrupt `projects` localStorage key presents as "Nothing saved yet."** | Total library loss reads as an empty library | [storage.ts:51-67](../../src/persistence/storage.ts#L51-L67) |
| 16 | **No timeout on any AI call** | A hung upstream leaves the UI in `loading` indefinitely | `[X]` no `AbortController` anywhere |
| 17 | **Stairs rise into a solid slab** — no opening is cut | The 3D model is architecturally wrong wherever a staircase exists | `[X]` no code modifies `FloorSlab` for stairs |
| 18 | **Two tabs overwrite each other's autosave every 4 s** | Silent cross-tab data loss | `[X]` no `storage` listener |
| 19 | **Share-link length is unchecked** | A large design produces a link that fails silently in transport | [shareLink.ts:48-56](../../src/persistence/shareLink.ts#L48-L56) |
| 20 | **Project save/delete have no confirmation and no rename** | One mistyped name or one stray click destroys a project | [ProjectsMenu.tsx:107,171](../../src/components/ProjectsMenu.tsx#L171) |
