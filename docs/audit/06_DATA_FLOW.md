# 06 — Data Flow

Real function names on every arrow. All `[V]` unless tagged otherwise.

---

## 1. New project

```
ProjectsMenu "New" button                              ProjectsMenu.tsx:427
   └─▶ handleNew()                                     ProjectsMenu.tsx:178-182
         ├─▶ newDesign()                               useDesignStore.ts:1134-1148
         │     set({ floors:[emptyFloor(0),emptyFloor(1),emptyFloor(2)],
         │           activeFloor:0, walls:[], furniture:[], roomLabels:[],
         │           stairs:[], plot:null,
         │           floorMaterial:DEFAULT_FLOOR_MATERIAL,
         │           projectName:null, selection:null, walkMode:false,
         │           viewEpoch: state.viewEpoch + 1 })          ← the trigger
         ├─▶ setDraftName('')
         └─▶ setOpen(false)

   viewEpoch bump fans out to three watchers:
     ├ useDesignStore.subscribe (:1286)  → historyCommitted = snap;
     │                                     setState({past:[],future:[]})
     ├ FloorPlanEditor useEffect (:351)  → planBounds(walls)===null
     │                                   → viewportRef.current = createViewport()
     └ FrameBuilding useEffect (:22)     → planBounds(allFloors)===null → return
                                            (camera is NOT reset)

   ⚠ NOT cleared by newDesign(): blueprint, units, constructionRate,
     northOffset, plotFacing, readOnly, every *PanelOpen flag, viewMode.
     Compare loadDesign (:1076-1132), which DOES reset most of them.
```

---

## 2. Manual drawing — the wall chain

```
user left-click on the plan canvas
 └─▶ FloorPlanEditor.onPointerDown                     FloorPlanEditor.tsx:438
      ├ button 1|2 or Space held → beginPan(); return          (:444-447)
      ├ blueprintCalibrating    → pickCalibrationPoint(); return (:452-455)
      │
      └ tool === 'wall'                                        (:457-469)
          point  = snappedAt(clientX, clientY)
                   └ worldAt() → screenToWorld(vp,w,h)          viewport.ts:34
                   └ snapToGrid(p, GRID_STEP[units].cell)       viewport.ts:85
                     ⚠ cell = 0.1524 m in 'ftin', 0.5 m in 'm'  length.ts:34-37
          if (anchorRef.current) addWall(anchor, point)         store:1150
                                   ├ samePoint → return null    (:1151)
                                   └ walls: [...state.walls, wall]
                                       id: crypto.randomUUID()
                                       height 3 · thickness 0.2 · openings []
                                       material DEFAULT_WALL_MATERIAL
          anchorRef.current = point ; setIsDrawing(true) ; requestDraw()

 ── every store write then fans out ─────────────────────────────────────────
    subscribe(requestDraw)  → rAF → drawPlan(ctx, scene)        draw.ts:294
    useMemo(resolveRooms)   → roomsRef.current → requestDraw()  (:261-271)
    useMemo(vastuZones)     → vastuRef.current → requestDraw()  (:279-286)
    the undo recorder       → coalesces for 200 ms, then pushes store:1312-1327

 ── chain ends ──────────────────────────────────────────────────────────────
    Esc (:365-378) or double-click (:709) → endChain() → anchorRef = null
    switching tool also ends it: useEffect([tool]) → endChain()  (:343-345)
```

**Placing a door/window** — a different path, on the same click handler:

```
tool === 'door' | 'window'
 └─▶ handleWallTargetedClick(tool, x, y)                       (:521-620)
      point     = worldAt(x,y)                    ⚠ UNSNAPPED, deliberately
      tolerance = HIT_TOLERANCE_PX(7) / viewport.scale   → constant screen px
      target    = pickWall(walls, point, tolerance)     wallGeometry.ts:203
                   reach = tolerance + wall.thickness/2
      addOpening(target.wall.id, tool, target.projection.t)     store:1223
        ├ wallLength(wall) < defaults.width → return null       (:1229)
        └ constrainOpening(...)                                 (:549-567)
            width    clamp(0.1 … wallLength)
            sill     clamp(0 … wall.height-0.05)
            height   clamp(0.1 … wall.height-sill)
            position clamp(width/2 … length-width/2)
      select({kind:'opening',…}) ; setTool('select')            (:611-616)

 The SAME action is reachable from 3D: Walls.tsx handleClick :214-241
   projectOntoWall(wall, {x:event.point.x, z:event.point.z}) → addOpening
```

