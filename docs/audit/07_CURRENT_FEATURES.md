# 07 — Current Features

26 Subsystem Cards, then the Q11 completion matrix.

---

### 1. 2D Editor / canvas
**Status:** COMPLETE
**Owning files:** [src/plan/FloorPlanEditor.tsx](../../src/plan/FloorPlanEditor.tsx) (751), [src/plan/draw.ts](../../src/plan/draw.ts) (1658), [src/plan/viewport.ts](../../src/plan/viewport.ts) (113)
**Entry point:** [FloorPlanEditor.tsx:45](../../src/plan/FloorPlanEditor.tsx#L45) `FloorPlanEditor()`
**Responsibility:** Renders the whole design top-down to a 2D `<canvas>` and handles every pointer gesture over it. It is the only place walls, stairs and calibration points can be created by hand.
**Key types / data:** `Viewport {center: Point, scale: px-per-metre}`, `PlanScene` (23 fields, [draw.ts:240-292](../../src/plan/draw.ts#L240-L292))
**Inputs:** the store (read through `getState()` inside the paint), `getCalibrationPicks()`, a decoded `HTMLImageElement` for the blueprint, memoised `ResolvedRoom[]` and `ZoneCell[]`
**Outputs:** pixels; store writes via `addWall`/`addOpening`/`addStair`/`addFurniture`/`updateOpening`/`updateStair`/`updateFurniture`/`select`
**Dependencies:** `viewport`, `draw`, `wallGeometry`, `rooms/resolve`, `vastu/zones`, `units/length`, `blueprint/calibration`, `furniture/catalog`, `components/FurniturePanel` (for the drag MIME)
**Control flow:** 1 `ResizeObserver` sizes the backing store to DPR → 2 `store.subscribe(requestDraw)` → 3 `requestAnimationFrame` coalesces to one paint per frame → 4 `drawPlan` paints 17 layers in a fixed order ([:294-333](../../src/plan/draw.ts#L294-L333)) → 5 pointer events route by `tool` and `blueprintCalibrating`.
**State touched:** reads ~12 store fields; writes walls, openings, stairs, furniture, selection, `blueprintCalibrating`. Holds 11 refs as frame state.
**AI involvement:** none
**Error handling:** `drawBlueprint` checks `image.complete && naturalWidth>0` before `drawImage` *"which would take the entire paint down with it"* ([:341-343](../../src/plan/draw.ts#L341-L343)). No try/catch elsewhere in the paint.
**Tests:** `[X]` none
**Known limitations (observed):**
- Snap step is unit-dependent: 0.1524 m in `ftin`, 0.5 m in `m` — [length.ts:34-37](../../src/units/length.ts#L34-L37). No way to set it independently. `[V]`
- No rotate, no mirror, no copy/paste, no multi-select, no marquee, no move-a-wall-endpoint. Only openings, furniture and stairs can be dragged — [FloorPlanEditor.tsx:66-70](../../src/plan/FloorPlanEditor.tsx#L66-L70) enumerates the whole drag surface. `[V]`
- Room fills, Vastu grid and dimension text are recomputed and repainted in full every frame; there is no dirty-rect or layer caching. `[V]`
**Open questions:** none material.

---

### 2. Geometry model (walls, doors, windows, rooms, columns)
**Status:** PARTIAL — walls/doors/windows/rooms are complete; **columns do not exist**
**Owning files:** [src/store/useDesignStore.ts](../../src/store/useDesignStore.ts) (1328, types + invariants), [src/scene/wallGeometry.ts](../../src/scene/wallGeometry.ts) (313), [src/plan/rooms.ts](../../src/plan/rooms.ts) (251), [src/rooms/resolve.ts](../../src/rooms/resolve.ts) (208)
**Entry point:** [wallGeometry.ts:50](../../src/scene/wallGeometry.ts#L50) `wallPieces(wall)`
**Responsibility:** Defines what a wall is and slices it into the solid boxes left around its openings. Derives enclosed rooms from the wall graph.
**Key types:** `Wall`, `Opening`, `Point`, `WallPiece`, `Projection`, `Room`, `ResolvedRoom`
**Outputs:** `WallPiece[]` → `Walls.tsx`; `OpeningBox[]` → 3D click targets; `Room[]` → schedule, Vastu, area statement, status bar
**Control flow (rooms):** `detectRooms(walls)` → `splitAtIntersections` (T-junctions get a node) → `buildGraph` (weld at 1 mm) → `pruneDangles` → `traceFaces` (half-edge angular walk) → keep faces with `sign === INTERIOR_SIGN` and `|area| ≥ 1e-3` → sort largest first. [plan/rooms.ts:37-58](../../src/plan/rooms.ts#L37-L58)
**AI involvement:** none in the geometry itself; AI-derived walls arrive through `addWall` like any other.
**Error handling:** zero-length walls rejected at `addWall` ([:1151](../../src/store/useDesignStore.ts#L1151)); overlapping openings skipped rather than emitting negative geometry ([wallGeometry.ts:88](../../src/scene/wallGeometry.ts#L88)); degenerate rings return null centroid ([resolve.ts:161](../../src/rooms/resolve.ts#L161)).
**Tests:** `[X]` none — despite [README.md:285](../../README.md#L285) claiming `wallGeometry.ts` is tested.
**Known limitations (observed):**
- `[X]` **No columns, beams, slabs-as-objects, roofs, or curved walls.** grep for `column|beam|pillar|arc|curve|Bezier` across `src/` (excluding the plank-texture bezier) → 0 modelling hits. `Wall` is a straight segment only.
- `[V]` **`splitAtIntersections` is O(n²) and `buildGraph.nodeAt` is O(n) per point → O(n²) overall.** [plan/rooms.ts:87, 155-161](../../src/plan/rooms.ts#L155-L161). Runs on every walls change, in up to 5 separate `useMemo`s.
- `[V]` Areas are measured to **wall centrelines**, so each room is overstated by ~half a wall thickness around its perimeter. Stated openly at [plan/rooms.ts:30-36](../../src/plan/rooms.ts#L30-L36) and printed in every document ([statement.ts:32-35](../../src/export/statement.ts#L32-L35)).

---

### 3. Snapping & constraints
**Status:** PARTIAL
**Owning files:** [viewport.ts:85](../../src/plan/viewport.ts#L85) `snapToGrid`, [length.ts:34-37](../../src/units/length.ts#L34-L37) `GRID_STEP`, [useDesignStore.ts:549-587](../../src/store/useDesignStore.ts#L549-L587) `constrainOpening`/`normalizeWall`
**Responsibility:** Rounds placement to a grid and clamps every dimension into a physically meaningful range.
**Control flow:** wall/stair placement and furniture drag → `snapToGrid`; every wall and opening write → `normalizeWall`/`constrainOpening`; plot setbacks → clamped against the plot span ([:933-947](../../src/store/useDesignStore.ts#L933-L947)); north → wrapped to `[0,360)` ([:1026-1031](../../src/store/useDesignStore.ts#L1026-L1031)).
**AI involvement:** none
**Tests:** `[X]` none
**Known limitations (observed):**
- `[X]` **Grid snap only.** No endpoint snap, no midpoint snap, no perpendicular/parallel constraint, no angle snap, no snap-to-wall-face, no alignment guides, no dimension-driven input while drawing. grep for `snapTo(?!Grid)|guide|osnap|inference` → the only other snap in the codebase is `snapNorth` for the compass ([orientation.ts:116](../../src/site/orientation.ts#L116)).
- `[V]` A wall chain relies on the grid alone to close a loop. Off-grid endpoints (from AI, or from detection) never weld — the 1 mm `WELD` in `buildGraph` is the only tolerance, and it is applied at *room detection*, not at *drawing*.
- `[V]` `constrainOpening` clamps `position` to `[width/2, length−width/2]`. When `width > length` this range inverts and `clamp(v, hi, lo)` returns `lo` — but `addOpening` refuses that case up front ([:1229](../../src/store/useDesignStore.ts#L1229)), so it is reachable only by shrinking a wall under an existing opening, where `width` is itself re-clamped to `length` first ([:552-556](../../src/store/useDesignStore.ts#L552-L556)). No defect found.

---

### 4. Selection, transform, and editing tools
**Status:** PARTIAL
**Owning files:** [InspectorPanel.tsx](../../src/components/InspectorPanel.tsx) (887), [Toolbar.tsx](../../src/components/Toolbar.tsx) (665), [FloorPlanEditor.tsx:521-620](../../src/plan/FloorPlanEditor.tsx#L521-L620), [Walls.tsx:204-241](../../src/scene/Walls.tsx#L204-L241), [useDeleteShortcut.ts](../../src/components/useDeleteShortcut.ts)
**Entry point:** [InspectorPanel.tsx:24](../../src/components/InspectorPanel.tsx#L24)
**Key types:** `Selection` (6-way union), `Tool` (5 values)
**Control flow (2D pick order):** furniture → stair → opening → wall → room. [FloorPlanEditor.tsx:533-600](../../src/plan/FloorPlanEditor.tsx#L533-L600). Selection works in 3D too, via `onClick` on the wall group, the opening pick boxes, furniture, stairs and the slab.
**State touched:** `selection`, and through the inspector: wall height/thickness/material/length, opening width/height/sill/position, furniture position/rotation/width/depth, stair position/rotation/width/run, room type/name, floor material.
**AI involvement:** none
**Error handling:** every remover clears `selection` if it pointed at the deleted object ([:1204-1210, 905-912, 1067-1074, 1255-1266](../../src/store/useDesignStore.ts#L1204-L1210)).
**Tests:** `[X]` none
**Known limitations (observed):**
- `[X]` **Single-selection only.** `Selection` is one object or null; no array, no marquee, no shift-click. `[V]` type at [:289-296](../../src/store/useDesignStore.ts#L289-L296).
- `[X]` **No copy / paste / duplicate.** grep `clipboard|duplicate|paste` → only `navigator.clipboard.writeText` in ShareButton.
- `[X]` **No group / align / distribute / array.**
- `[V]` **A wall's endpoints cannot be moved.** `setWallLength` pivots on `start` and swings `end` along the existing direction only ([:1181-1202](../../src/store/useDesignStore.ts#L1181-L1202)). There is no action that sets `start` or changes a wall's angle. To re-angle a wall you must delete and redraw it.
- `[V]` Furniture rotation in the inspector is a **90° button plus a degree field**; there is no free rotate handle ([InspectorPanel.tsx:414-424](../../src/components/InspectorPanel.tsx#L414-L424)).

---

### 5. Undo/redo & history
**Status:** COMPLETE (for what it covers)
**Owning files:** [useDesignStore.ts:653-712, 750-780, 1269-1328](../../src/store/useDesignStore.ts#L1269-L1328), [useUndoShortcut.ts](../../src/components/useUndoShortcut.ts) (41)
**Entry point:** [useDesignStore.ts:1282](../../src/store/useDesignStore.ts#L1282) — the `subscribe` recorder
**Responsibility:** Records design-field changes into `past[]` as they settle, coalescing bursts; `undo`/`redo` swap snapshots.
**Key types:** `DesignSnapshot = Pick<DesignState, 'walls'|'roomLabels'|'furniture'|'stairs'|'floors'|'activeFloor'|'plot'|'plotFacing'|'northOffset'|'floorMaterial'>`
**Control flow:** see [06_DATA_FLOW.md §7](06_DATA_FLOW.md). `HISTORY_LIMIT = 100`, `HISTORY_COALESCE_MS = 200`.
**State touched:** `past`, `future`, plus the 10 snapshot fields on undo/redo. Three module-scope flags: `historyApplying`, `historyCommitted`, `historyBurst`, plus `historyEpoch`.
**AI involvement:** none — but a `viewEpoch` bump (which every AI generate/edit causes) **clears history**, so an AI result cannot be undone.
**Error handling:** `historyApplying` gates re-entry; `viewEpoch` divergence resets the baseline.
**Tests:** `[X]` none
**Known limitations (observed):**
- `[V]` **Blueprint calibration is not undoable** — `blueprint` is not in the snapshot. This is the same omission that makes Q1's overwrite unrecoverable.
- `[V]` **AI generate/edit is not undoable** — it calls `loadDesign`, which bumps `viewEpoch`, which clears `past`/`future` ([:1286-1297](../../src/store/useDesignStore.ts#L1286-L1297)). The AI panel warns *"This replaces the N walls currently in the design"* ([AIPanel.tsx:69-72](../../src/components/AIPanel.tsx#L69-L72)) but there is no way back.
- `[V]` **`units` and `constructionRate` are not undoable** — deliberate (they are view/preference), but `floorMaterial` **is** in the snapshot while `units` is not, which is inconsistent.
- `[V]` **`activeFloor` is in the snapshot**, so an undo after switching floors moves the user between storeys.
- `[V]` The recorder is a module-scope singleton. Two store instances (there is only one today) would share `historyCommitted`.

---

### 6. Layers & visibility
**Status:** STUB — there is no layer system; there are seven independent visibility booleans
**Owning files:** [useDesignStore.ts:354-379](../../src/store/useDesignStore.ts#L354-L379), [App.tsx:73-89](../../src/App.tsx#L73-L89)
**What actually exists:** `blueprint.visible` + `blueprint.opacity`; `vastuGrid`; `showDimensions`; `showCompass`; the six `*PanelOpen` flags; the ghosting of inactive storeys (`GHOST_OPACITY` 0.22 for walls, 0.16 for slabs).
**AI involvement:** none
**Tests:** `[X]` none
**Known limitations:** `[X]` **No user-definable layers, no per-object visibility, no lock, no layer colour/lineweight, no print-layer set.** grep `layer|Layer` across `src/` → the only hits are CSS z-index utility classes and `three` internals.
**Open questions:** none — the subsystem simply is not there.

---

### 7. Measurement, dimensions, annotation
**Status:** PARTIAL
**Owning files:** [draw.ts:1405-1544](../../src/plan/draw.ts#L1405-L1544) (2D), [DimensionLabels.tsx](../../src/scene/DimensionLabels.tsx) (168, 3D), [planSheet.ts](../../src/plan/planSheet.ts) (print), [length.ts](../../src/units/length.ts) (254)
**Entry point:** [draw.ts:1405](../../src/plan/draw.ts#L1405) `drawDimensions`
**Responsibility:** Draws an architectural dimension per wall in plan, opening widths behind a switch, and floating measurement chips in 3D.
**Control flow (2D):** for each wall → project to screen → skip if `span < 46 px` → skip if the label is wider than the run → `outwardNormal` picks the side away from the plan centre → witness lines, 45° ticks, `readingAngle` keeps text upright.
**AI involvement:** none
**Tests:** `[X]` none
**Known limitations (observed):**
- `[V]` **Dimensions are auto-generated per wall only.** There is no user-placed dimension, no chained/running dimension, no radial/angular dimension, no leader, no text annotation, no revision cloud, no hatch tool. `[X]` grep `annotation|leader|callout|dimension.*create` → nothing.
- `[V]` **Dimensions are dropped silently when they do not fit** ([:1421, 1426](../../src/plan/draw.ts#L1421)). Zoomed out, a plan shows no dimensions at all with no indication that any were suppressed.
- `[V]` `formatLength` is lossy and `parseLength` is **not** its inverse — stated at [length.ts:9-12](../../src/units/length.ts#L9-L12). The codebase respects this; it is a trap for future work.
- `[V]` `formatLengthCompact` drops the inch mark (`12'6`) and `formatArea` inserts thousands separators — the latter deliberately not applied to lengths *"a comma would stop the result parsing back"* ([:141-144](../../src/units/length.ts#L141-L144)).

---

### 8. Scale / calibration ★ HIGH PRIORITY
**Status:** **BROKEN** — the manual calibration is silently overwritten by an AI estimate on a specific, reachable path. Full trace: [Q1 in 10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md#q1).
**Owning files:** [blueprint/calibration.ts](../../src/blueprint/calibration.ts) (50), [BlueprintPanel.tsx:143-179](../../src/components/BlueprintPanel.tsx#L143-L179), [detectOpenings.ts:126-159](../../src/blueprint/detectOpenings.ts#L126-L159) `applyPlanScale`, [useDesignStore.ts:172-190, 992-1003](../../src/store/useDesignStore.ts#L992-L1003), [config.ts:121-126](../../src/scene/config.ts#L121-L126)
**Entry point:** [BlueprintPanel.tsx:143](../../src/components/BlueprintPanel.tsx#L143) `applyCalibration()`
**Responsibility:** Converts the blueprint image's pixels to real-world metres, so traced and detected walls come out at true size.
**Key data:** **`Blueprint.metresPerPixel` is the only screen↔world conversion factor in the entire model.** Everything else is already metric. Default `0.01` (1 px = 1 cm).
**Inputs:** two raw (unsnapped) world picks + a length the user types in metres; OR the vision model's `widthFeet`/`depthFeet` + normalized `box`.
**Outputs:** `updateBlueprint({metresPerPixel, origin})`. Consumed by `segmentsToWalls` ([detectWalls.ts:840](../../src/blueprint/detectWalls.ts#L840)), `placeOpenings`/`toWorld` ([detectOpenings.ts:179, 270](../../src/blueprint/detectOpenings.ts#L270)), and `drawBlueprint` ([draw.ts:347-352](../../src/plan/draw.ts#L347)).
**State touched:** `blueprint.metresPerPixel`, `blueprint.origin`; module-scope `calibratedSrc` and `picks`.
**AI involvement:** **YES, and it wins.** `applyPlanScale` writes the scale from an LLM's reading of dimension text, and never consults `isCalibrated()`.
**Error handling:** clamped to `[1e-5, 1]` ([BlueprintPanel.tsx:151-157](../../src/components/BlueprintPanel.tsx#L151-L157)); non-finite or ≤0 typed input is refused with a message; `applyPlanScale` returns `{kind:'guess'}` when there is no box or no legible dimension.
**Tests:** `[X]` none
**Known limitations (observed):**
1. `[V]` **`applyPlanScale` never checks `isCalibrated(blueprint.src)`.** `isCalibrated` is exported from `calibration.ts:42` and imported by exactly one file — `BlueprintPanel.tsx:5` — where it only drives a warning label. See Q1.
2. `[V]` **`calibratedSrc` is module-scope and is never cleared** — not by `setBlueprint(null)`, not by `loadDesign`, not by `newDesign`. Loading a *different* image whose object URL happens to be reused would mis-report; more practically, the flag simply leaks across the session.
3. `[V]` **Calibration is neither saved nor undoable** (D1, D2 in [05_DATA_MODEL.md](05_DATA_MODEL.md)). Reload and the scale is gone.
4. `[V]` **The calibration input is metres-only**, hardcoded — `<span>metres</span>` at [BlueprintPanel.tsx:460](../../src/components/BlueprintPanel.tsx#L460) and `Number(knownLength)` at [:144](../../src/components/BlueprintPanel.tsx#L144) — in an app whose default display unit is feet-and-inches, and which has a `parseLength` that would accept `12'6"`.
5. `[V]` **The two scale paths use different clamps.** Manual: `[1e-5, 1]`. AI: **no clamp at all** ([detectOpenings.ts:144-153](../../src/blueprint/detectOpenings.ts#L144-L153)).
6. `[V]` **The two scale paths use different origin rules.** Manual keeps `picks[0]` fixed (zoom about the aimed point). AI **re-centres the image on the world origin** ([:147-152](../../src/blueprint/detectOpenings.ts#L147-L152)), moving the underlay out from under anything already traced.
**Open questions:** Was `applyPlanScale`'s unconditional write intended to be conditional? Nothing in the comments addresses the interaction with manual calibration.

---

### 9. 3D generation & rendering
**Status:** COMPLETE
**Owning files:** 23 files in [src/scene/](../../src/scene/) (3,488)
**Entry point:** [SceneCanvas.tsx:26](../../src/scene/SceneCanvas.tsx#L26)
**Responsibility:** Extrudes the plan into a lit, orbitable, walkable 3D building, stacking up to three storeys.
**Control flow:** `Building` → `allFloors` → per storey a `<group position=[0, floorElevation(i), 0]>` → `FloorSlab` + `Walls` (ghosted unless open) → the open storey also gets furniture, stairs, room captions, dimension chips, door leaves.
**Key detail:** `wallPieces` slices, it does **not** CSG-subtract — reasoning at [wallGeometry.ts:41-49](../../src/scene/wallGeometry.ts#L41-L49). Rotation is `atan2(-dz, dx)`; the negated `dz` is what keeps the build from mirroring the plan ([:19-24](../../src/scene/wallGeometry.ts#L19-L24)).
**AI involvement:** none in rendering. The 2D→3D *transition* triggers an LLM call (subsystem 8 / Q1).
**Error handling:** `CharacterAvatar` wraps the GLB load in a class error boundary + `<Suspense>` so a missing model degrades to an empty follow-camera ([:189-216](../../src/scene/CharacterAvatar.tsx#L189-L216)).
**Tests:** `[X]` none
**Known limitations (observed):**
- `[V]` **Exactly three storeys, always.** `floors` is initialised to `[emptyFloor(0),emptyFloor(1),emptyFloor(2)]` and `loadDesign` hard-codes `[0,1,2]`. No add/remove floor action exists.
- `[V]` **No roof, no ceiling, no openings in slabs.** A staircase rises to a solid slab.
- `[V]` Two module-scope disposal patterns per wall (`materials.forEach(dispose)`), one texture clone per wall piece — see Q9 in [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md).

---

### 10. Import: image
**Status:** COMPLETE — see [08_IMPORT_PIPELINE.md](08_IMPORT_PIPELINE.md)
**Owning files:** [blueprint/load.ts](../../src/blueprint/load.ts) (49), [blueprint/raster.ts](../../src/blueprint/raster.ts) (173), [BlueprintPanel.tsx](../../src/components/BlueprintPanel.tsx) (612), [ProjectsMenu.tsx:290-304](../../src/components/ProjectsMenu.tsx#L290-L304)
**Accepted:** `image/*` by MIME, with `/\.(png|jpe?g|webp|gif|bmp)$/i` as the fallback for drag-drops with an empty type ([load.ts:44-49](../../src/blueprint/load.ts#L44-L49))
**Error handling:** four distinct messages — not an image, no pixels, could not decode, canvas cannot read pixels (tainted/OOM) ([raster.ts:59-60, 78, 94, 128, 146](../../src/blueprint/raster.ts#L128))
**Tests:** `[X]` none (10 sample images exist under `samples/`, used by nothing)
**Known limitations:** `[V]` The image lands at the **default guess** scale, not calibrated. `[V]` `rasterise` up-scales small images to 1400 px with nearest-neighbour so hairline walls survive thresholding ([:110-135](../../src/blueprint/raster.ts#L110-L135)) — a genuinely considered decision.

---

### 11. Import: PDF
**Status:** **ABSENT** `[X]`
Searched: `grep -rn "pdf" --include='*.ts*' src/` → hits are all in `export/` (writing). `grep -rni "pdfjs|getDocument|pdf.worker|application/pdf" src/` → only `type:'application/pdf'` in [pdf.ts:174](../../src/export/pdf.ts#L174) (a Blob MIME for **output**). File pickers accept `image/*` and `application/json,.json` only ([BlueprintPanel.tsx:317](../../src/components/BlueprintPanel.tsx#L317), [ProjectsMenu.tsx:586](../../src/components/ProjectsMenu.tsx#L586)). No PDF parsing dependency in `package.json`.

---

### 12. Import: DWG
**Status:** **ABSENT** `[X]`
Searched: `grep -rni "dwg|teigha|oda|realdwg|autocad" src server package.json` → 0 hits.

---

### 13. Import: DXF
**Status:** **ABSENT** `[X]`
Searched: `grep -rni "dxf|ENTITIES|LWPOLYLINE|AcDb" src server package.json` → 0 hits.

---

### 14. Computer vision pipeline
**Status:** COMPLETE for its stated scope (axis-aligned solid walls); BROKEN for anything else, and it says so in the UI
**Owning files:** [blueprint/detectWalls.ts](../../src/blueprint/detectWalls.ts) (851), [blueprint/raster.ts](../../src/blueprint/raster.ts) (173)
**Entry point:** [detectWalls.ts:716](../../src/blueprint/detectWalls.ts#L716) `detectWallSegments(image, options?)`
**Responsibility:** Finds horizontal and vertical wall bands in a floor-plan raster and returns them as pixel segments with a thickness.
**Key types:** `RasterLike {data,width,height}`, `PixelSegment {x1,y1,x2,y2,thickness}`, `Band`, `Oriented`, `DetectOptions` (9 knobs)
**Control flow:** `sizedDefaults` rescales the pixel thresholds by `longest/2000` → **four candidate binarisations** are tried (`inkMask` Otsu-on-luma with auto-invert, plus three `paperContrastMasks`: Chebyshev-distance-from-dominant-colour, darker-than-paper, lighter-than-paper) → each runs the band pipeline → `scoreSegments` (total wall length) picks the winner.
Per mask: `findBands` (length filter **before** union-find grouping — the trick that stops a band leaking down a crossing wall, [:412-418](../../src/blueprint/detectWalls.ts#L412-L418)) → `mergeCollinear` (bridge door gaps ≤ 12× thickness) → `keep` filters → `mergeWallFaces` (fuse the two drawn faces of an outlined wall) → thickness floor at 0.4× the length-weighted median → `snapJunctions` (pull ends onto the crossing wall's centreline) → `requireJunction` prune.
**AI involvement:** **none.** This is fully deterministic.
**Error handling:** returns `[]` for images under 2×2 px; every mask path is total.
**Tests:** `[X]` none. `samples/blueprint-expected.json` exists and nothing reads it.
**Known limitations (observed, and stated in the UI):**
- `[V]` **Axis-aligned only.** Bands are found in the row-major mask and its transpose ([:770-775](../../src/blueprint/detectWalls.ts#L770-L775)). A 45° wall is invisible. The panel says so: *"hatched, outlined, or angled ones are invisible to it"* ([BlueprintPanel.tsx:533-536](../../src/components/BlueprintPanel.tsx#L533-L536)) — though `mergeWallFaces` does in fact handle outlined walls now, so that message is partly stale.
- `[V]` **Openings are deliberately not detected** — a door reads as a gap that `mergeCollinear` heals ([:713-715](../../src/blueprint/detectWalls.ts#L713-L715)). Openings come from the LLM instead.
- `[V]` **Synchronous and blocking.** Four full passes over up to 4 megapixels on the main thread. `yieldToPaint()` (2×rAF + setTimeout) exists only so the "Detecting…" label paints first ([BlueprintPanel.tsx:35-46](../../src/components/BlueprintPanel.tsx#L35-L46)). No web worker.

---

### 15. OCR
**Status:** **ABSENT as a subsystem** `[X]` — text on the drawing is read by the vision LLM, not by any OCR code.
Searched: `grep -rni "tesseract|ocr|recognize" src server package.json` → 0 hits. The dimension figures and room names are extracted by the prompt at [openingDetector.ts:44-57](../../server/openingDetector.ts#L44-L57), which asks the model to *"Read the overall dimension labels on the drawing"*.

---

### 16. AI / LLM integration
**Status:** PARTIAL — works in `vite dev` only, and one path is destructive. Full detail in [09_AI_INVENTORY.md](09_AI_INVENTORY.md).
**Owning files:** [server/aiPlugin.ts](../../server/aiPlugin.ts) (179), [server/designAgent.ts](../../server/designAgent.ts) (240), [server/openingDetector.ts](../../server/openingDetector.ts) (384), [src/ai/useDesignAI.ts](../../src/ai/useDesignAI.ts) (126), [src/blueprint/detectOpenings.ts](../../src/blueprint/detectOpenings.ts) (544), [src/blueprint/useBlueprintStructure.ts](../../src/blueprint/useBlueprintStructure.ts) (138)
**Entry point:** [aiPlugin.ts:74](../../server/aiPlugin.ts#L74) `aiPlugin(anthropicKey, openRouterKeys)`
**Three endpoints:** `/api/ai/generate`, `/api/ai/edit`, `/api/ai/openings`
**Models:** `anthropic/claude-sonnet-4.5` (generate/edit, paid) and `google/gemma-4-26b-a4b-it:free` (vision)
**AI involvement:** total
**Error handling:** multi-key failover; per-key failure strings joined; a dedicated "out of credit" message; `describeError` maps four Anthropic SDK error classes that **can no longer be thrown** on the OpenRouter fetch path.
**Tests:** `[X]` none
**Known limitations:** `[V]` production-absent (subsystem 23); `[V]` no retry on generate/edit, 2 attempts per key on openings; `[X]` no cache, no rate limit, no cost tracking; `[V]` `applyPlanScale` clobbers manual calibration (Q1); `[V]` AI edit destroys furniture, rooms, stairs, plot and upper floors (see [09_AI_INVENTORY.md](09_AI_INVENTORY.md)).

---

### 17. Vastu analysis
**Status:** COMPLETE
**Owning files:** [vastu/ruleset.ts](../../src/vastu/ruleset.ts) (178), [vastu/zones.ts](../../src/vastu/zones.ts) (214), [vastu/analyse.ts](../../src/vastu/analyse.ts) (399), [VastuPanel.tsx](../../src/components/VastuPanel.tsx) (339), [draw.ts:1048-1166](../../src/plan/draw.ts#L1048-L1166) (the grid overlay), [documents.ts:363-399](../../src/export/documents.ts#L363-L399) (the PDF page)
**Entry point:** [analyse.ts:71](../../src/vastu/analyse.ts#L71) `analyseVastu(rooms, walls, northOffset, plotFacing)`
**Key types:** `VastuZone = Facing | 'C'`, `VastuRule {label, ideal[], ok[], avoid[]}`, `RoomVerdict {room, zone, coverage, status, message}`, `VastuReport`
**Control flow:** `zoneFrame(walls, northOffset)` rotates every wall endpoint into a **north-up frame** by `−northOffset` about the plan centre, takes the bounding box **there**, and divides it into thirds → for each room, `dominantZone` clips the rotated polygon against all nine cells with Sutherland-Hodgman and compares areas → `statusFor(rule, zone)` → score = `(good×1 + okay×0.5)/scored × 100 − 10 if the centre is occupied`.
**AI involvement:** none
**Error handling:** no walls → `zoneFrame` returns null → empty verdicts; no rule → `'no-rule'`, excluded from the score; nothing named → `score: null` (not 0) with the reason printed.
**Tests:** `[X]` none
**Known limitations (observed):**
- `[V]` The grid is the **bounding box of the walls**, not the plot. A plan with a projecting balcony shifts every zone.
- `[V]` `ENTRANCE_RULE` is checked against `plotFacing`, not against any actual entrance door — acknowledged at [ruleset.ts:111-117](../../src/vastu/ruleset.ts#L111-L117).
- `[V]` `SITE_RULES` and `BRAHMASTHAN_RULE` are exported and **never referenced** — dead. `BRAHMASTHAN_AVOID` covers only toilet/bathroom/staircase, and `brahmasthanMessage` says so rather than guessing at "any heavy room" ([analyse.ts:264-283](../../src/vastu/analyse.ts#L264-L283)).
- `[V]` `analyseVastu` is called from **two places with different room orderings** — `VastuPanel` sorts largest-first ([:71-73](../../src/components/VastuPanel.tsx#L71-L73)), `statement.ts` uses `resolveRooms` order (also largest-first, [plan/rooms.ts:57](../../src/plan/rooms.ts#L57)). They agree today by coincidence of both being sorted; nothing enforces it, and `statement.ts` index-aligns `names[index]` to `report.rooms[index]` ([statement.ts:321-330](../../src/export/statement.ts#L321-L330)), which breaks if they ever diverge.
**Strength worth naming:** the epistemics are unusually careful — `'no-rule'` is a distinct status from `'okay'`, coverage below 75% is hedged in the sentence, and every surface carries the same caveat ([VastuPanel.tsx:279-283](../../src/components/VastuPanel.tsx#L279-L283), [documents.ts:200-202](../../src/export/documents.ts#L200-L202)).

---

### 18. BOQ / cost estimation
**Status:** PARTIAL — it is a single-rate area multiplication, not a bill of quantities
**Owning files:** [statement.ts:258-273](../../src/export/statement.ts#L258-L273) `estimateCost`, [RoomSchedulePanel.tsx:308-445](../../src/components/RoomSchedulePanel.tsx#L308-L445), [documents.ts:239-256](../../src/export/documents.ts#L239-L256)
**Entry point:** [statement.ts:258](../../src/export/statement.ts#L258)
**Control flow:** `cost = round(builtUpSqFt × ratePerSqFt)` per storey; the total is the **sum of the rounded per-floor figures** so the printed column adds up ([:270](../../src/export/statement.ts#L270)).
**AI involvement:** none
**Error handling:** rate ≤ 0 → `cost: null` (not 0), *"a document showing ₹0 would read as a quotation for free work"* ([:64-69](../../src/export/statement.ts#L64-L69)).
**Tests:** `[X]` none
**Known limitations:** `[X]` **No quantities of anything.** No materials, no labour, no line items, no wall/plaster/paint areas, no concrete volumes, no openings schedule with counts, no wastage, no taxes. One number × one rate. The caveat printed with it says as much ([documents.ts:194-197](../../src/export/documents.ts#L194-L197)).

---

### 19. Export (any format)
**Status:** COMPLETE
**Owning files:** [export/pdf.ts](../../src/export/pdf.ts) (975), [export/documents.ts](../../src/export/documents.ts) (466), [export/statement.ts](../../src/export/statement.ts) (522), [plan/planSheet.ts](../../src/plan/planSheet.ts) (874), [persistence/imageExport.ts](../../src/persistence/imageExport.ts) (83), [persistence/files.ts](../../src/persistence/files.ts) (46)
**Entry point:** [documents.ts:83](../../src/export/documents.ts#L83) `downloadPlanPdf`
**Six outputs:** plan-set PDF (one A4-landscape sheet per storey at 3000×2121 JPEG q0.92, then the area statement and Vastu pages), area-statement PDF, area-statement CSV (BOM + CRLF + RFC-4180), plan PNG (2000×1414), 3D-viewport PNG, project `.json`.
**AI involvement:** none
**Error handling:** `runExport` wraps each in try/catch and surfaces the message ([ProjectsMenu.tsx:266-288](../../src/components/ProjectsMenu.tsx#L266-L288)); `readJpeg` throws on non-JPEG, zero-sized frames, and CMYK ([pdf.ts:761-808](../../src/export/pdf.ts#L761-L808)); an empty document still gets a blank page ([pdf.ts:907-918](../../src/export/pdf.ts#L907-L918)).
**Tests:** `[X]` none
**Known limitations (observed):**
- `[V]` **WinAnsi text only.** *"Devanagari, Tamil, or any other non-Latin script will NOT render — it becomes `?`"* ([pdf.ts:34-36](../../src/export/pdf.ts#L34-L36)). In an app aimed at India, a project name or room name in an Indic script prints as question marks. The `₹` case is handled by transliterating to `Rs.` ([:231-241](../../src/export/pdf.ts#L231-L241)); nothing else is.
- `[V]` **No compression in the PDF.** Content streams are plain text ([:26-28](../../src/export/pdf.ts#L26-L28)).
- `[V]` **JPEG only for images** — a PNG would need zlib, which is not present.
- `[V]` The plan PNG exports **the open storey only** ([ProjectsMenu.tsx:189-197](../../src/components/ProjectsMenu.tsx#L189-L197)); the PDF exports all of them.
- `[V]` `documents.ts:456-466` duplicates `imageExport.ts:72-83` verbatim (`triggerDownload`), with a comment admitting it: *"duplicating beats reaching across"*.

---

### 20. Persistence & serialization
**Status:** PARTIAL — see Q8 in [05_DATA_MODEL.md](05_DATA_MODEL.md) for the nine defects
**Owning files:** [persistence/](../../src/persistence/) (7 files, 1050)
**Entry point:** [schema.ts:325](../../src/persistence/schema.ts#L325) `parseDesign(value)`
**AI involvement:** **indirect but important** — AI output is routed through the *same* `parseDesign` as an imported file ([useDesignAI.ts:62-68](../../src/ai/useDesignAI.ts#L62-L68)). This is the single best structural decision in the AI integration.
**Error handling:** the malformed/odd distinction is real and consistently applied; every `localStorage` access is try/catch-wrapped with a quota-specific message ([storage.ts:28-44](../../src/persistence/storage.ts#L28-L44)).
**Tests:** `[X]` none
**Known limitations:** D1–D9 in [05_DATA_MODEL.md](05_DATA_MODEL.md). Most consequential: **autosave's dirty check watches only `walls`** (D8), and **the blueprint is never persisted** (D1).

---

### 21. Project management / dashboard
**Status:** PARTIAL
**Owning files:** [ProjectsMenu.tsx](../../src/components/ProjectsMenu.tsx) (655), [storage.ts](../../src/persistence/storage.ts) (133)
**What exists:** name + save, list (sorted by `savedAt` desc, showing wall count), open, delete, new, import, six exports.
**AI involvement:** none
**Tests:** `[X]` none
**Known limitations:**
- `[V]` **`readProjects()` re-runs `parseDesign` on every stored project on every call** ([storage.ts:47-68](../../src/persistence/storage.ts#L47-L68)), and it is called by `listProjects`, `saveProject`, `loadProject` and `deleteProject`. Autosave calls `saveProject` every 4 s while a project is open → the entire project library is parsed and re-serialised every 4 seconds. See Q9.
- `[V]` **No rename.** Saving under a new name creates a copy and leaves the original.
- `[V]` **Delete has no confirmation** ([:412-419](../../src/components/ProjectsMenu.tsx#L412-L419)).
- `[V]` **Overwrite has no confirmation** — keyed on name ([storage.ts:82](../../src/persistence/storage.ts#L82)).
- `[X]` No thumbnails, no folders, no search, no sort control, no duplicate action.

---

### 22. Auth & user accounts
**Status:** **ABSENT** `[X]`
Searched: `grep -rni "auth|login|signin|session|jwt|token|user|password|oauth|supabase|firebase|clerk" src server package.json` → hits are `userContent` (a prompt variable, [designAgent.ts:123](../../server/designAgent.ts#L123)) and Tailwind `select-none`. No auth dependency, no login UI, no session, no user model. The app is entirely local and anonymous.

---

### 23. Backend API surface
**Status:** **BROKEN for production; COMPLETE for `vite dev`**
**Owning files:** [server/aiPlugin.ts](../../server/aiPlugin.ts) (179)
**Entry point:** [aiPlugin.ts:121](../../server/aiPlugin.ts#L121) `configureServer(server)`
**The complete surface — three endpoints:**

| Method | Path | Body | Max body | Success | Failure codes |
|---|---|---|---|---|---|
| POST | `/api/ai/generate` | `{brief: string}` | 1 MB | `{name, notes, walls[]}` | 405 non-POST · 503 no key · 400 bad JSON · 401→502 · 429 · 504 · 500 |
| POST | `/api/ai/edit` | `{instruction: string, design: unknown}` | 1 MB | same | same |
| POST | `/api/ai/openings` | `{image: "data:image/…"}` | 8 MB | `PlanAnalysis` | 405 · 503 · 400 · 502/500 |

**Error handling:** `describeError` ([:55-72](../../server/aiPlugin.ts#L55-L72)) maps four `Anthropic.*Error` classes; the full error is `console.error`'d server-side and only a summary reaches the client ([:113-115](../../server/aiPlugin.ts#L113-L115)).
**Tests:** `[X]` none
**Known limitations (observed):**
1. `[V]` **`configureServer` runs only under `vite dev`.** `npm run build` emits the front end alone; `npm run preview` serves it without the middleware. Every AI feature 404s in any deployed build. Stated in the source ([:15-17](../../server/aiPlugin.ts#L15-L17)) and the README.
2. `[V]` **`describeError`'s Anthropic branches are unreachable.** No Anthropic client is constructed anywhere; the OpenRouter path is a bare `fetch` that throws `TypeError` or a plain `Error`. Every real failure falls to the generic 500 branch.
3. `[X]` **No CORS handling, no auth, no rate limiting, no request logging, no per-IP quota.** In dev this is same-origin, so it is not currently exposed — but the surface has no guard of any kind.
4. `[V]` **The 503 message names `OPENROUTER_API_KEY`** while the README tells the user to set `ANTHROPIC_API_KEY`.
5. `[V]` `readBody` rejects and calls `req.destroy()` past the cap ([:41-47](../../server/aiPlugin.ts#L41-L47)) — the rejection reaches `handle`'s catch and returns 500 with `"Request body too large."` rather than a 413.

---

### 24. Database schema
**Status:** **ABSENT** `[X]` — there is no database.
Searched: `grep -rni "sql|prisma|drizzle|mongo|postgres|sqlite|knex|typeorm|indexedDB|openDatabase" src server package.json` → 0 hits. The only durable stores are two `localStorage` keys, `space-design.projects.v1` and `space-design.autosave.v1` ([storage.ts:3-4](../../src/persistence/storage.ts#L3-L4)). Their "schema" is `DesignDocument`, documented in [05_DATA_MODEL.md](05_DATA_MODEL.md).

---

### 25. Collaboration / sharing
**Status:** PARTIAL — one-way, read-only, snapshot-in-URL sharing. No collaboration.
**Owning files:** [shareLink.ts](../../src/persistence/shareLink.ts) (94), [ShareButton.tsx](../../src/components/ShareButton.tsx) (131), [useSharedDesign.ts](../../src/persistence/useSharedDesign.ts) (86), [SharedBanner.tsx](../../src/components/SharedBanner.tsx) (107)
**Entry point:** [shareLink.ts:48](../../src/persistence/shareLink.ts#L48) `createShareLink(doc)`
**Control flow:** `JSON.stringify` → `CompressionStream('gzip')` → base64url → `#design=g…`. Tagged `g`/`r` so a link made with compression opens in a browser without it. Decoding goes through `parseDesign`.
**Read-only enforcement:** `readOnly` gates the toolbar ([App.tsx:66-70](../../src/App.tsx#L66-L70)), every editing panel ([:53](../../src/App.tsx#L53)), autosave ([:50](../../src/App.tsx#L50)), the undo shortcut ([useUndoShortcut.ts:28](../../src/components/useUndoShortcut.ts#L28)), the delete shortcut ([useDeleteShortcut.ts:34](../../src/components/useDeleteShortcut.ts#L34)), and every 3D click handler ([Walls.tsx:210,219](../../src/scene/Walls.tsx#L210), [FloorSlab.tsx:87](../../src/scene/FloorSlab.tsx#L87), [Stairs.tsx:75](../../src/scene/Stairs.tsx#L75), [FurnitureModels.tsx:48](../../src/scene/FurnitureModels.tsx#L48), [CompassWidget.tsx:122](../../src/components/CompassWidget.tsx#L122)). **This is thorough.**
**AI involvement:** none
**Error handling:** a damaged link still enters read-only with the reason shown, rather than silently dropping into the editor ([useSharedDesign.ts:34-45](../../src/persistence/useSharedDesign.ts#L34-L45)).
**Tests:** `[X]` none
**Known limitations:**
- `[X]` **No real collaboration** — no realtime, no presence, no comments, no CRDT, no server. grep `yjs|automerge|socket|liveblocks|presence` → 0 hits.
- `[V]` **URL length is an unenforced ceiling.** The comment estimates ~800 chars for a small plan ([README.md:106](../../README.md#L106)); a three-storey furnished design is far larger and nothing checks the result against any browser or chat-client limit. `[U]` No maximum is tested or reported.
- `[V]` `Edit a copy` uses raw `setState` rather than an action ([SharedBanner.tsx:22](../../src/components/SharedBanner.tsx#L22)).

---

### 26. Testing infrastructure
**Status:** **ABSENT** `[X]`
`find . -name '*.test.*' -o -name '*.spec.*' -o -name '__tests__' -o -name 'vitest.config*' -o -name 'jest.config*' -o -name 'playwright.config*'` (excluding `node_modules`) → **zero results.** No `test` script in `package.json`. No test dependency. No CI (`ls -a` shows no `.github/`, no `.gitlab-ci.yml`).

**What exists instead:**
- `[V]` **121 `data-testid` attributes (100 distinct)** across the components — written for a suite that is not here.
- `[V]` `samples/` holds 7 SVG + 3 PNG fixture blueprints, a generator (`gen-blueprint.mjs`), and **`blueprint-expected.json`** — a golden file with no consumer. `[X]` grep `blueprint-expected` across `src`/`server` → 0 hits.
- `[V]` Several modules were deliberately kept pure **for testability** and say so: `walkMotion.ts` (*"kept separate to test"*, [README.md:190](../../README.md#L190)), `wallGeometry.ts` (*"kept pure and tested"*, [README.md:285](../../README.md#L285)), `detectWalls.ts` (`RasterLike` exists *"so the detector runs outside a browser too"*, [:100](../../src/blueprint/detectWalls.ts#L100)).

The architecture is unusually test-*ready* — ~2,300 LOC of pure functions with explicit seams — and none of it is tested.

---

## Q11 — The honest completion matrix

Traced from user click to persisted result. **Anything I could not trace end to end has been downgraded.**

| # | Feature | Status | Evidence / limitation |
|---|---|---|---|
| 1 | Draw a wall chain in 2D | **COMPLETE** | click → `addWall` → store → repaint → autosave → `serializeDesign` → `parseDesign` on reload. Full round trip traced. `[V]` |
| 2 | Place door / window (2D or 3D) | **COMPLETE** | `addOpening` → `constrainOpening` → nested in `Wall` → persisted → `parseOpening` on load `[V]` |
| 3 | Edit wall height / thickness / material | **COMPLETE** | `updateWall` → `normalizeWall` → persisted `[V]` |
| 4 | Set exact wall length (typed, unit-aware) | **COMPLETE** | `WallLengthField` → `parseLength` → `setWallLength` → pivots on `start` `[V]` |
| 5 | Delete wall / opening / furniture / stair | **COMPLETE** | Delete key + inspector button; selection cleared `[V]` |
| 6 | Undo / redo | **PARTIAL** | Covers 10 design fields. **Excludes blueprint calibration** and is **cleared by every AI result and every `loadDesign`** `[V]` |
| 7 | 2D→3D extrusion | **COMPLETE** | `wallPieces` → sliced boxes, correct rotation sign, per-piece real-size textures `[V]` |
| 8 | Multi-storey (3 floors) | **PARTIAL** | Exactly 3, hard-coded. Copy-up refuses a non-empty target. A 4-floor file loses floor 4 **silently** `[V]` |
| 9 | Orbit / pan / zoom 3D | **COMPLETE** | `OrbitControls` + `FrameBuilding` refit `[V]` |
| 10 | First-person walk | **PARTIAL** | Works, but **has no collision** — `WalkControls` never calls `moveWithCollisions`; only `ThirdPersonControls` does. You walk through walls in eyes-mode and not in follow-mode `[V]` [WalkControls.tsx:118-143](../../src/scene/WalkControls.tsx#L118-L143) vs [ThirdPersonControls.tsx:207](../../src/scene/ThirdPersonControls.tsx#L207) |
| 11 | Third-person walk with character | **COMPLETE** | GLB + Mixamo retarget, swept collision, camera pull-in, walk/idle blend, error boundary `[V]` |
| 12 | Door leaves swing open | **COMPLETE** | Proximity-triggered, side latched on first move `[V]` |
| 13 | Furniture: drag from panel to 2D | **COMPLETE** | Custom MIME → `worldAt` → `addFurniture` `[V]` |
| 14 | Furniture: drag from panel to 3D | **COMPLETE** | NDC → `Raycaster` → floor `Plane` at the active storey's elevation `[V]` |
| 15 | Furniture: move / rotate / resize | **COMPLETE** | Drag in plan; X/Z/rotate-90°/width/length in the inspector `[V]` |
| 16 | Name a room, see its area | **COMPLETE** | click open floor → `Selection{kind:'room',anchor}` → `nameRoom` → containment-resolved → persisted as `RoomLabel` `[V]` |
| 17 | Room schedule + floor size | **COMPLETE** | Live-derived; open-plan extra labels handled `[V]` |
| 18 | Plot boundary + setbacks + buildable area | **COMPLETE** | Facing- and north-aware edge mapping; violations drawn red on canvas and listed in the panel `[V]` |
| 19 | Compass / north rotation | **COMPLETE** | Draggable rose, 8-point snap, Shift for free angle, persisted `[V]` |
| 20 | Vastu report | **COMPLETE** | Area-weighted dominant zone, coverage hedging, `no-rule` status, score, PDF page `[V]` |
| 21 | Vastu zone grid overlay | **COMPLETE** | Rotated frame, dedup'd shared edges, labels dropped when they do not fit `[V]` |
| 22 | Cost estimate | **PARTIAL** | `area × rate` only. Not a BOQ. Correctly refuses to print ₹0 `[V]` |
| 23 | Area statement (PDF/CSV) | **COMPLETE** | Same `AreaStatement` object feeds panel, PDF and CSV `[V]` |
| 24 | Floor-plan PDF (drawing set) | **PARTIAL** | Works, but **non-Latin text renders as `?`** — a stated, unmitigated limitation in an India-targeted product `[V]` [pdf.ts:34-36](../../src/export/pdf.ts#L34-L36) |
| 25 | Plan PNG export | **COMPLETE** | Open storey, 2000×1414 `[V]` |
| 26 | 3D view PNG export | **COMPLETE** | `preserveDrawingBuffer` set; button disabled unless in 3D; failure reported `[V]` |
| 27 | Project save / open / delete / new | **PARTIAL** | No rename, no overwrite confirm, no delete confirm; full library re-parsed on every read `[V]` |
| 28 | Import `.json` project | **COMPLETE** | `parseDesign` gate, warning count surfaced `[V]` |
| 29 | Autosave + restore | **PARTIAL** | **Dirty check watches `walls` only.** Renaming rooms, moving furniture, editing the plot, changing north or the rate does not trigger a save. Restore is guarded against StrictMode `[V]` [useAutosave.ts:73](../../src/persistence/useAutosave.ts#L73) |
| 30 | Read-only share link | **COMPLETE** | gzip+base64url fragment, `readOnly` enforced at 10 sites, `Edit a copy` releases it `[V]` |
| 31 | Present mode | **COMPLETE** | Forces 3D + walk, hides chrome, auto-hiding exit, double-Esc `[V]` |
| 32 | Blueprint image import | **COMPLETE** | Two entry points, one loader, four error messages `[V]` |
| 33 | Blueprint manual calibration | **BROKEN** | Works in isolation, then **is silently overwritten** by `applyPlanScale` on the 2D→3D path when the floor has no walls. Not persisted, not undoable. See Q1 `[V]` |
| 34 | Blueprint wall detection (CV) | **COMPLETE** | 4 binarisations scored against each other; staged for review before commit `[V]` |
| 35 | Blueprint door/window detection (AI) | **PARTIAL** | Free model, 2 attempts/key, truncation salvage. Widths outside a sane band are replaced with defaults. Openings that land on no wall are dropped and **counted**, which is honest `[V]` |
| 36 | Auto-build 3D from blueprint on 2D→3D | **PARTIAL** | Works, and is the mechanism that destroys the calibration. Guarded on `walls.length===0`, so it fires exactly when the user has calibrated but not yet traced `[V]` |
| 37 | Place kitchen counters / toilets | **COMPLETE** | Deterministic; seats each fixture against the nearest wall of its named room `[V]` |
| 38 | AI: generate plan from a brief | **BROKEN in any deployed build; PARTIAL in dev** | `configureServer` does not run for `vite build`/`preview`. In dev: works, output validated by `parseDesign`, **but replaces the whole design and clears undo** `[V]` |
| 39 | AI: edit plan by instruction | **BROKEN in any deployed build; BROKEN in dev too** | Same production problem, **plus** `useDesignAI.edit` sends walls only and `loadDesign`s walls only — **furniture, room names, stairs, plot, north, rate and all upper floors are destroyed** by every AI edit, with no warning and no undo. See [09_AI_INVENTORY.md](09_AI_INVENTORY.md) `[V]` [useDesignAI.ts:86-89](../../src/ai/useDesignAI.ts#L86-L89) |
| 40 | Dimensions overlay (2D + 3D) | **COMPLETE** | Auto per wall; opening widths behind a switch; 3D chips with per-frame declutter `[V]` |
| 41 | Units ft-in ↔ m | **COMPLETE** | Display-only; `parseLength` accepts `12'6"`, `3.81m`, `381cm`, `6 3/4"` `[V]` |
| 42 | Materials / finishes | **COMPLETE** | 9 procedural textures, tiled against real dimensions `[V]` |
| 43 | Stairs | **PARTIAL** | Place, move, rotate, resize, comfort warnings, 3D flight, plan symbol with tread count and UP arrow. **But no opening is cut in the slab above**, so the flight rises into solid concrete `[V]` — no code path modifies `FloorSlab` for stairs |
| 44 | Copy floor to the one above | **COMPLETE** | Fresh ids, refuses a non-empty target, stairs deliberately excluded `[V]` |
| 45 | `SITE_RULES` / `BRAHMASTHAN_RULE` | **DEAD** | Exported, zero call sites `[V]` |
| 46 | `zoneOfPoint`, `sectorOfPoint`, `bearingBetween`, `northScreenAngle`, `rectCenter`, `buildPdfBytes`, `clearAutosave` | **DEAD** | Exported, zero call sites `[V]` — see [11_TECH_DEBT.md](11_TECH_DEBT.md) |
| 47 | `samples/blueprint-expected.json` + 10 fixture images | **DEAD** | No consumer `[V]` |
| 48 | `@anthropic-ai/sdk` error branches in `describeError` | **DEAD** | Unreachable — no Anthropic client exists `[V]` |
| 49 | `serializeDesign`'s `stairs` parameter | **DEAD** | Accepted, never written to the document `[V]` |

**Tally:** COMPLETE 27 · PARTIAL 13 · BROKEN 4 · DEAD 5 · ABSENT (subsystems) 6
