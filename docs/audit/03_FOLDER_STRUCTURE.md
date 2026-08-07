# 03 — Folder Structure

All LOC figures from `find … -exec wc -l` `[V]`.

```
space-design/
├── index.html                  App shell; loads /src/main.tsx. No content.            [V]
├── vite.config.ts        35    Build config AND backend mount point. Reads the        [V]
│                               API keys from env and hands them to aiPlugin().
├── tsconfig.json               Project references → app + node                        [V]
├── tsconfig.app.json           include: ["src"], DOM lib, bundler resolution          [V]
├── tsconfig.node.json          include: ["vite.config.ts","server/**/*.ts"], nodenext [V]
├── .oxlintrc.json              Two rules enabled                                      [V]
├── .env / .env.example         OPENROUTER_API_KEY, OPENROUTER_API_KEY_2,              [V]
│                               ANTHROPIC_API_KEY (the last is unused — see 09)
│
├── server/                803  SERVER-ONLY. Never imported by src/ — verified.        [V]
│   ├── aiPlugin.ts        179  Vite middleware: /api/ai/{generate,edit,openings}.
│   ├── designAgent.ts     240  Plan generate/edit → OpenRouter → claude-sonnet-4.5.
│   └── openingDetector.ts 384  Blueprint vision read → OpenRouter → gemma-4 :free.
│
├── public/
│   ├── character.glb           1.18 MB skinned figure (Mixamo rig)                    [V]
│   ├── animations/*.fbx        Walking.fbx 822 KB, Idle.fbx 1.50 MB                   [V]
│   └── favicon.svg
│
├── samples/               275  Fixture blueprints (7 SVG, 3 PNG) + gen-blueprint.mjs  [V]
│                               + blueprint-expected.json. NOT used by any test —
│                               no test suite exists.                                  [X]
│
└── src/                 21,490 (with server/)
    ├── main.tsx            10  createRoot(<StrictMode><App/></StrictMode>)            [V]
    ├── App.tsx            154  The only screen. Boolean-driven layout, no router.     [V]
    ├── index.css           23  Tailwind entry
    │
    ├── store/           1,328  ★ HOT SPOT #2
    │   └── useDesignStore.ts   THE application state. Types + ~50 actions +
    │                           the undo/redo recorder (a store.subscribe listener,
    │                           NOT a middleware).                                     [V]
    │
    ├── plan/            3,647  ★ HOT SPOT #1 — the 2D editor
    │   ├── draw.ts      1,658  Imperative canvas painter. Largest file in the repo.
    │   ├── planSheet.ts   874  A SECOND, separate painter for print sheets.
    │   ├── FloorPlanEditor.tsx 751  Canvas + all pointer handling.
    │   ├── rooms.ts       251  Planar-graph face traversal → enclosed rooms.
    │   └── viewport.ts    113  screen↔world, snap, zoom-to-cursor.
    │
    ├── scene/           3,488  23 files — the 3D workspace
    │   ├── SceneCanvas.tsx 215 <Canvas> setup, DnD raycast, walk overlays
    │   ├── Building.tsx     84 Stacks 3 storeys; ghosts the inactive ones
    │   ├── Walls.tsx       279 Wall → sliced boxes; click targets for openings
    │   ├── wallGeometry.ts 313 PURE. wallPieces, projectOntoWall, pickWall, bounds
    │   ├── collision.ts    301 PURE. Colliders, swept circle resolve, camera clamp
    │   ├── FurnitureModels.tsx 353  Box compositions, no asset files
    │   ├── CharacterAvatar.tsx 216  GLB + Mixamo FBX retarget
    │   ├── ThirdPersonControls.tsx 273  Orbit-follow walk, collision-resolved
    │   ├── WalkControls.tsx 156 First-person walk. NO collision — see 10.
    │   ├── RoomLabels/DimensionLabels  drei <Html> chips + per-frame declutter
    │   ├── Stairs / DoorLeaves / FloorSlab / Ground / Lighting / Controls / FrameBuilding
    │   ├── avatarState.ts   33  MODULE SINGLETON — the figure's live pose
    │   ├── avatarMotion.ts  47  PURE. wrapAngle, turnToward, followCameraPosition
    │   ├── walkMotion.ts    68  PURE. keys → velocity
    │   ├── canvasRegistry.ts 24 MODULE SINGLETON — the WebGL canvas, for PNG export
    │   └── config.ts       126  Every scene tuning value in one place
    │
    ├── components/      5,035  19 files — all React UI, all Tailwind
    │   ├── InspectorPanel.tsx  887  ★ Five inspectors in one file (wall/opening,
    │   │                            floor, furniture, room, stair)
    │   ├── Toolbar.tsx         665  Two-tier bar + FloorSelector + PanelsMenu
    │   ├── ProjectsMenu.tsx    655  Save/open/delete/new/import + 6 export actions
    │   ├── BlueprintPanel.tsx  612  ★ Owns the manual calibration UI — see Q1
    │   ├── RoomSchedulePanel.tsx 445  Room list + whole-building cost estimate
    │   ├── VastuPanel.tsx      339  Score, zone grid toggle, per-room verdicts
    │   ├── PlotPanel.tsx       247  Plot size, setbacks, buildable area, violations
    │   ├── CompassWidget.tsx   216  Draggable north rose + plot facing
    │   ├── FurniturePanel.tsx  183  Floor finish + catalogue + quick-fill fixtures
    │   ├── AIPanel.tsx         147  Brief → plan, instruction → edited plan
    │   ├── ShareButton / SharedBanner / PresentOverlay / StatusBar
    │   ├── NumberField / LengthField / MaterialPicker
    │   └── useDeleteShortcut / useUndoShortcut
    │
    ├── export/          1,963  Deliverable documents
    │   ├── pdf.ts          975  ★ A PDF writer from scratch. No library.
    │   ├── statement.ts    522  PURE. Areas + cost + Vastu, as data.
    │   └── documents.ts    466  Composes sheets + statement into a PDF/CSV.
    │
    ├── blueprint/       1,879  Raster import + detection + calibration
    │   ├── detectWalls.ts  851  ★ Hand-written CV: Otsu, ink masks, band grouping,
    │   │                        collinear merge, face fusion, junction snapping.
    │   ├── detectOpenings.ts 544  ★ Calls the vision API; WRITES THE SCALE. See Q1.
    │   ├── raster.ts       173  Decode + up/downscale to a bounded ImageData
    │   ├── useBlueprintStructure.ts 138  ★ The 2D→3D trigger. See Q1.
    │   ├── buildStructure.ts 74   Detect walls and add them to the floor
    │   ├── load.ts          49   File → store.blueprint at the DEFAULT scale
    │   └── calibration.ts   50   MODULE SINGLETON — picks + `calibratedSrc` flag
    │
    ├── persistence/     1,050
    │   ├── schema.ts       499  ★ DesignDocument + the untrusted-JSON validator
    │   ├── storage.ts      133  localStorage, every access try/catch-wrapped
    │   ├── useAutosave.ts  109  4 s interval; module-scope `restored` guard
    │   ├── shareLink.ts     94  gzip + base64url ↔ URL fragment
    │   ├── useSharedDesign.ts 86  Reads the fragment on load and on hashchange
    │   ├── imageExport.ts   83  Plan PNG + 3D viewport PNG
    │   └── files.ts         46  JSON download / file read
    │
    ├── vastu/             791  Placement analysis
    │   ├── analyse.ts      399  PURE. Sutherland-Hodgman clip, dominant zone, score
    │   ├── zones.ts        214  PURE. 3×3 grid in a north-up rotated frame
    │   └── ruleset.ts      178  DATA. The placement table, verbatim
    │
    ├── site/              315  ── plot.ts 195 (setbacks, buildable, violations)
    │                          └─ orientation.ts 120 (bearings, sectors, snapping)
    ├── rooms/             288  ── resolve.ts 208 (rooms ↔ labels, PIP, centroid)
    │                          └─ catalog.ts 80 (13 room types, tints, display name)
    ├── materials/         278  palette.ts — 9 finishes + procedural canvas textures
    ├── units/             254  length.ts — THE ONLY unit converter. Pure.
    ├── ai/                126  useDesignAI.ts — the two LLM flows, client side
    └── furniture/          81  catalog.ts — 7 pieces, footprints in metres
```