---

## 3. Import: image (blueprint)

Two entry points, one loader.

```
A) BlueprintPanel "Choose an image"        BlueprintPanel.tsx:320
B) ProjectsMenu "Import" + isImageFile()   ProjectsMenu.tsx:290-304
                                             → setViewMode('2d')
                                             → setBlueprintPanelOpen(true)
        │
        └─▶ loadBlueprintFromFile(file)                    load.ts:16-41
              ├ rasterFromFile(file)                       raster.ts:161
              │   ├ decodeImageFile → <img> from objectURL (:56-99)
              │   └ rasterise(image, 2000)                 (:105-158)
              │       scale = longest>2000 ? 2000/longest
              │             : longest<1400 ? 1400/longest : 1
              │       ctx.imageSmoothingEnabled = false when scale>1
              │       fill '#ffffff' → drawImage → getImageData
              │       ⇒ { image: ImageData, scale, sourceWidth, sourceHeight }
              │       (the objectURL from decodeImageFile is released here)
              └ setBlueprint({                              store:983-990
                    src: URL.createObjectURL(file),  ← a NEW url, store-owned
                    width:  raster.sourceWidth,
                    height: raster.sourceHeight,
                    metresPerPixel: 0.01,       ← ★ THE DEFAULT GUESS
                    origin: { x: -(w*0.01)/2, z: -(h*0.01)/2 },
                    opacity: 0.5, visible: true })

  ⇒ FloorPlanEditor useEffect([blueprintSrc]) :294-331
      new Image(); onload → imageRef.current = image
                          → fitToBounds(vp, image extents)   viewport.ts:63
```

### Stage 3b — manual calibration (the only deterministic scale path)

```
"Calibrate the scale"  BlueprintPanel.tsx:411 → startCalibration()  (:131-135)
   clearCalibrationPicks(); setKnownLength(''); setBlueprintCalibrating(true)

click #1, click #2 on the plan canvas
   └ FloorPlanEditor.pickCalibrationPoint                   (:499-515)
        point = worldAt(...)        ⚠ RAW, never snapped — comment :493-498
        setCalibrationPicks([...picks, point])       calibration.ts:20-23
        on the 2nd pick → setBlueprintCalibrating(false)

BlueprintPanel reads them through useSyncExternalStore      (:95)
   measured = distance(picks[0], picks[1])                  viewport.ts:112

user types the real length in METRES → "Set scale"
   └ applyCalibration()                             BlueprintPanel.tsx:143-179
       metresPerPixel = clamp(1e-5 … 1,
                              blueprint.metresPerPixel * (typed / measured))
       factor = metresPerPixel / blueprint.metresPerPixel   ← post-clamp
       updateBlueprint({ metresPerPixel,                     store:992-1003
                         origin: anchor - (anchor-origin)*factor })
       markCalibrated(blueprint.src)                  calibration.ts:37-39
                                    ↑ a MODULE-SCOPE string, not store state
       clearCalibrationPicks(); setDetected(null)
```

### Stage 3c — deterministic wall detection

```
"Detect walls"  BlueprintPanel.tsx:499 → detect()            (:181-210)
  raster = rasterRef.current ?? await rasterFromSrc(blueprint.src)
  await yieldToPaint()          2×rAF + setTimeout — the work is BLOCKING
  segments = detectWallSegments(raster.image)          detectWalls.ts:716-745
    for each of candidateMasks(image):                  (:759-761)
        inkMask()             Otsu on luma, auto-invert (:153-182)
        paperContrastMasks()  ×3: chebyshev-from-paper, darker, lighter (:196)
      → segmentsFromMask()                              (:764-832)
          findBands(minLength)  run-length + union-find (:419-486)
          mergeCollinear(gap ≤ 12×thickness)            (:496-550)
          keep(): length/thickness/aspect/fill filters  (:701-708)
          mergeWallFaces()  fuse outlined walls         (:631-687)
          floor = typicalThickness × 0.4                (:794)
          snapJunctions() ends → crossing centreline    (:566-586)
          requireJunction filter                        (:800-809)
      → keep the mask whose scoreSegments() total length is highest
  walls = segmentsToWalls(segments, {                   (:840-851)
            metresPerPixel: blueprint.metresPerPixel / raster.scale,
            origin: blueprint.origin })
  setDetected(walls)        ← STAGED. Nothing is in the store yet.

"Add these walls" → addDetected()                            (:212-230)
  for (w of detected) addWall(w.start, w.end, {thickness:w.thickness})
```

