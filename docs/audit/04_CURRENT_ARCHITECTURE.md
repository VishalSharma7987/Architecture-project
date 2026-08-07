# 04 — Current Architecture

## Diagram `[V]` — real identifiers only

```
┌─ BROWSER ────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  main.tsx ─ createRoot ─ <StrictMode> ─ App()            src/App.tsx:30      │
│                                                                              │
│  ┌── App reads 10 store fields and branches on them. NO ROUTER. ──────────┐  │
│  │  viewMode · walkMode · presentMode · readOnly · 6 × *PanelOpen         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─ STARTUP HOOKS, in App's own order ───────────────────────────────────┐   │
│  │ 1 useSharedDesign()      hash → decodeShareLink → loadDesign(readOnly) │   │
│  │ 2 useBlueprintStructure() ← THE 2D→3D TRIGGER. Fires an LLM call and  │   │
│  │                             OVERWRITES blueprint.metresPerPixel (Q1)  │   │
│  │ 3 useDeleteShortcut / useUndoShortcut   window keydown listeners       │   │
│  │ 4 useAutosave({enabled:!readOnly})      restore once + 4 s interval    │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  VIEW A — 2D                          VIEW B — 3D                            │
│  FloorPlanEditor.tsx                  SceneCanvas.tsx                        │
│   ├ refs: viewport, cursor, anchor,    └ <Canvas> (r3f)                      │
│   │       drag, image, rooms, vastu       ├ Lighting  Ground                 │
│   ├ requestAnimationFrame → drawPlan      ├ Building ─┬ FloorSlab (×3)       │
│   │      (plan/draw.ts, 17 layers)        │           ├ Walls    (×3, ghosted)│
│   ├ store.subscribe(requestDraw)          │           └ open floor only:      │
│   └ pointer → addWall / addOpening /      │              FurnitureModels      │
│               addStair / addFurniture /   │              Stairs  DoorLeaves   │
│               updateOpening / select /    │              RoomLabels           │
│               setCalibrationPicks         │              DimensionLabels      │
│                                           ├ CharacterAvatar (3rd-person only) │
│                                           ├ exactly ONE of:                   │
│                                           │   Controls | WalkControls |       │
│                                           │   ThirdPersonControls             │
│                                           └ FrameBuilding (refit on viewEpoch)│
│                                                                              │
│  ┌── ONE STORE ─ zustand ─ src/store/useDesignStore.ts:714 ───────────────┐  │
│  │ CHECKED-OUT FLOOR : walls  furniture  roomLabels  stairs               │  │
│  │ STORAGE           : floors: FloorData[3]   activeFloor                 │  │
│  │ SITE              : plot  northOffset  plotFacing  units  rate         │  │
│  │ UNDERLAY          : blueprint            ← NOT saved, NOT undoable     │  │
│  │ VIEW              : viewMode walkMode walkView tool selection          │  │
│  │                     6 × *PanelOpen  vastuGrid showDimensions           │  │
│  │                     showCompass presentMode readOnly viewEpoch         │  │
│  │ HISTORY           : past[]  future[]  ← written by the subscriber      │  │
│  │                     at :1282, NOT by a middleware                      │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│         ▲                                            │                       │
│         │ loadDesign / newDesign                     │ allFloors(state)      │
│         │                                            ▼                       │
│   persistence/schema.ts   parseDesign()  ←──→  serializeDesign()             │
│         ▲                                            │                       │
│   ┌─────┴──────────┬──────────────┬──────────────────┴────────┐              │
│   localStorage   .json file    #fragment                  export/            │
│   storage.ts     files.ts      shareLink.ts               documents.ts       │
│   (2 keys)       download      gzip+b64url             ├ planSheet.ts →JPEG  │
│                                                        ├ statement.ts →data  │
│                                                        └ pdf.ts →bytes       │
│                                                                              │
│   ┌── 4 MODULE SINGLETONS, outside the store ────────────────────────────┐   │
│   │ blueprint/calibration.ts  picks[]  +  calibratedSrc   ← Q1 relevant   │   │
│   │ scene/avatarState.ts      x z heading speed moving    (60 Hz)         │   │
│   │ scene/canvasRegistry.ts   the live WebGL canvas                       │   │
│   │ persistence/useAutosave.ts  restored: boolean (one-shot)              │   │
│   └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                      │ fetch, same-origin only
                      ▼
┌─ VITE DEV SERVER (this is the entire backend) ───────────────────────────────┐
│  vite.config.ts:24  aiPlugin(ANTHROPIC_API_KEY, [OPENROUTER_KEY, ..._2])     │
│  server/aiPlugin.ts:121  configureServer → server.middlewares.use(...)       │
│    POST /api/ai/generate ─┐                                                  │
│    POST /api/ai/edit    ──┴→ designAgent.ts    → openrouter.ai               │
│                                                  anthropic/claude-sonnet-4.5 │
│    POST /api/ai/openings  ─→ openingDetector.ts → openrouter.ai              │
│                                                  google/gemma-4-26b:free     │
│  ✗ configureServer does NOT run for `vite build` or `vite preview`.          │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Module inventory `[V]`

| Layer | Modules | Purity | Notes |
|---|---|---|---|
| **Entry** | `main.tsx`, `App.tsx` | impure | No router; boolean layout |
| **State** | `store/useDesignStore.ts` | impure | Only store; owns all core types |
| **Pure geometry** | `scene/wallGeometry`, `scene/collision`, `scene/walkMotion`, `scene/avatarMotion`, `plan/rooms`, `plan/viewport`, `rooms/resolve`, `site/plot`, `site/orientation`, `vastu/zones`, `vastu/analyse`, `units/length` | **pure** | ~2,300 LOC of side-effect-free maths. No store import except for `type` |
| **Pure data** | `vastu/ruleset`, `rooms/catalog`, `furniture/catalog`, `scene/config` | **pure** | Constants only |
| **Pure transforms** | `export/statement`, `export/pdf` | **pure** | Design → statement object → PDF bytes |
| **Renderers** | `plan/draw`, `plan/planSheet`, `materials/palette` | canvas-side-effecting | Take a `ctx`, paint. `palette` caches textures in a module `Map` |
| **React views** | 19 `components/`, 15 `scene/*.tsx`, `plan/FloorPlanEditor` | impure | |
| **I/O** | `persistence/*`, `blueprint/load`, `blueprint/raster`, `export/documents` | impure | |
| **Network** | `ai/useDesignAI`, `blueprint/detectOpenings`, `blueprint/useBlueprintStructure` | impure | Client half of the AI features |
| **Server** | `server/*` | impure | Node only |

## Communication mechanisms `[V]`

| # | Mechanism | Where | Why |
|---|---|---|---|
| 1 | **Zustand selector subscription** | Every component | Normal reactive read |
| 2 | **`useDesignStore.getState()`** — imperative read/write | ~30 sites: [FloorPlanEditor.tsx:100-132](../../src/plan/FloorPlanEditor.tsx#L100-L132), [Walls.tsx:209](../../src/scene/Walls.tsx#L209), [detectOpenings.ts:79](../../src/blueprint/detectOpenings.ts#L79), [ProjectsMenu.tsx:117](../../src/components/ProjectsMenu.tsx#L117), … | Two documented reasons: (a) imperative canvas paint must not rebuild a callback on every store change; (b) `allFloors()` allocates a new array, so as a selector it would loop zustand's snapshot check — stated at [ProjectsMenu.tsx:114-116](../../src/components/ProjectsMenu.tsx#L114-L116) and [Building.tsx:38-41](../../src/scene/Building.tsx#L38-L41) |
| 3 | **`useDesignStore.subscribe(fn)`** | [FloorPlanEditor.tsx:250](../../src/plan/FloorPlanEditor.tsx#L250) → repaint; [useDesignStore.ts:1282](../../src/store/useDesignStore.ts#L1282) → the undo recorder | The recorder is not a middleware and writes back with `setState`, gated by a module-scope `historyApplying` flag |
| 4 | **`useSyncExternalStore`** | [BlueprintPanel.tsx:95](../../src/components/BlueprintPanel.tsx#L95) reading `calibration.ts` | The calibration picks are transient pointer state deliberately kept out of the design store |
| 5 | **Module singletons mutated at 60 Hz** | `avatarState` written by `ThirdPersonControls`/`WalkControls`, read by `CharacterAvatar` and `DoorLeaves` inside `useFrame` | Documented: *"putting it in zustand would re-render the whole 3D tree 60 times a second"* — [avatarState.ts:1-13](../../src/scene/avatarState.ts#L1-L13) |
| 6 | **React refs as frame state** | `FloorPlanEditor` holds 11 refs (viewport, cursor, anchor, drag, image, rooms, vastu, pan, size, frame, space) | Same reason — canvas output, no DOM to reconcile |
| 7 | **`window` event listeners** | 9 modules add global `keydown`/`keyup`/`pointerdown`/`blur`/`mousemove`/`hashchange`/`resize`/`scroll` | Shortcuts, dropdown dismissal, pointer-lock steering, share-link hashchange |
| 8 | **HTML5 drag-and-drop with a custom MIME** | `FURNITURE_DRAG_TYPE = "application/x-space-design-furniture"`, exported from [FurniturePanel.tsx:11](../../src/components/FurniturePanel.tsx#L11) and consumed by **both** viewports | A UI component is the source of truth for a scene-layer constant — see boundary violations |
| 9 | **`fetch` to same-origin `/api/ai/*`** | 2 client modules | The only network egress from the browser |

## Boundaries — and where they are violated

### Boundaries that HOLD `[V]`

| Boundary | Verification |
|---|---|
| **`server/` never reaches `src/`** | `[X]` grep for `server/` inside `src/` → 0 hits. Sole importer is [vite.config.ts:5](../../vite.config.ts#L5). |
| **API keys never reach the browser** | `[X]` grep `import.meta.env` across `src/` → **0 hits**. `process.env` is read in exactly one file, [vite.config.ts](../../vite.config.ts). Keys are passed as function arguments into `aiPlugin(...)`, never into `define`. |
| **The model is metric everywhere** | `units/length.ts` is display-only, and says so at [:3-13](../../src/units/length.ts#L3-L13). `[V]` No store action takes a non-metric value. |
| **All untrusted input goes through `parseDesign`** | File import ([files.ts:45](../../src/persistence/files.ts#L45)), localStorage ([storage.ts:61,111](../../src/persistence/storage.ts#L61)), share link ([shareLink.ts:81](../../src/persistence/shareLink.ts#L81)), **and AI output** ([useDesignAI.ts:62](../../src/ai/useDesignAI.ts#L62)) all call it. `[V]` |
| **Pure geometry does not import the store's runtime** | `wallGeometry`, `collision`, `rooms/resolve`, `plan/rooms`, `site/*`, `vastu/zones`, `vastu/analyse`, `units/length` import **only `type`** from the store. `[V]` |

### Boundaries that are VIOLATED `[V]`

| # | Violation | Evidence | What it means structurally |
|---|---|---|---|
| **B1** | **A blueprint-import module writes design state and calls the store's mutators directly.** `detectOpenings.ts` — nominally a detector — calls `updateBlueprint`, `addOpening`, `updateOpening`, `nameRoom`, `addFurniture`, `updateFurniture`. | [detectOpenings.ts:145](../../src/blueprint/detectOpenings.ts#L145), [:186](../../src/blueprint/detectOpenings.ts#L186), [:190](../../src/blueprint/detectOpenings.ts#L190), [:294](../../src/blueprint/detectOpenings.ts#L294), [:322](../../src/blueprint/detectOpenings.ts#L322), [:326](../../src/blueprint/detectOpenings.ts#L326) | A file whose docstring says *"Pure fetch + validation; it changes nothing"* ([:76-77](../../src/blueprint/detectOpenings.ts#L76-L77)) — true of `analyseBlueprint` only — sits beside five functions that mutate the design. This is the module that overwrites the calibration (Q1). |
| **B2** | **A hit test lives in a drawing module.** `pickStair` is exported from `plan/draw.ts` and imported by `FloorPlanEditor`. | [draw.ts:761-782](../../src/plan/draw.ts#L761-L782), imported at [FloorPlanEditor.tsx:21](../../src/plan/FloorPlanEditor.tsx#L21) | Every other hit test (`pickWall`, `pickOpening`, `pickFurniture`) is in `scene/wallGeometry`. The comment defends it: *"what you can click on is exactly the outline you can see"* ([:756-759](../../src/plan/draw.ts#L756-L759)). The reasoning is coherent; the placement is inconsistent with the other four. |
| **B3** | **A 3D-scene constant is owned by a UI panel.** `FURNITURE_DRAG_TYPE` is defined in `components/FurniturePanel.tsx` and imported by `scene/SceneCanvas.tsx` and `plan/FloorPlanEditor.tsx`. | [FurniturePanel.tsx:11](../../src/components/FurniturePanel.tsx#L11) ← [SceneCanvas.tsx:5](../../src/scene/SceneCanvas.tsx#L5), [FloorPlanEditor.tsx:9](../../src/plan/FloorPlanEditor.tsx#L9) | Both viewports now depend on a panel component's module. |
| **B4** | **`scene/config.ts` holds a `BLUEPRINT` block that the 3D scene never reads.** `BLUEPRINT.minMetresPerPixel`, `maxMetresPerPixel`, `calibrationHint` are consumed only by `components/BlueprintPanel.tsx`. | [config.ts:121-126](../../src/scene/config.ts#L121-L126) ← [BlueprintPanel.tsx:18,151-156,422](../../src/components/BlueprintPanel.tsx#L151-L156) | The clamp that bounds the *calibration scale* lives in the *3D scene tuning* file. |
| **B5** | **`plan/draw.ts` imports `SELECTION` from `scene/config.ts`.** | [draw.ts:15](../../src/plan/draw.ts#L15) | The 2D renderer depends on 3D scene config for one colour. Justified in a comment (*"so the two modes feel like one app"*, [:40](../../src/plan/draw.ts#L40)) but it is a 2D→3D dependency. |
| **B6** | **`vastu/zones.ts` imports `planBounds` from `scene/wallGeometry`.** | [zones.ts:4](../../src/vastu/zones.ts#L4) | A pure analysis module depends on a module named for the 3D scene. `wallGeometry` is in fact viewport-agnostic; the *name and location* are the problem, not the dependency. |
| **B7** | **`components/FurniturePanel.tsx` imports two fixture-placement functions from `blueprint/detectOpenings.ts`.** | [FurniturePanel.tsx:3-6](../../src/components/FurniturePanel.tsx#L3-L6) → `placeKitchenCounters`, `placeToiletFixtures` | Two purely-deterministic furniture actions live inside the AI-detection module, so a UI panel with no AI involvement imports from it. Their own docstring notes they exist *because* the vision read never returns fixtures ([detectOpenings.ts:331-343](../../src/blueprint/detectOpenings.ts#L331-L343)). |
| **B8** | **`SharedBanner` writes the store with raw `setState`, bypassing every action.** | [SharedBanner.tsx:22](../../src/components/SharedBanner.tsx#L22) — `useDesignStore.setState({ readOnly: false, projectName: null })` | The only direct `setState` from a component. It works, but it is outside the action surface every other mutation goes through. |

## Layering, as actually enforced

There is **no enforcement mechanism** `[X]` — no `eslint-plugin-boundaries`, no import-restriction lint rule (`.oxlintrc.json` enables two React rules and nothing else), no path-alias scheme, no per-folder `index.ts` barrels. The boundaries that hold, hold **by author discipline and by comment**, not by tooling. The one boundary that genuinely could not be violated by accident — `server/` vs `src/` — is enforced structurally, by living outside `tsconfig.app.json`'s `include` `[V]` [tsconfig.app.json](../../tsconfig.app.json).