## Hot spots

**Churn cannot be used** — the repo has 2 commits and 1 contributor `[V]`. File size and fan-in are substituted, and this substitution is stated.

### By size (complexity proxy)

| Rank | File | LOC | Why it is a hot spot |
|---|---|---|---|
| 1 | [plan/draw.ts](../../src/plan/draw.ts) | 1,658 | Paints grid, blueprint, plot, setbacks, buildable hatch, violations, room fills, Vastu grid, stairs, furniture, walls, openings, wall dimensions, opening dimensions, room captions, draft line, cursor, calibration — **17 layers in one module** `[V]` [:294-333](../../src/plan/draw.ts#L294-L333). Also exports `pickStair`, a hit test, from a drawing module. |
| 2 | [store/useDesignStore.ts](../../src/store/useDesignStore.ts) | 1,328 | The only state. ~50 actions + all core types + the undo recorder. |
| 3 | [export/pdf.ts](../../src/export/pdf.ts) | 975 | Byte-level PDF serialiser: object table, xref, JPEG header parse, WinAnsi transliteration, text layout, table pagination. |
| 4 | [components/InspectorPanel.tsx](../../src/components/InspectorPanel.tsx) | 887 | Five distinct inspectors + `WallLengthField` + `flightSteps` + comfort rules. |
| 5 | [plan/planSheet.ts](../../src/plan/planSheet.ts) | 874 | A second full plan renderer, independent of `draw.ts`. |
| 6 | [blueprint/detectWalls.ts](../../src/blueprint/detectWalls.ts) | 851 | The whole CV pipeline. |

### By fan-in (how much breaks if it changes) `[V]` — `grep -rl`

Counts are `grep -rl <name> src | wc -l` and **include the defining file** `[V]`.

| Module | Files referencing | Consequence |
|---|---|---|
| `store/useDesignStore` | **59** (of 80 files under `src/`) | Every core type and every action. A change to `Wall` or `Point` reaches ~three-quarters of the codebase. |
| `scene/wallGeometry` | **16** | **The pure module with the widest reach.** `planBounds` alone anchors the Vastu zone grid, the plot fit, the 3D camera framing, the print sheet and the walk spawn point. |
| `units/length` | **11** | Sole unit authority. Also owns `GRID_STEP`, which is why the *drawing grid spacing* changes when the display unit changes. |
| `rooms/resolve` | **10** | Rooms are derived, never stored — every consumer re-derives them independently. |
| `persistence/schema` | **7** | The single validation gate for file import, localStorage, share links **and AI output**. |

### The two structural oddities in this tree

1. `[V]` **`plan/` contains two renderers that share no code.** `draw.ts` (editor) and `planSheet.ts` (print) both project world→screen, both draw walls, openings, furniture, room labels and dimensions, and both have their own colour and layout constants. `planSheet.ts:15-22` states the split is deliberate: *"That one serves the live editor … and none of it belongs on a drawing handed to a builder."* The reasoning is sound; the duplication is real. See [11_TECH_DEBT.md](11_TECH_DEBT.md).
2. `[V]` **`blueprint/` holds both deterministic CV and LLM calls, in adjacent files.** `detectWalls.ts` is pure pixel work; `detectOpenings.ts` (in the same folder, similar name) is an HTTP call to a vision model that also **writes the scale into the store**. Nothing in the folder name or file naming signals which is which.