### Stage 3d — AI opening/room/furniture read

```
"Detect doors & windows"  BlueprintPanel.tsx:552 → findOpenings() (:232-269)
  guard: walls.length === 0 → error, stop
  detectAndPlaceOpenings()                          detectOpenings.ts:459-479
    analyseBlueprint()                                       (:78-113)
      toSendableJpeg(src)  ≤1100 px longest, JPEG q0.82       (:522-544)
      POST /api/ai/openings  { image: dataURL }
        → aiPlugin :143-176  (8 MB body cap)
        → analysePlan(keys, image)                openingDetector.ts:230-270
            2 rounds × N keys, first non-empty read wins
            callModel → openrouter → gemma-4-26b:free
            parseCompletion → unfence → JSON.parse
              on parse failure → salvageOpenings/salvageLabels regex
        ⇐ { widthFeet, depthFeet, box, openings[], rooms[], furniture[] }
    placeOpenings(analysis.openings)                         (:167-195)
      world = origin + normalized × pixelDims × metresPerPixel
      pickWall(walls, world, SNAP_TOLERANCE_M = 2.2)
      addOpening → sensibleWidth() band-check → updateOpening
    placeRooms(analysis.rooms)      toRoomType keyword match → nameRoom
    placeFurniture(analysis.furniture)  toFurnitureType → addFurniture
                                        → fitToRoom() → updateFurniture
    placeKitchenCounters() / placeToiletFixtures()   deterministic fill

  ⚠ This path does NOT touch metresPerPixel. Comment :456-457:
    "Leaves the scale alone — the walls exist, and re-sizing them
     under the user is not what this button does."
```

`[X]` **PDF, DWG and DXF import do not exist.** See [08_IMPORT_PIPELINE.md](08_IMPORT_PIPELINE.md) for the searches run.

---

## 4. 2D → 3D  ★ the path Q1 is about

```
Toolbar Segmented "3D"  Toolbar.tsx:329 → setViewMode('3d')   store:784-785

App re-renders. Two things happen, in this order:

 (a) App.tsx:92   viewMode==='3d' → <SceneCanvas/> replaces <FloorPlanEditor/>

 (b) App.tsx:45   useBlueprintStructure()  — the hook was ALREADY mounted;
                  its effect re-runs because viewMode changed
     └ useBlueprintStructure.ts:56-118

        GUARDS, in order:
          if (viewMode!=='3d' || !blueprintSrc || !blueprintVisible) return  :57
          if (handled.current === blueprintSrc)                      return  :58
          if (useDesignStore.getState().walls.length > 0) {                  :60
                handled.current = blueprintSrc; return }      ← ★ THE GUARD
          handled.current = blueprintSrc

        async:
        1  setPhase({kind:'reading'})
           analysis = await analyseBlueprint()      ← LLM CALL, see §3d   :73
        2  scale = analysis.ok ? applyPlanScale(analysis.analysis)
                               : { kind:'guess' }                        :78-80
              ★ applyPlanScale WRITES blueprint.metresPerPixel
                detectOpenings.ts:126-159 — see Q1 in 10_KNOWN_ISSUES.md
        3  setPhase({kind:'building'})
           walls = await buildWallsFromBlueprint()  buildStructure.ts:44   :85
              rasterFromSrc → detectWallSegments → segmentsToWalls
                 metresPerPixel: blueprint.metresPerPixel / raster.scale
                 ← reads the scale applyPlanScale just wrote
              re-checks store.walls.length>0 after the await         :63-65
              for (wall of walls) addWall(...)
        4  placeOpenings(analysis.analysis.openings)                     :98
        5  placeRooms(...) ; placeFurniture(...)                       :101-102
        setPhase({kind:'built', …, scale})
        → App.tsx:107-139 paints the status banner
        → cleared after 6.5 s by the timer at :122-135

 (c) SceneCanvas mounts
       <Canvas> onCreated → cameraRef, registerSceneCanvas(gl.domElement)
       Building.tsx:42  storeys = useMemo(allFloors({...}))
         per storey: <FloorSlab walls ghost={!open}/>  <Walls walls ghost/>
         open only:  FurnitureModels · Stairs · RoomLabels ·
                     DimensionLabels · DoorLeaves
       Walls.tsx:119  wallPieces(wall)   ← the extrusion
         slices the span into: runs between openings, sill below, lintel above
         rotationY = atan2(-dz, dx)                  wallGeometry.ts:24
         y = SLAB.top + …                            config.ts:72 (0.006)
       FrameBuilding.tsx:22  refits the orbit camera on viewEpoch
```

