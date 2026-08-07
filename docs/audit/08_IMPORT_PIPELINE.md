# 08 — Import Pipeline

## Summary of what exists

| Format | Status | Owning code |
|---|---|---|
| **Raster image** (PNG/JPG/WebP/GIF/BMP) | **COMPLETE** | `src/blueprint/` |
| **`.json` project file** | **COMPLETE** | `src/persistence/files.ts` + `schema.ts` |
| **PDF** | **ABSENT** `[X]` | — |
| **DWG** | **ABSENT** `[X]` | — |
| **DXF** | **ABSENT** `[X]` | — |
| SVG, IFC, RVT, SKP, 3DS, OBJ-as-plan | **ABSENT** `[X]` | — |

---

## Image import — stage by stage `[V]`

### Stage 0 — Entry

Two entry points converge on one loader, deliberately: *"an image can arrive from two places … Both need the placement identical, or a plan traced from one route would sit at a different scale from the other"* — [load.ts:8-15](../../src/blueprint/load.ts#L8-L15).

| Entry | File:line | Extra behaviour |
|---|---|---|
| Blueprint panel file input | [BlueprintPanel.tsx:314-325](../../src/components/BlueprintPanel.tsx#L314-L325) | `accept="image/*"`; input value cleared so re-picking the same file re-fires |
| Projects → Import | [ProjectsMenu.tsx:290-304](../../src/components/ProjectsMenu.tsx#L290-L304) | `accept="application/json,.json,image/*"`; `isImageFile(file)` branches to the blueprint loader, then forces `setViewMode('2d')` and `setBlueprintPanelOpen(true)` |

`isImageFile` — [load.ts:44-49](../../src/blueprint/load.ts#L44-L49): MIME prefix first, extension regex as the fallback *"Some browsers hand over an empty type for a drag-dropped file"*.

### Stage 1 — Decode

`decodeImageFile(file)` — [raster.ts:56-99](../../src/blueprint/raster.ts#L56-L99)

| Step | Detail |
|---|---|
| Guard | `!file.type.startsWith('image/')` → *"That file is not an image. Use a PNG, JPG or WebP."* |
| Load | `URL.createObjectURL` → `new Image()`; `release()` is idempotent |
| Guard | `naturalWidth < 1 \|\| naturalHeight < 1` → *"That image has no pixels."* |
| Guard | `onerror` → *"That image could not be decoded."* |

**Transformation:** `File` → `{element: HTMLImageElement, width, height, release}`

### Stage 2 — Rasterise (resample + read pixels)

`rasterise(image, maxDimension = 2000)` — [raster.ts:105-158](../../src/blueprint/raster.ts#L105-L158)

```
longest = max(width, height)
scale = longest > 2000  ? 2000 / longest        ← shrink; keeps detection interactive
      : longest < 1400  ? 1400 / longest        ← ENLARGE; keeps hairline walls measurable
      :                   1
if (scale > 1) ctx.imageSmoothingEnabled = false   ← nearest-neighbour on purpose
fillStyle '#ffffff'; fillRect                       ← transparent PNG reads as paper
drawImage(element, 0, 0, width, height)
data = ctx.getImageData(...)                        ← throws on a tainted canvas
```

Both bounds are argued in the source. Upper: *"a 12-megapixel phone photo … would stall the tab for seconds"* ([:1-8](../../src/blueprint/raster.ts#L1-L8)). Lower: *"a 6 m house pasted at 300 px wide draws its walls one or two pixels across, under any sane minimum"* ([:10-19](../../src/blueprint/raster.ts#L10-L19)). Nearest-neighbour: *"smoothing would ramp a crisp 1px wall into a grey gradient that thresholding then splits at some arbitrary point"* ([:131-135](../../src/blueprint/raster.ts#L131-L135)).

**Transformation:** decoded image → `Raster {image: ImageData, scale, sourceWidth, sourceHeight}`
`scale` = *raster pixels per source pixel*. **This is the factor that must divide the calibration** — see Stage 5.

### Stage 3 — ★ Where the scale is set (first time)

`loadBlueprintFromFile` — [load.ts:16-41](../../src/blueprint/load.ts#L16-L41)

```ts
const metresPerPixel = BLUEPRINT_DEFAULTS.metresPerPixel      // 0.01  ← A GUESS
setBlueprint({
  src: URL.createObjectURL(file),        // a NEW url the store owns and revokes
  fileName: file.name,
  width:  raster.sourceWidth,            // SOURCE pixels, not raster pixels
  height: raster.sourceHeight,
  metresPerPixel,
  origin: { x: -(sourceWidth  * mpp) / 2,
            z: -(sourceHeight * mpp) / 2 },   // centred on the world origin
  opacity: 0.5, visible: true,
})
```

**Confidence at this stage: none.** `metresPerPixel = 0.01` means "1 px = 1 cm", i.e. a 1000 px drawing spans 10 m ([useDesignStore.ts:186-190](../../src/store/useDesignStore.ts#L186-L190)). Nothing has measured anything. The panel says so: *"Not calibrated yet — this is the default guess, not a measurement."* ([BlueprintPanel.tsx:401-406](../../src/components/BlueprintPanel.tsx#L401-L406)).

`[V]` Note `width`/`height` store **source** pixels while detection runs on **raster** pixels. Every consumer must therefore know which space it is in. This is handled correctly in both detection call sites (Stage 5) and is a genuine trap.

### Stage 4 — ★ Calibration (the one deterministic scale path)

| Sub-step | File:line | Detail |
|---|---|---|
| Arm | [BlueprintPanel.tsx:131-135](../../src/components/BlueprintPanel.tsx#L131-L135) | `clearCalibrationPicks()`, `setBlueprintCalibrating(true)` |
| Pick ×2 | [FloorPlanEditor.tsx:499-515](../../src/plan/FloorPlanEditor.tsx#L499-L515) | **`worldAt()`, never `snappedAt()`** — *"rounding to the 0.5 m grid would quantise the very measurement the scale is derived from"* ([:493-498](../../src/plan/FloorPlanEditor.tsx#L493-L498)). A 3rd click restarts. |
| Transport | [calibration.ts:11-50](../../src/blueprint/calibration.ts#L11-L50) | Module singleton + `useSyncExternalStore`. Deliberately **outside** the design store: *"it never reaches persistence or undo"* ([:5-10](../../src/blueprint/calibration.ts#L5-L10)) |
| Measure | [BlueprintPanel.tsx:110](../../src/components/BlueprintPanel.tsx#L110) | `measured = distance(picks[0], picks[1])` — in current world metres |
| Type | [BlueprintPanel.tsx:446-459](../../src/components/BlueprintPanel.tsx#L446-L459) | `<input type="number">`, label **"metres"**, hardcoded |
| Apply | [BlueprintPanel.tsx:143-179](../../src/components/BlueprintPanel.tsx#L143-L179) | see below |

```ts
metresPerPixel = clamp(1e-5, 1, blueprint.metresPerPixel * (typed / measured))
factor         = metresPerPixel / blueprint.metresPerPixel   // POST-clamp
updateBlueprint({
  metresPerPixel,
  origin: { x: anchor.x - (anchor.x - origin.x) * factor,     // anchor = picks[0]
            z: anchor.z - (anchor.z - origin.z) * factor },
})
markCalibrated(blueprint.src)      // ← module-scope string in calibration.ts
```

**Confidence after this stage: measured.** Recorded **only** in `calibratedSrc` (a module variable), which drives one warning label. It is not in the store, not in the document, not in the undo snapshot.

### Stage 5 — Wall detection (deterministic)

Two callers, identical transform, different triggers:

| Caller | File:line | Trigger |
|---|---|---|
| `BlueprintPanel.detect()` | [BlueprintPanel.tsx:181-210](../../src/components/BlueprintPanel.tsx#L181-L210) | "Detect walls" button. **Result is STAGED** in `detected` state and requires a second click ("Add these walls") to reach the store. |
| `buildWallsFromBlueprint()` | [buildStructure.ts:44-74](../../src/blueprint/buildStructure.ts#L44-L74) | Automatic, on 2D→3D. **Writes straight to the store**, no review step. |

Both do:
```ts
segments = detectWallSegments(raster.image)          // detectWalls.ts:716
walls = segmentsToWalls(segments, {
  metresPerPixel: blueprint.metresPerPixel / raster.scale,   // ★ the conversion
  origin: blueprint.origin,
})
```

`[V]` The `/ raster.scale` division is **correct and commented in both places** — *"Detection runs on the possibly-downscaled raster, whose pixels are larger than the source pixels the calibration is expressed in"* ([buildStructure.ts:56-58](../../src/blueprint/buildStructure.ts#L56-L58), [BlueprintPanel.tsx:202-204](../../src/components/BlueprintPanel.tsx#L202-L204)). This is a place the code gets right something that is easy to get wrong.

`segmentsToWalls` — [detectWalls.ts:840-851](../../src/blueprint/detectWalls.ts#L840-L851): image +x → world +x, image +y → world +z, **no axis flip** (the plan view is top-down with z running down the screen).

The CV pipeline itself is documented in [07_CURRENT_FEATURES.md §14](07_CURRENT_FEATURES.md).

### Stage 6 — ★ AI scale + openings + rooms + furniture

`analyseBlueprint()` — [detectOpenings.ts:78-113](../../src/blueprint/detectOpenings.ts#L78-L113)

```
toSendableJpeg(src)                                        // :522-544
  ≤ 1100 px longest edge, canvas.toDataURL('image/jpeg', 0.82)
POST /api/ai/openings { image }
  → aiPlugin :143-176   (8 MB body cap, must start "data:image/")
  → analysePlan(keys, image)                openingDetector.ts:230-270
      for round in 0..1:  for key in keys:
        callModel(key, image) → openrouter → gemma-4-26b-a4b-it:free
        parseCompletion(text) → unfence → JSON.parse
                              → on failure: salvageOpenings / salvageLabels
        return the first NON-EMPTY analysis
      else return bestEmpty, else throw
⇐ PlanAnalysis { widthFeet, depthFeet, box, openings[], rooms[], furniture[] }
```

Then, **only on the 2D→3D path**:

```ts
// detectOpenings.ts:126-159  — applyPlanScale
spanX = (box.x1 - box.x0) * blueprint.width     // normalized → SOURCE pixels
spanZ = (box.y1 - box.y0) * blueprint.height
estimates = []
if (widthFeet && spanX > 0) estimates.push(widthFeet * 0.3048 / spanX)
if (depthFeet && spanZ > 0) estimates.push(depthFeet * 0.3048 / spanZ)
if (estimates.length === 0) return { kind: 'guess' }
metresPerPixel = mean(estimates)                 // ★ NO CLAMP
updateBlueprint({
  metresPerPixel,
  origin: { x: -(width  * mpp)/2,                // ★ RE-CENTRES on world origin
            z: -(height * mpp)/2 },
})
return { kind: 'calibrated', feet: widthFeet ?? depthFeet ?? 0 }
```

**This is the write that destroys a manual calibration.** Full trace: [Q1 in 10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md#q1).

Note the return value is tagged `kind: 'calibrated'` — the same word the manual path uses — and the UI prints *"Sized to 40′ from the drawing"* for it ([App.tsx:113-117](../../src/App.tsx#L113-L117)). The user is told the plan was *calibrated*, when it was estimated by an LLM reading text off a JPEG.

Placement of the read's other outputs:

| Output | Function | Transform | Confidence handling |
|---|---|---|---|
| `openings[]` | `placeOpenings` [:167-195](../../src/blueprint/detectOpenings.ts#L167-L195) | normalized → world via `origin + n × pixelDims × mpp`; `pickWall(walls, world, 2.2 m)`; `addOpening(wall, type, projection.t)` | Width passed through `sensibleWidth` — trusted only inside `[0.6,1.4]` m for doors, `[0.5,3.0]` m for windows, else the real-world default; then capped at 90% of the wall ([:506-511](../../src/blueprint/detectOpenings.ts#L506-L511)). Misses are **counted and reported** as `dropped`. |
| `rooms[]` | `placeRooms` [:285-298](../../src/blueprint/detectOpenings.ts#L285-L298) | `toRoomType(name)` keyword match (order matters: `master`/`guest` before `bed`) → `nameRoom(world, type)` | Unrecognised names are skipped silently |
| `furniture[]` | `placeFurniture` [:309-329](../../src/blueprint/detectOpenings.ts#L309-L329) | `toFurnitureType(name)` (`\bbed\b` excludes "bedroom") → `addFurniture` → `fitToRoom` turns the piece's back to the nearest wall and pulls the whole rotated footprint 0.15 m clear | A point in no room keeps the raw placement |

### Stage 7 — Where the imported data lands

```
blueprint.metresPerPixel / origin   ← store, NOT persisted, NOT undoable
walls[]                             ← store, persisted, undoable
walls[].openings[]                  ← store, persisted, undoable
roomLabels[]                        ← store, persisted, undoable
furniture[]                         ← store, persisted, undoable
```

### Where confidence is set and where it is lost

| Point | Confidence | Recorded as | Survives reload? |
|---|---|---|---|
| After load | **guess** (0.01) | nothing | n/a |
| After manual calibration | **measured** | `calibratedSrc` module string | **No** |
| After `applyPlanScale` | **LLM estimate** | `ScaleSource {kind:'calibrated'\|'guess'}`, returned to a React state and cleared after 6.5 s | **No** |
| After walls are built | **baked into coordinates** | the metres in `Wall.start/end` | Yes |

`[V]` Once walls exist, the scale is **frozen into the wall coordinates**. Re-calibrating afterwards moves the underlay but not the walls — nothing rescales existing geometry. `[X]` grep for any action that scales `walls` → none exists.

---

## PDF import — `[X]` ABSENT

Searches run:
```
grep -rni "pdfjs\|pdf.worker\|getDocument\|PDFDocumentProxy" src server   → 0
grep -rni "application/pdf" src                                          → 1 hit,
    src/export/pdf.ts:174  new Blob([...], { type: 'application/pdf' })   ← OUTPUT
grep -rn "accept=" src                                                    → 2 hits:
    BlueprintPanel.tsx:317   accept="image/*"
    ProjectsMenu.tsx:586     accept="application/json,.json,image/*"
package.json                                                              → no PDF dep
```
A PDF dropped on the Import button fails `isImageFile`, then fails `JSON.parse`, and the user sees *"That file is not valid JSON."* ([files.ts:42](../../src/persistence/files.ts#L42)) — a misleading message for a PDF, but not a crash.

## DWG import — `[X]` ABSENT

```
grep -rni "dwg\|teigha\|\boda\b\|realdwg\|libredwg\|autocad" src server package.json → 0
```
**Licence note:** because no DWG library exists, the usual DWG licence exposure (ODA Teigha / Autodesk RealDWG, both commercial) is entirely absent. See [02_TECH_STACK.md](02_TECH_STACK.md).

## DXF import — `[X]` ABSENT

```
grep -rni "dxf\|dxf-parser\|LWPOLYLINE\|AcDbEntity\|SECTION.*ENTITIES" src server package.json → 0
```

## SVG import — `[X]` ABSENT

`samples/` contains 7 `.svg` fixture blueprints `[V]`, but they are **inputs to `gen-blueprint.mjs`'s output**, not to the app. `[X]` No code path reads an SVG: grep `image/svg|\.svg` in `src/` → only `favicon.svg` in `index.html` and inline `<svg>` JSX in `CompassWidget`. An SVG file passed to the image loader would pass `isImageFile` (MIME `image/svg+xml` starts with `image/`) and then rasterise through the canvas — `[U]` whether `getImageData` succeeds on an SVG-sourced image without tainting the canvas was not verified.