---

## 5. Save / load

```
SAVE (explicit)                                    ProjectsMenu.handleSave :107
  name = draftName.trim()   (empty → error, stop)
  floors = allFloors(useDesignStore.getState())    store:616-635
             ↑ read imperatively — as a selector it would loop zustand
  doc = serializeDesign({ name, walls, furniture, roomLabels,
                          stairs: floors[0].stairs,   ← never written to doc
                          floors, plot, floorMaterial, viewMode, units,
                          constructionRate, northOffset, plotFacing })
                                                   schema.ts:70-104
  saveProject(doc)  → projects[doc.name] = doc → writeRaw(PROJECTS_KEY)
                                                   storage.ts:80-84
  setProjectName(name)

AUTOSAVE (every 4 s)                               useAutosave.ts:55-108
  if (walls === savedWallsRef.current) return   ⚠ ONLY walls are watched
  floors = allFloors(getState())
  doc = serializeDesign({...})
  writeAutosave({name: projectName, doc})   → AUTOSAVE_KEY
  if (projectName) saveProject(doc)         → overwrites the named project

LOAD (project)                                     ProjectsMenu.handleLoad :145
  doc = loadProject(name)                          storage.ts:86-88
          readProjects() → JSON.parse → parseDesign(value) per entry
                             ⚠ EVERY entry is re-validated on every read
  loadDesign({ name, walls, furniture, roomLabels: doc.rooms, plot,
               floors, stairs: doc.floors[0]?.stairs, floorMaterial,
               viewMode, units, constructionRate, northOffset, plotFacing })
                                                   store:1076-1132
    walls.map(normalizeWall)     ← re-clamps dimensions AND every opening
    floors → exactly 3 slots     ⚠ index >2 discarded silently
    selection: null · walkMode: false · viewEpoch + 1

RESTORE (startup)                                  useAutosave.ts:27-53
  guarded by a MODULE-SCOPE `restored` boolean (:16) — survives StrictMode
  entry = readAutosave() → parseDesign
  skip if (entry.doc.walls.length===0 && !entry.name)
  loadDesign({... same shape ...})
  savedWallsRef.current = getState().walls

SHARE-LINK LOAD                                    useSharedDesign.ts:22-83
  readShareFragment(window.location.hash)          shareLink.ts:59
  decodeShareLink(payload) → fromBase64Url → gunzip → JSON.parse
                           → parseDesign
  loadDesign({..., readOnly: true})
  on failure → loadDesign({walls:[], readOnly:true, viewMode:'3d'}) + message
  also re-runs on 'hashchange'
```

### Save/load ordering hazard `[V]`

`App.tsx` calls `useSharedDesign()` at line 42 and `useAutosave()` at line 50, in that order. `useSharedDesign` loads **asynchronously** (`decodeShareLink` is a promise, [useSharedDesign.ts:27](../../src/persistence/useSharedDesign.ts#L27)); `useAutosave`'s restore is **synchronous** in its effect ([useAutosave.ts:27-53](../../src/persistence/useAutosave.ts#L27-L53)) and gated on `enabled: !readOnly` — but `readOnly` is only `true` **after** the async decode resolves. `[U]` Whether the autosave restore can therefore land before the shared design does — briefly showing the viewer's own draft, or racing it — was not verified by running the app. The comment at [useSharedDesign.ts:14-16](../../src/persistence/useSharedDesign.ts#L14-L16) asserts the share link *"wins over whatever draft is in localStorage"*, which the code does not obviously guarantee.

---

## 6. Export

```
ProjectsMenu → Export popover → six actions          ProjectsMenu.tsx:443-570

 Floor plan (PDF)        downloadPlanPdf(documentInput())   documents.ts:83
   date = now
   statement = buildAreaStatement({projectName, date, floors, plot,
                                   northOffset, plotFacing,
                                   constructionRate})       statement.ts:165
   doc = createPdf(title)
   sheets = floors.filter(hasDrawing)  (or floors[0] when none)
   for each sheet:
     canvas 3000×2121
     renderPlanSheet(ctx, {...})                     planSheet.ts:131
     canvas.toBlob('image/jpeg', 0.92)
     addImagePage(doc, jpeg, {A4_LANDSCAPE, margin:0})
                → readJpeg() parses the SOFn frame header  pdf.ts:761
   addStatementPages(doc, statement)   → areaBlocks + vastuBlocks
   buildPdf(doc) → serialise() → objects, xref, trailer     pdf.ts:829
   triggerDownload(blob, name)

 Area statement (PDF)    same minus the sheets              documents.ts:110
 Area statement (CSV)    statementToCsv(statement)          statement.ts:430
                           BOM + CRLF + RFC-4180 quoting
 Floor plan (PNG)        downloadPlanPng → renderPlanSheet 2000×1414 → toBlob
                                                            imageExport.ts:28
 3D view (PNG)           getSceneCanvas() → toBlob          imageExport.ts:55
                           needs preserveDrawingBuffer:true  SceneCanvas.tsx:129
                           disabled unless viewMode==='3d'   ProjectsMenu.tsx:539
 Project file (.json)    downloadDesign(serializeDesign())   files.ts:14

 SHARE                   ShareButton.share()                ShareButton.tsx:42
   guard walls.length===0
   createShareLink(serializeDesign({..., viewMode:'3d'}))
     JSON → gzip (CompressionStream) → base64url → `#design=g…`
     falls back to `r` (raw) when CompressionStream is unavailable
   navigator.clipboard.writeText(url)   (failure is tolerated; url is shown)
```

**Every export reads `allFloors(getState())` imperatively**, never a selector — [ProjectsMenu.tsx:117,227,251](../../src/components/ProjectsMenu.tsx#L117), [ShareButton.tsx:50](../../src/components/ShareButton.tsx#L50) — for the documented reason that `allFloors` allocates a fresh array and would spin zustand's snapshot equality check `[V]`.

---

## 7. Undo / redo

```
ANY store write
  └─▶ useDesignStore.subscribe(state => …)          useDesignStore.ts:1282
        snap = snapshotOf(state)     10 fields, by REFERENCE     (:667-680)

        if (state.viewEpoch !== historyEpoch)                    (:1286-1297)
              → whole-design replacement: adopt snap as baseline,
                setState({past:[],future:[]}), return
        if (historyApplying) → baseline = snap, record nothing   (:1300-1303)
        if (!designChanged(historyCommitted, snap)) return       (:1307)
              ← pure reference compare, no deep compare
        if (!historyBurst)                                       (:1312-1321)
              past = [...trim(past, 100), historyCommitted]
              future = []
        historyCommitted = snap
        historyBurst = setTimeout(…, 200 ms)     ← coalesces a drag

UNDO  ⌘Z / Ctrl+Z  useUndoShortcut.ts:20  (skipped while typing, or readOnly)
      or Toolbar ↶  Toolbar.tsx:251
  └ undo()                                        useDesignStore.ts:750-765
      historyApplying = true
      set({ ...previous, past: past.slice(0,-1), future: [...future, current] })
      historyApplying = false ; historyCommitted = previous ; clear burst

WHAT IS IN THE SNAPSHOT (:653-665)
  walls · roomLabels · furniture · stairs · floors · activeFloor
  plot · plotFacing · northOffset · floorMaterial

WHAT IS NOT
  blueprint (incl. metresPerPixel)   units   constructionRate
  projectName   selection   tool   viewMode   every panel flag
```

`[V]` `activeFloor` **is** in the snapshot, so an undo can silently switch the visible storey. This is intentional (a floor switch calls `fileActiveFloor`, which changes `floors`), but it means one ⌘Z after `setActiveFloor` moves the user between floors rather than reversing an edit.
