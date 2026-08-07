# CONTEXT_PACK — Space Designer

Self-contained handoff for an architect with **no access to this repo**.
Audit date **2026-08-07**. Commit **`8e1d02de35cd692c3eaed89018d7b167dfc7d0f7`** (`main`), **plus 31 staged-but-uncommitted files (`+27,338 / −550`)**. Everything below describes the **working tree**, not HEAD.

Tags: `[V]` verified by reading the cited code · `[I]` inferred, basis stated · `[U]` unverified, confirmation stated · `[X]` searched and absent.

**The app was never run** (audit constraint). Every behavioural claim is read from source. There are **zero tests**, so nothing is verified by execution.

---

## 1. Repo fingerprint

| | |
|---|---|
| Commit | `8e1d02de35cd692c3eaed89018d7b167dfc7d0f7` |
| Commits in history | **2** (`8e1d02d "Run AI generate/edit through OpenRouter"`, `5475bae "character added"`) |
| Contributors | **1** (`VishalSharma7987`) |
| Source LOC (`.ts`/`.tsx` in `src/` + `server/`) | **21,490** |
| Source files | **83** (46 `.ts`, 36 `.tsx`, 1 `.mjs`) |
| CSS | 23 lines |
| Prod deps / dev deps | **7 / 10** |
| Test files | **0** |
| `data-testid` attributes | **121** (100 distinct) — for a suite that does not exist |
| TODO / FIXME / HACK / XXX | **0** |
| CI / deploy config | **none** |
| Audit coverage | 77 files read in full, 3 in part, 3 not read ≈ **93% of LOC** |

### Stack (from `package.json`) `[V]`

```
runtime   react 19.2.7 · react-dom 19.2.7 · zustand 5.0.14 · three 0.185.1
          @react-three/fiber 9.6.1 · @react-three/drei 10.7.7
          @anthropic-ai/sdk 0.112.4   ← used ONLY for 4 instanceof checks;
                                         no Anthropic client is ever constructed
dev       vite 8.1.1 · typescript ~6.0.2 · tailwindcss 4.3.3 · oxlint 1.71.0
          @vitejs/plugin-react 6.0.3 · @types/{node,react,react-dom,three}
UNDECLARED  three-stdlib  — imported by 2 files, in NEITHER dependency list;
                            resolves only as a hoisted transitive of drei  [V]
```

`[X]` No router · no DB driver · no auth library · no PDF library · no CV library · no DXF/DWG library · no OCR · no geometry/CSG library · no validation library · no test runner. All of that is **hand-written** — ~4,900 LOC of it.

`[X]` **No GPL/AGPL/commercial licence anywhere.** The only unresolved licence exposure is the 3D character assets (see §12).

### Top 15 files by size (complexity proxy — churn is meaningless at 2 commits) `[V]`

| LOC | File | What it is |
|---|---|---|
| 1658 | `src/plan/draw.ts` | 2D editor canvas painter — **17 layers** in one module, plus `pickStair` |
| 1328 | `src/store/useDesignStore.ts` | The only store: all core types + ~50 actions + the undo recorder |
| 975 | `src/export/pdf.ts` | A PDF writer from scratch — objects, xref, JPEG header parse, WinAnsi |
| 887 | `src/components/InspectorPanel.tsx` | Five inspectors in one file |
| 874 | `src/plan/planSheet.ts` | A **second** complete plan renderer, for print |
| 851 | `src/blueprint/detectWalls.ts` | Hand-written CV: Otsu, 4 ink masks, band grouping, face fusion |
| 751 | `src/plan/FloorPlanEditor.tsx` | Canvas + all pointer handling; 11 refs |
| 665 | `src/components/Toolbar.tsx` | Two tiers + FloorSelector + portalled PanelsMenu |
| 655 | `src/components/ProjectsMenu.tsx` | Save/open/delete/new/import + 6 exports |
| 612 | `src/components/BlueprintPanel.tsx` | **Owns manual calibration** |
| 544 | `src/blueprint/detectOpenings.ts` | Vision fetch + **`applyPlanScale` (writes the scale)** + placement |
| 522 | `src/export/statement.ts` | Areas + cost + Vastu, as pure data |
| 499 | `src/persistence/schema.ts` | `DesignDocument` + the untrusted-JSON validator |
| 466 | `src/export/documents.ts` | Composes sheets + statement into PDF/CSV |
| 445 | `src/components/RoomSchedulePanel.tsx` | Room list + whole-building cost |

Ten files over 500 LOC = **8,949 LOC, 41% of the codebase.**

### Fan-in (`grep -rl <name> src | wc -l`, includes the defining file) `[V]`

`useDesignStore` **59** of 80 files · `scene/wallGeometry` **16** · `units/length` **11** · `rooms/resolve` **10** · `persistence/schema` **7**

---

## 2. Annotated folder tree (3 levels)

```
space-design/
├── vite.config.ts       35   Build config AND the backend mount point (reads API keys)
├── tsconfig.app.json         include:["src"] — "strict" NOT set, no extends
├── tsconfig.node.json        include:["vite.config.ts","server/**/*.ts"]
├── .oxlintrc.json            Two lint rules enabled, total
├── .env / .env.example       OPENROUTER_API_KEY, _2, ANTHROPIC_API_KEY (last is unused)
│
├── server/             803   SERVER-ONLY. Never imported by src/ — verified [X]
│   ├── aiPlugin.ts     179   Vite middleware: /api/ai/{generate,edit,openings}
│   ├── designAgent.ts  240   Generate/edit → OpenRouter → anthropic/claude-sonnet-4.5
│   └── openingDetector.ts 384 Vision read → OpenRouter → google/gemma-4-26b:free
│
├── public/                   character.glb 1.18MB · animations/{Walking,Idle}.fbx
├── samples/            275   10 fixture blueprints + generator + a golden JSON.
│                             ALL DEAD — nothing reads them [X]
│
└── src/              21,490 (incl. server)
    ├── App.tsx        154   The ONLY screen. Boolean-driven layout. No router. [X]
    ├── store/       1,328   useDesignStore.ts — types, ~50 actions, undo recorder
    ├── plan/        3,647   2D editor  ★ HOT SPOT
    │   ├── draw.ts / planSheet.ts        TWO independent renderers (duplication)
    │   ├── FloorPlanEditor.tsx           canvas + pointers
    │   ├── rooms.ts                      planar-graph face traversal → rooms
    │   └── viewport.ts                   screen↔world, snap, zoom-to-cursor
    ├── scene/       3,488   23 files, 3D. wallGeometry + collision + walkMotion
    │                        + avatarMotion are PURE. avatarState/canvasRegistry
    │                        are module singletons.
    ├── components/  5,035   19 React panels, all Tailwind
    ├── export/      1,963   pdf.ts (hand-rolled) · statement.ts (pure) · documents.ts
    ├── blueprint/   1,879   raster → detectWalls (CV, deterministic)
    │                              → detectOpenings (AI, AND writes the scale)
    │                              → calibration.ts (module singleton)
    │                              → useBlueprintStructure.ts (the 2D→3D trigger)
    ├── persistence/ 1,050   schema (validator) · storage (localStorage) · shareLink
    │                        · useAutosave · useSharedDesign · files · imageExport
    ├── vastu/         791   ruleset (data) · zones (3×3 north-up grid) · analyse
    ├── site/          315   plot.ts (setbacks, buildable) · orientation.ts (bearings)
    ├── rooms/         288   resolve.ts (rooms↔labels, PIP) · catalog.ts (13 types)
    ├── materials/     278   palette.ts — 9 finishes, procedural canvas textures
    ├── units/         254   length.ts — THE only unit converter. Pure.
    ├── ai/            126   useDesignAI.ts — the two LLM flows, client side
    └── furniture/      81   catalog.ts — 7 pieces
```

---

## 3. The core data model — VERBATIM

All from `src/store/useDesignStore.ts` unless noted. Copied exactly, comments included.

```ts
// :16
/**
 * A point on the floor plane, in metres.
 *
 * Named `x`/`z` (not `x`/`y`) to match three.js world axes: the floor is the
 * XZ plane and `y` is height. The 2D editor draws `z` as its vertical screen
 * axis, so a plan drawn top-down lines up with the 3D scene with no conversion.
 */
export type Point = { x: number; z: number }

// :18
export type OpeningType = 'door' | 'window'

// :20-31
export type Opening = {
  id: string
  type: OpeningType
  /** Distance in metres from the wall's start to the opening's centre. */
  position: number
  /** Metres. */
  width: number
  /** Metres. */
  height: number
  /** Height of the opening's bottom edge above the floor. Doors are 0. */
  sill: number
}

// :33-43
export type Wall = {
  id: string
  start: Point
  end: Point
  /** Metres. */
  height: number
  /** Metres. */
  thickness: number
  openings: Opening[]
  material: MaterialId
}

// :51-64
export type RoomType =
  | 'living' | 'bedroom' | 'master-bedroom' | 'kitchen' | 'dining'
  | 'pooja' | 'toilet' | 'bathroom' | 'study' | 'store'
  | 'balcony' | 'guest-room' | 'staircase'

// :66-86
/**
 * A name the user has given to an enclosed space.
 *
 * Rooms themselves are derived from the walls every time they change, so a name
 * cannot be stored "on" a room. It is pinned to `anchor` — a point inside the
 * space when it was named — and re-matched afterwards by testing which detected
 * loop contains that point. Move a wall and the name follows its room; move a
 * wall straight past the anchor and the name detaches, which is the honest
 * outcome since the space the user named no longer exists there.
 */
export type RoomLabel = {
  id: string
  type: RoomType
  anchor: Point
  /**
   * A name the user typed to override the type's default label — "Kids' Room",
   * "Home Office". Blank or absent falls back to the type's name, so the type
   * still drives the zone colour while the caption can read as anything.
   */
  name?: string
}

// :99-112
export type Plot = {
  /** Extent along world x, in metres. */
  width: number
  /** Extent along world z, in metres. */
  depth: number
  /** World position of the plot's minimum-x, minimum-z corner. */
  origin: Point
  setbacks: { front: number; rear: number; left: number; right: number }
}

// :128-138
export type Stair = {
  id: string
  /** Centre of the flight's footprint. */
  position: Point
  /** Rotation about the vertical axis, in radians. Zero ascends toward -z. */
  rotation: number
  /** Metres across the flight. */
  width: number
  /** Metres along the flight, in plan. */
  run: number
}

// :147-162
export type FurnitureItem = {
  id: string
  type: FurnitureType
  /** Centre of the piece on the floor plane. */
  position: Point
  /** Rotation about the vertical axis, in radians. */
  rotation: number
  /**
   * Footprint overrides, in metres. Absent means "use the catalogue's default
   * size for this type", so an untouched piece needs nothing stored; set them to
   * stretch or shrink one piece — a longer sofa, a wider kitchen counter —
   * without affecting the others.
   */
  width?: number
  depth?: number
}

// :164-184   ★ THE SCALE CARRIER — the ONLY screen↔world factor in the model
/**
 * A blueprint image traced under the plan.
 *
 * The image is positioned by two numbers rather than a transform matrix:
 * `origin` is where its top-left pixel sits in world metres, and
 * `metresPerPixel` is its scale. Calibration writes both, so a photographed
 * or scanned drawing at any resolution lands at true size.
 */
export type Blueprint = {
  /** Object URL for the decoded image. Revoked when the blueprint is replaced. */
  src: string
  fileName: string
  /** Natural pixel dimensions of the source image. */
  width: number
  height: number
  metresPerPixel: number
  /** World position of the image's top-left corner, in metres. */
  origin: Point
  opacity: number
  visible: boolean
}

// :244-256   ★ "A FLOOR PLAN"
/**
 * One storey's worth of design. The plot, the north rotation and the unit
 * setting are properties of the site, not of a storey, so they stay top-level
 * and every floor shares them.
 */
export type FloorData = {
  id: string
  name: string
  walls: Wall[]
  furniture: FurnitureItem[]
  roomLabels: RoomLabel[]
  stairs: Stair[]
}

// :222-237
export type Unit = 'ftin' | 'm'
export const DEFAULT_UNIT: Unit = 'ftin'
export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
export const DEFAULT_FACING: Facing = 'N'

// :275-296
export type ViewMode = '2d' | '3d'
export type WalkView = 'first' | 'third'
export type Tool = 'select' | 'wall' | 'door' | 'window' | 'stair'

export type Selection =
  | { kind: 'wall'; wallId: string }
  | { kind: 'room'; anchor: Point }        // ← by POINT; rooms have no identity
  | { kind: 'stair'; stairId: string }
  | { kind: 'opening'; wallId: string; openingId: string }
  | { kind: 'furniture'; furnitureId: string }
  | { kind: 'floor' }
  | null

// :186-213  constants that are effectively part of the model
export const BLUEPRINT_DEFAULTS = { metresPerPixel: 0.01, opacity: 0.5 } as const
export const WALL_DEFAULTS      = { height: 3, thickness: 0.2 } as const
export const OPENING_DEFAULTS: Record<OpeningType, Pick<Opening,'width'|'height'|'sill'>> = {
  door:   { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
}
export const LIMITS = {
  wallLength:{min:0.05,max:500}, wallHeight:{min:0.2,max:20},
  wallThickness:{min:0.02,max:2}, openingWidth:{min:0.1,max:20},
  openingHeight:{min:0.1,max:20}, furnitureSize:{min:0.2,max:10},
}
// :258-264
export const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor']
export const FLOOR_HEIGHT = WALL_DEFAULTS.height + 0.15   // 3.15 m
export const floorElevation = (index: number) => index * FLOOR_HEIGHT
```

### The persisted document — `src/persistence/schema.ts:38-64`, VERBATIM

```ts
export type DesignDocument = {
  version: number
  name: string
  /** ISO 8601. */
  savedAt: string
  settings: {
    viewMode: ViewMode
    floorMaterial: MaterialId
    units: Unit
    /** Rupees per square foot, or 0 when no rate has been set. */
    constructionRate: number
    /** Degrees clockwise from plan-up. */
    northOffset: number
    plotFacing: Facing
  }
  walls: Wall[]
  furniture: FurnitureItem[]
  rooms: RoomLabel[]
  /** The site boundary, or null when the design is not on a defined plot. */
  plot: Plot | null
  /**
   * Every storey. The top-level `walls` / `furniture` / `rooms` remain the
   * ground floor so that a file written now still opens in a build that
   * predates multiple floors, and one written then still opens here.
   */
  floors: FloorData[]
}
```

`DESIGN_VERSION = 1`. **No migration code exists** `[X]` — `parseDesign` only rejects `version > 1`; forward-compat is by optional-field defaulting.

### Derived, never stored `[V]`

```ts
// src/plan/rooms.ts:16-21
export type Room = { polygon: Point[]; area: number }

// src/rooms/resolve.ts:5-22
export type ResolvedRoom = {
  polygon: Point[]; area: number
  /** Where a label should sit — a point guaranteed INSIDE the polygon. */
  centroid: Point
  label: RoomLabel | null
  extraLabels: RoomLabel[]     // open-plan zones sharing one enclosure
}
```

### The three model facts that shape everything

1. **`Blueprint.metresPerPixel` is the only screen↔world conversion factor.** Everything else in the model is already metres. `[V]`
2. **Rooms are derived from the wall graph every render**, never stored. Names attach by **point containment**, not by id. `[V]`
3. **`floors[activeFloor]` is deliberately stale.** The top-level `walls`/`furniture`/`roomLabels`/`stairs` ARE the open floor; the two are reconciled in exactly three places (`fileActiveFloor`, `allFloors`, `setActiveFloor`). Reading `state.floors` directly gets the last-switched-away-from version. `[V]` [useDesignStore.ts:311-321](../../src/store/useDesignStore.ts#L311-L321)

---

## 4. Subsystem status table

| # | Subsystem | Status | Owning files | LOC | AI-dep | Tested |
|---|---|---|---|---|---|---|
| 1 | 2D editor / canvas | COMPLETE | `plan/FloorPlanEditor.tsx`, `plan/draw.ts`, `plan/viewport.ts` | 2,522 | n | **n** |
| 2 | Geometry model | PARTIAL — no columns | `store/useDesignStore.ts`, `scene/wallGeometry.ts`, `plan/rooms.ts`, `rooms/resolve.ts` | 2,100 | n | **n** |
| 3 | Snapping & constraints | PARTIAL — grid only | `plan/viewport.ts`, `units/length.ts`, store `constrainOpening` | ~150 | n | **n** |
| 4 | Selection / transform | PARTIAL — single-select | `components/InspectorPanel.tsx`, `Toolbar.tsx`, `scene/Walls.tsx` | 1,800 | n | **n** |
| 5 | Undo / redo | COMPLETE for its scope | `store/useDesignStore.ts:1269-1328`, `useUndoShortcut.ts` | ~140 | n | **n** |
| 6 | Layers & visibility | **STUB** — 7 booleans, no layer system | store flags | ~30 | n | **n** |
| 7 | Measurement / dimensions | PARTIAL — auto only | `plan/draw.ts:1405-1544`, `scene/DimensionLabels.tsx`, `units/length.ts` | ~560 | n | **n** |
| 8 | **Scale / calibration** | **BROKEN** | `blueprint/calibration.ts`, `BlueprintPanel.tsx`, `detectOpenings.ts:126-159` | ~250 | **y** | **n** |
| 9 | 3D generation & rendering | COMPLETE | `scene/` ×23 | 3,488 | n | **n** |
| 10 | Import: image | COMPLETE | `blueprint/load.ts`, `raster.ts`, `BlueprintPanel.tsx` | 834 | n | **n** |
| 11 | Import: PDF | **ABSENT** | — | 0 | — | — |
| 12 | Import: DWG | **ABSENT** | — | 0 | — | — |
| 13 | Import: DXF | **ABSENT** | — | 0 | — | — |
| 14 | Computer vision | COMPLETE for axis-aligned | `blueprint/detectWalls.ts`, `raster.ts` | 1,024 | **n** | **n** |
| 15 | OCR | **ABSENT** as code — delegated to the vision LLM | — | 0 | y | — |
| 16 | AI / LLM | PARTIAL — dev-only, one path destructive | `server/*` ×3, `ai/useDesignAI.ts`, `blueprint/detectOpenings.ts`, `useBlueprintStructure.ts` | 1,611 | **y** | **n** |
| 17 | Vastu analysis | COMPLETE | `vastu/` ×3, `VastuPanel.tsx` | 1,130 | n | **n** |
| 18 | BOQ / cost | PARTIAL — area×rate only | `export/statement.ts`, `RoomSchedulePanel.tsx` | ~200 | n | **n** |
| 19 | Export | COMPLETE | `export/` ×3, `plan/planSheet.ts`, `persistence/imageExport.ts` | 2,920 | n | **n** |
| 20 | Persistence / serialisation | PARTIAL — 9 defects | `persistence/` ×7 | 1,050 | n | **n** |
| 21 | Project management | PARTIAL | `ProjectsMenu.tsx`, `storage.ts` | 788 | n | **n** |
| 22 | Auth & accounts | **ABSENT** | — | 0 | — | — |
| 23 | Backend API | **BROKEN for prod**, complete for `vite dev` | `server/aiPlugin.ts` | 179 | y | **n** |
| 24 | Database schema | **ABSENT** — 2 localStorage keys | — | 0 | — | — |
| 25 | Collaboration / sharing | PARTIAL — one-way read-only link | `shareLink.ts`, `ShareButton.tsx`, `useSharedDesign.ts`, `SharedBanner.tsx` | 418 | n | **n** |
| 26 | **Testing infrastructure** | **ABSENT** | — | **0** | — | — |

---

## 5. Q11 — The honest completion matrix

Traced from user click to persisted result. Anything not traceable end to end was downgraded.

| # | Feature | Status | Evidence / limitation |
|---|---|---|---|
| 1 | Draw a wall chain in 2D | COMPLETE | click→`addWall`→store→repaint→autosave→`serializeDesign`→`parseDesign` on reload |
| 2 | Place door / window (2D or 3D) | COMPLETE | `addOpening`→`constrainOpening`→nested in `Wall`→persisted |
| 3 | Edit wall height/thickness/material | COMPLETE | `updateWall`→`normalizeWall`→persisted |
| 4 | Set exact wall length (typed, unit-aware) | COMPLETE | `parseLength`→`setWallLength`, pivots on `start` |
| 5 | Delete wall/opening/furniture/stair | COMPLETE | Delete key + button; selection cleared |
| 6 | Undo / redo | PARTIAL | 10 fields. **Excludes calibration**; **cleared by every AI result and every load** |
| 7 | 2D→3D extrusion | COMPLETE | `wallPieces` slicing, correct rotation sign, real-size textures |
| 8 | Multi-storey | PARTIAL | Exactly 3, hard-coded. A 4-floor file **loses floor 4 silently** |
| 9 | Orbit / pan / zoom 3D | COMPLETE | `OrbitControls` + `FrameBuilding` refit |
| 10 | First-person walk | PARTIAL | **No collision.** `WalkControls` never calls `moveWithCollisions` |
| 11 | Third-person walk + character | COMPLETE | GLB + Mixamo retarget, swept collision, camera pull-in, error boundary |
| 12 | Door leaves swing open | COMPLETE | Proximity-triggered, side latched on first move |
| 13 | Furniture drag → 2D | COMPLETE | Custom MIME → `worldAt` → `addFurniture` |
| 14 | Furniture drag → 3D | COMPLETE | NDC → `Raycaster` → floor plane at the active storey's elevation |
| 15 | Furniture move/rotate/resize | COMPLETE | Drag in plan; X/Z/rotate-90°/w/d in the inspector |
| 16 | Name a room, see its area | COMPLETE | Containment-resolved `RoomLabel`, persisted |
| 17 | Room schedule + floor size | COMPLETE | Live-derived; open-plan extra labels handled |
| 18 | Plot + setbacks + buildable area | COMPLETE | Facing- and north-aware edge mapping; violations drawn red |
| 19 | Compass / north rotation | COMPLETE | Draggable rose, 8-pt snap, Shift for free angle, persisted |
| 20 | Vastu report | COMPLETE | Area-weighted dominant zone, coverage hedging, `no-rule` status, PDF page |
| 21 | Vastu zone grid overlay | COMPLETE | Rotated frame, dedup'd shared edges |
| 22 | Cost estimate | PARTIAL | `area × rate` only. Correctly refuses to print ₹0 |
| 23 | Area statement (PDF/CSV) | COMPLETE | One `AreaStatement` object feeds panel, PDF and CSV |
| 24 | Floor-plan PDF | PARTIAL | **Non-Latin text renders as `?`** — in an India-targeted product |
| 25 | Plan PNG export | COMPLETE | Open storey, 2000×1414 |
| 26 | 3D view PNG export | COMPLETE | `preserveDrawingBuffer`; disabled unless in 3D |
| 27 | Project save/open/delete/new | PARTIAL | No rename, no overwrite confirm, no delete confirm |
| 28 | Import `.json` | COMPLETE | `parseDesign` gate, warning count surfaced |
| 29 | Autosave + restore | PARTIAL | **Dirty check watches `walls` only** — non-wall work is never saved |
| 30 | Read-only share link | COMPLETE | gzip+base64url fragment, `readOnly` enforced at 10 sites |
| 31 | Present mode | COMPLETE | Forces 3D+walk, hides chrome, double-Esc |
| 32 | Blueprint image import | COMPLETE | Two entry points, one loader, four error messages |
| 33 | **Blueprint manual calibration** | **BROKEN** | Silently overwritten by `applyPlanScale`. Not persisted, not undoable |
| 34 | Blueprint wall detection (CV) | COMPLETE | 4 binarisations scored against each other; staged for review |
| 35 | Blueprint opening detection (AI) | PARTIAL | Free model, 2 attempts/key, truncation salvage, width band-check |
| 36 | Auto-build 3D from blueprint | PARTIAL | Works; is the mechanism that destroys the calibration |
| 37 | Place counters / toilets | COMPLETE | Deterministic; seats each fixture against the nearest wall |
| 38 | AI: generate plan | **BROKEN in prod**, PARTIAL in dev | Endpoints absent outside `vite dev`. Replaces the design; clears undo |
| 39 | AI: edit plan | **BROKEN in prod AND in dev** | **Destroys furniture, rooms, stairs, plot, north, rate and both upper floors**, no warning, no undo |
| 40 | Dimensions overlay (2D+3D) | COMPLETE | Auto per wall; 3D chips with per-frame declutter |
| 41 | Units ft-in ↔ m | COMPLETE | Display-only; accepts `12'6"`, `3.81m`, `381cm`, `6 3/4"` |
| 42 | Materials / finishes | COMPLETE | 9 procedural textures tiled against real dimensions |
| 43 | Stairs | PARTIAL | Full editing + comfort warnings, **but no opening is cut in the slab above** |
| 44 | Copy floor up | COMPLETE | Fresh ids, refuses non-empty target, stairs excluded |
| 45–49 | `SITE_RULES`, `BRAHMASTHAN_RULE`, `zoneOfPoint`, `sectorOfPoint`, `bearingBetween`, `northScreenAngle`, `rectCenter`, `buildPdfBytes`, `clearAutosave`, `clearWalls`, `samples/*`, the `Anthropic.*Error` branches, `serializeDesign`'s `stairs` param | **DEAD** | Exported/accepted, zero call sites |

**Tally: COMPLETE 27 · PARTIAL 13 · BROKEN 4 · DEAD 5 · ABSENT (subsystems) 6**

---

## 6. Q1 — The calibration write-path

### Every read/write of the scale `[V]` (`grep -rn "metresPerPixel" src`)

| # | file:line | R/W | Triggered by | Overwrites? |
|---|---|---|---|---|
| 1 | `store/useDesignStore.ts:179` | decl | the `Blueprint` type | — |
| 2 | `store/useDesignStore.ts:188` | decl | `BLUEPRINT_DEFAULTS = 0.01` | — |
| 3 | `store/useDesignStore.ts:992-1003` | **W** | `updateBlueprint(patch)` — the only mutator; no guard, no validation | **YES, unconditionally** |
| 4 | `blueprint/load.ts:21,30` | **W** | user picks an image | fresh `setBlueprint`; nothing to overwrite |
| 5 | `components/BlueprintPanel.tsx:151-171` | **W** | **"Set scale"** — the manual calibration. Clamped `[1e-5,1]`. Calls `markCalibrated(src)` | yes, deliberately |
| 6 | **`blueprint/detectOpenings.ts:144-153`** | **W ★** | `applyPlanScale` — reached ONLY from the 2D→3D auto-build. **No clamp. Never checks `isCalibrated`.** | **YES** |
| 7 | `blueprint/detectOpenings.ts:174` | R | `placeOpenings` normalized→world | — |
| 8 | `blueprint/detectOpenings.ts:272-273` | R | `toWorld` (rooms + furniture) | — |
| 9 | `blueprint/buildStructure.ts:58` | R | auto-build → `segmentsToWalls({mpp / raster.scale})` | — |
| 10 | `components/BlueprintPanel.tsx:204` | R | manual "Detect walls" → same division | — |
| 11 | `blueprint/detectWalls.ts:842-849` | R (param) | `segmentsToWalls` — **where the number becomes permanent geometry** | — |
| 12 | `plan/draw.ts:236,349-350` | R | painting the underlay | — |
| 13 | `plan/FloorPlanEditor.tsx:128` | R | passing into `drawPlan` | — |
| 14 | `plan/FloorPlanEditor.tsx:313-314` | R | `fitToBounds` after decode | — |
| 15 | `components/BlueprintPanel.tsx:74-77,397-398` | R | the `1 px = N cm` readout | — |
| 16 | `scene/config.ts:124-125` | decl | `BLUEPRINT.min/maxMetresPerPixel` — read by site 5 only | — |

**Two writers set the scale from a measurement. Only one records that it happened.** The record is `calibratedSrc`, a module-scope `string \| null` in `blueprint/calibration.ts:28`. Its complete usage:

```
calibration.ts:38     markCalibrated(src) → calibratedSrc = src    ← ONE writer
calibration.ts:42     isCalibrated(src)   → calibratedSrc === src  ← ONE reader
BlueprintPanel.tsx:105  const calibrated = isCalibrated(blueprint.src)   ← a LABEL
BlueprintPanel.tsx:173  markCalibrated(blueprint.src)
```

`isCalibrated` is imported by **one file**, where it drives only two warning labels and one button's wording. **No write path consults it.** `[X]` grep `isCalibrated` in `detectOpenings.ts` → 0 hits.

### The manual-calibration → 3D call chain

```
setViewMode('3d')                                      useDesignStore.ts:784
 └ App re-render
    └ useBlueprintStructure effect                     useBlueprintStructure.ts:56
       ├ if (viewMode!=='3d' || !src || !visible) return        :57  passes
       ├ if (handled.current === src) return                    :58  passes
       ├ if (getState().walls.length > 0) return                :60  ★ THE ONLY GUARD
       │      — passes ONLY when the floor is empty, which is
       │        EXACTLY the state right after calibrating
       ├ analyseBlueprint()                                     :73
       │    POST /api/ai/openings → gemma-4-26b-a4b-it:free
       ├ applyPlanScale(analysis)                               :79
       │    └ updateBlueprint({ metresPerPixel, origin })
       │         detectOpenings.ts:145  ★★ OVERWRITES THE MANUAL CALIBRATION
       ├ buildWallsFromBlueprint()                              :85
       │    └ segmentsToWalls({ mpp: <AI value> / raster.scale })
       │         buildStructure.ts:58  ★ bakes the AI scale into every wall
       ├ placeOpenings(...)                                     :98
       ├ placeRooms(...) / placeFurniture(...)                :101-102
       └ setPhase({kind:'built', scale:{kind:'calibrated'}})
            → App.tsx:113  "Sized to 40′ from the drawing."
```

The write itself, verbatim:

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

### Verdict

**YES — `applyPlanScale` overwrites a manual calibration, unconditionally, whenever the active floor has no walls.**

| | |
|---|---|
| **Fires when** | visible blueprint + **zero walls on the active floor** + switch to 3D + the model returns a usable `box` and ≥1 dimension |
| **Does NOT fire when** | any wall exists · the blueprint is hidden · the AI is unavailable (then `{kind:'guess'}` and **the manual scale survives**) · the same `src` was already handled this session |
| **Why the guard makes it worse** | The panel's own recommended order is *calibrate → then trace or detect*. The window in which the bug fires **is** the state a user is in immediately after calibrating. |
| **Recoverability** | **None.** `blueprint` is in neither `DesignSnapshot` (no ⌘Z) nor `DesignDocument` (no reload). The user must re-calibrate **and** delete every wall built at the wrong scale. |
| **Detectability** | **Low.** The banner says *"Sized to 40′ from the drawing"*, and `isCalibrated(src)` **still returns true** (`calibratedSrc` is never cleared), so the "Not calibrated yet" warning stays hidden. |

### Three secondary defects on the same path

| # | Defect |
|---|---|
| Q1-b | **Different clamps.** Manual: `clamp(1e-5, 1, …)`. AI: **none**. |
| Q1-c | **Different origin rules.** Manual pins `picks[0]`. AI re-centres on the world origin, sliding the underlay out from under anything already placed. |
| Q1-d | **`calibratedSrc` is never cleared** — not on `setBlueprint(null)`, `loadDesign`, or `newDesign`. It leaks for the life of the tab. |

---

## 7. Q2 — AI inventory

**Three endpoints, two outbound models, four user-facing entry points.** `[X]` No other network egress exists anywhere in the client.

| | Generate / Edit | Blueprint vision read |
|---|---|---|
| Client | `src/ai/useDesignAI.ts:34` | `src/blueprint/detectOpenings.ts:90` |
| Server | `server/designAgent.ts` | `server/openingDetector.ts` |
| Endpoint | `openrouter.ai/api/v1/chat/completions` | same |
| **Model** | `anthropic/claude-sonnet-4.5` (**paid**) | `google/gemma-4-26b-a4b-it:free` |
| max_tokens | 6000 | 1200 |
| Body cap | 1 MB | 8 MB |
| Triggers | AI panel "Generate" / "Apply edit" | (a) "Detect doors & windows" (b) **automatic on 2D→3D** |
| Retry | key failover only, **no same-key retry** | 2 rounds × N keys |
| Cache / rate limit / cost tracking | **none / none / none** | **none / none / none** |
| **Timeout** | **`[X]` NONE** — no `AbortController` anywhere | **`[X]` NONE** |

### Prompt 1 — generate/edit system prompt, VERBATIM (`server/designAgent.ts:69-104`)

```
You design architectural floor plans as structured data for a 3D space-planning app.

COORDINATE SYSTEM
- Units are metres on a horizontal plane. A point is {x, z}.
- +x runs right (east), +z runs down the page (south) in plan view. Height is a separate field, not a coordinate.
- Keep the building roughly centred on the origin. A 20m x 14m building should span about x -10..10 and z -7..7.
- Snap every coordinate to a 0.5 m grid. The editor snaps to 0.5 m, so off-grid points look wrong next to hand-drawn walls.

WALLS
- A wall is a straight segment from "start" to "end". There are no curves and no arcs.
- Rooms are enclosed by walls whose endpoints match EXACTLY. To close a rectangle, the 4th wall's end must equal the 1st wall's start, digit for digit. Near-misses leave visible gaps in 3D.
- Interior partitions must land exactly on the exterior wall they meet, so corners join cleanly.
- Do not stack two walls along the same line, and do not cross one wall through another mid-span. Split a wall into two segments at the junction instead.
- Defaults: height 3. Thickness 0.3 for exterior walls, 0.15 for interior partitions.

OPENINGS
- "position" is the distance in metres from that wall's OWN start point to the opening's centre — not a coordinate.
- An opening must fit entirely on its wall: position must be at least width/2, and at most (wall length - width/2). A 0.9 m door on a 4 m wall is valid anywhere from 0.45 to 3.55.
- Doors: sill 0, height 2.1, width 0.9 (1.6 for double doors on a main entrance).
- Windows: sill 0.9, height 1.4, width 1.2 to 2.4.
- Never put an opening within 0.4 m of either end of a wall — it would cut through the corner.

MAKING PLANS THAT WORK
- Every enclosed room needs a door. A room with four solid walls is unusable; check each one before finishing.
- The building needs at least one entrance door on an exterior wall.
- Put windows on exterior walls only. Interior partitions get doors, and glazing only if the brief asks.
- Rooms connect through a circulation space (corridor, lobby, or the open-plan floor) rather than only through each other.

SPACE STANDARDS (use these to size rooms, do not quote them back)
- Open-plan desk: 6-8 m² per person including circulation.
- Meeting room: 2 m² per seat, minimum 9 m². A 6-person room is about 3.5 x 4 m.
- Reception / waiting: 12-20 m².
- Corridors: 1.2 m wide minimum, 1.5 m for a main route.
- Bedroom: 9-14 m². Bathroom: 4-6 m². Kitchen: 8-12 m².

Set "name" to a short title for the design. Set "notes" to one or two sentences on the layout and how you sized it — this is shown to the user, so write it for a person, not as a data dump.
```
Appended at request time: `"\n\nReturn a JSON object matching this JSON Schema exactly:\n" + JSON.stringify(DESIGN_SCHEMA)`.

**User message, generate:** `Design a floor plan for this brief:\n\n${brief}`
**User message, edit:**
```
Here is the current floor plan:

${JSON.stringify(design, null, 2)}

Apply this change:

${instruction}

Return the COMPLETE updated plan, including every wall you are keeping unchanged. Preserve the existing geometry wherever the instruction does not require altering it — do not redraw the building from scratch.
```
`design` = `{name, walls[]}` with **all ids stripped** (they *"cost tokens, and invite the model to echo stale ones back"*).

### Prompt 2 — vision read, VERBATIM (`server/openingDetector.ts:44-57`)

```
This is an architectural floor plan image. Report it as compact JSON.

1. SCALE. Read the overall dimension labels on the drawing — the figures like "40'" along one side and "30'" along another that give the building's size. Report the building's real width and depth in feet as numbers "w" (horizontal, left-to-right) and "d" (vertical). If a dimension is not legible, use null for it — do not guess.

2. BUILDING BOX. Give the bounding box of the building's outer walls as "box": [x0, y0, x1, y1], each a number 0..1, where (0,0) is the top-left of the image. This is the rectangle "w" and "d" measure across.

3. OPENINGS. Find EVERY door and every window. Be thorough: include interior doors between rooms and closets, and a window on each exterior wall. A door is a gap in a wall, usually with a thin quarter-circle swing arc; a window is a gap marked with thin parallel lines. Report openings as "o": a list of [t, x, y, width] tuples, where t is "d" for a door or "w" for a window, x and y are the opening's CENTRE normalized 0..1, and width is a fraction of the image width (a single door is around 0.03 to 0.08).

4. ROOMS. For every labelled room, read its printed name. Report "r": a list of [name, x, y] tuples, where name is the room's label in lowercase (e.g. "kitchen", "master bedroom", "bedroom", "living", "dining", "bathroom", "toilet", "study", "store", "balcony", "pooja"), and x, y are the CENTRE of that room normalized 0..1 — the spot its label text sits.

5. FURNITURE. Find the furniture drawn inside the rooms — beds, sofas, dining and coffee tables, chairs, desks. Ignore plumbing fixtures and kitchen appliances. Report "f": a list of [kind, x, y] tuples, where kind is one of "bed", "sofa", "table", "chair", "desk", and x, y are the CENTRE of that piece normalized 0..1.

To save space use ONLY these short keys and tuple form. Return ONLY this JSON object and nothing else — no prose, no code fence:
{"w":40,"d":30,"box":[0.1,0.1,0.9,0.8],"o":[["d",0.5,0.3,0.05],["w",0.2,0.1,0.06]],"r":[["kitchen",0.7,0.3],["bedroom",0.25,0.3]],"f":[["bed",0.25,0.25],["sofa",0.6,0.7]]}
```

### Does model output reach geometry?

| Response field | Reaches | Guard |
|---|---|---|
| `walls[]` (generate/edit) | **The entire design** | `parseDesign` (`Number.isFinite`, `normalizeWall`, zero-length drop). **Nothing checks architectural sanity** |
| `w`, `d`, `box` | ★ **`blueprint.metresPerPixel` + `origin`** → every subsequent wall coordinate | finite & >0; degenerate box rejected; two estimates averaged. **NO CLAMP** |
| `o[].x,y` | Opening position → `pickWall(…, 2.2 m)` | misses **dropped and counted** |
| `o[].width` | Opening width | ★ **`sensibleWidth`** — trusted only inside `[0.6,1.4]` m (door) / `[0.5,3.0]` m (window), else the real default, then capped at 90% of the wall. **The one place model numbers are distrusted** |
| `r[]`, `f[]` | Room-label anchors, furniture positions | keyword-matched or skipped; furniture re-seated by `fitToRoom` |

### The best structural decision `[V]`

AI output is wrapped as a `DesignDocument` and pushed through **the same `parseDesign` validator as an untrusted file import** (`useDesignAI.ts:62-68`). A hallucinated `1e999` is rejected by `Number.isFinite` exactly like a corrupt `.json`. This is what keeps the AI blast radius contained.

### The two structural AI problems

**AI-1 — every AI feature is dead in any deployed build.** `configureServer` is a `vite dev` hook (`aiPlugin.ts:121`). `npm run build` emits the front end alone; `npm run preview` serves it without middleware. Acknowledged in-source.

**AI-2 — AI *edit* destroys everything except walls.**
```ts
// src/ai/useDesignAI.ts:86-89
useDesignStore.getState().loadDesign({ name: parsed.doc.name, walls: parsed.doc.walls })
```
`loadDesign` defaults everything it is not given: `furniture: []`, `roomLabels: []`, `stairs: []`, `floors` → ground-only + 2 empties, `plot: null`, `northOffset: 0`, `plotFacing: 'N'`, `constructionRate: 0`, `floorMaterial` reset, `viewEpoch + 1` → **`past`/`future` cleared**. The edit control carries **no warning** (the "this replaces N walls" warning is on *generate*). Autosave persists the loss within 4 seconds.

### Q4 — what breaks if every AI call fails

- **BREAKS:** AI generate, AI edit, "Detect doors & windows". All three show a message; **the design is untouched**.
- **DEGRADES:** 2D→3D with a blueprint → `{kind:'guess'}` → **`applyPlanScale` is never called, so the manual calibration SURVIVES** → CV still builds walls → banner reads *"walls-only"*. **The failure mode is strictly safer than the success mode.**
- **UNAFFECTED:** everything else — drawing, editing, undo, rooms, areas, **all of Vastu**, plot/setbacks, compass, units, materials, furniture, stairs, multi-storey, **CV wall detection**, manual calibration, all of 3D and both walk modes, Present, **every export**, save/load/autosave, share links.
- **No unhandled throw reaches the user.** Every AI path is try/catch-wrapped end to end.

---

## 8. Top 20 known issues, by blast radius

| # | Issue | File:line |
|---|---|---|
| 1 | **AI edit destroys furniture, rooms, stairs, plot, north, rate and both upper floors; undo cleared; no warning** | `src/ai/useDesignAI.ts:86-89` |
| 2 | **`applyPlanScale` overwrites a manual calibration, unrecoverably (Q1)** | `src/blueprint/detectOpenings.ts:145` |
| 3 | **Autosave's dirty check watches `walls` only** — a session of naming rooms, arranging furniture, setting the plot/north/rate is never saved | `src/persistence/useAutosave.ts:73` |
| 4 | **Every AI feature 404s in any deployed build** | `server/aiPlugin.ts:121` |
| 5 | **Blueprint + its calibration are never persisted and never undoable** | `src/persistence/schema.ts:38-64`, `src/store/useDesignStore.ts:653-665` |
| 6 | **Zero tests over ~4,900 LOC of hand-written algorithms** (PDF writer, CV, polygon algebra, the untrusted-input validator) | `[X]` |
| 7 | **O(n²) room detection re-run 6+ times per wall edit**, on the main thread | `src/plan/rooms.ts:86,155` + 6 call sites |
| 8 | **First-person walk has no collision; third-person does** | `src/scene/WalkControls.tsx:118-143` |
| 9 | **PDF cannot render any non-Latin script** — Indic names print as `?` | `src/export/pdf.ts:34-36` |
| 10 | **`readProjects` re-validates the entire project library on every save — every 4 s** | `src/persistence/storage.ts:47-68` |
| 11 | **A file with >3 floors loses everything above index 2, silently** | `src/store/useDesignStore.ts:1099-1114` |
| 12 | **Upper-floor walls skip `normalizeWall` on load; ground-floor walls do not** | `src/store/useDesignStore.ts:1093` vs `:1099-1103` |
| 13 | **`floors[].walls` parse failures are dropped silently; top-level ones reject the file** | `src/persistence/schema.ts:350` vs `:410-414` |
| 14 | **Autosave silently gives up forever on a storage-full error** | `src/persistence/useAutosave.ts:96-97` |
| 15 | **A corrupt `projects` localStorage key presents as "Nothing saved yet."** | `src/persistence/storage.ts:51-67` |
| 16 | **No timeout on any AI call** — a hung upstream leaves the UI loading indefinitely | `[X]` no `AbortController` |
| 17 | **Stairs rise into a solid slab** — no opening is ever cut | `[X]` nothing modifies `FloorSlab` for stairs |
| 18 | **Two tabs overwrite each other's autosave every 4 s** | `[X]` no `storage` listener |
| 19 | **Share-link length is unchecked** — a large design produces a link that fails silently in transport | `src/persistence/shareLink.ts:48-56` |
| 20 | **Project save/delete have no confirmation and no rename** | `src/components/ProjectsMenu.tsx:107,171` |

---

## 9. Q5 — Duplicated / competing logic

| # | Concept | Where |
|---|---|---|
| 1 | **Two full plan renderers** (2,532 LOC combined, no shared code, separate colour tables) | `plan/draw.ts` + `plan/planSheet.ts` |
| 2 | **`fileActiveFloor` and `allFloors` have byte-identical bodies** | `useDesignStore.ts:595-607` + `:616-635` |
| 3 | **`triggerDownload` ×3** — and the third revokes the URL *synchronously*, the exact bug the other two were written to avoid | `documents.ts:456`, `imageExport.ts:72`, `files.ts:14` |
| 4 | **`flightSteps` ×2 with a different key name for the same value** (`riser` vs `rise`), plus a third copy of the tread count | `InspectorPanel.tsx:657`, `Stairs.tsx:26`, `draw.ts:208` |
| 5 | **`rasterFromSrc` ×2, identical** | `buildStructure.ts:11`, `BlueprintPanel.tsx:56` |
| 6 | **`wallLength` ×3** | `useDesignStore.ts:541`, `detectOpenings.ts:513`, `wallGeometry.ts:9` |
| 7 | **`clamp` ×5** (one symmetric, one with a midpoint fallback, one inline) | store, `collision.ts`, `ThirdPersonControls.tsx`, `detectOpenings.ts`, `draw.ts` |
| 8 | **`clearWalls` vs `clearFloor`** — two reset scopes; `clearWalls` is **dead** | `useDesignStore.ts:1212,1214` |
| 9 | **`isTextEntry` ×3** — the third omits `SELECT`, so space-to-pan behaves differently inside a `<select>` | `useUndoShortcut.ts:5`, `useDeleteShortcut.ts:5`, `FloorPlanEditor.tsx:384` |
| 10 | **`PlanAnalysis`/`RawOpening`/`RawLabel`/`PlanBox` declared twice** across the `server`↔`src` boundary; nothing keeps them in sync | `openingDetector.ts:59-86` + `detectOpenings.ts:41-55` |
| 11 | **Two walk controllers with different physics** — one collides, one does not; ~80 duplicated lines each | `WalkControls.tsx` + `ThirdPersonControls.tsx` |
| 12 | **Two conflicting AI policies in the same folder** — *"deliberately does not use Claude/Anthropic"* vs `MODEL = 'anthropic/claude-sonnet-4.5'` | `openingDetector.ts:6-8` vs `designAgent.ts:13` |
| 13 | **`analyseVastu` called from two sites, then index-aligned to a separately-sorted name array** | `VastuPanel.tsx:71` + `statement.ts:318,321-330` |
| 14 | **Two definitions of "the centre of the plan"** — bounding-box centre vs mean of wall midpoints | `wallGeometry.planBounds` vs `FurniturePanel.centreOfPlan:28-39` |
| 15 | **`METRES_PER_FOOT` ×2** | `units/length.ts:16`, `detectOpenings.ts:23` |
| 16 | **Two "is it calibrated" signals that do not know about each other** — `calibratedSrc` and `ScaleSource.kind` | `calibration.ts:28` vs `detectOpenings.ts:65-67` — **directly implicated in Q1** |

---

## 10. Five data-flow diagrams

### A. New project
```
ProjectsMenu "New" → handleNew()                    ProjectsMenu.tsx:178
  └ newDesign()                                     useDesignStore.ts:1134
      set({ floors:[emptyFloor×3], activeFloor:0, walls:[], furniture:[],
            roomLabels:[], stairs:[], plot:null,
            floorMaterial:DEFAULT, projectName:null, selection:null,
            walkMode:false, viewEpoch: +1 })              ← the trigger
  viewEpoch fans out to 3 watchers:
    ├ store.subscribe(:1286) → clear past[]/future[]
    ├ FloorPlanEditor(:351)  → planBounds null → createViewport()
    └ FrameBuilding(:22)     → no bounds → returns (camera NOT reset)

  ⚠ NOT cleared: blueprint · units · constructionRate · northOffset ·
    plotFacing · readOnly · all *PanelOpen · viewMode
    (loadDesign DOES reset most of these — the two differ)
```

### B. Manual draw
```
left-click                          FloorPlanEditor.onPointerDown :438
 ├ btn 1|2 or Space → beginPan; return
 ├ blueprintCalibrating → pickCalibrationPoint; return
 └ tool==='wall':
     point = snapToGrid(screenToWorld(...), GRID_STEP[units].cell)
             ⚠ cell = 0.1524 m in 'ftin' (the DEFAULT), 0.5 m in 'm'
     if (anchor) addWall(anchor, point)               store:1150
                   samePoint → null   |  else [...walls, wall]
                   id=randomUUID, h=3, t=0.2, openings=[], material=default
     anchor = point

 every write fans out:
   store.subscribe(requestDraw) → rAF → drawPlan (17 layers)
   useMemo(resolveRooms) → roomsRef → requestDraw
   useMemo(vastuZones)   → vastuRef → requestDraw
   undo recorder: coalesce 200 ms, then push to past[]

 chain ends: Esc | double-click | tool change → endChain()
```

### C. Image import
```
BlueprintPanel "Choose an image"  |  ProjectsMenu "Import" + isImageFile
                    └───────────┬───────────┘
                    loadBlueprintFromFile(file)              load.ts:16
                      rasterFromFile → decodeImageFile → rasterise
                        scale = >2000 ? 2000/L : <1400 ? 1400/L : 1
                        (nearest-neighbour when enlarging; white background)
                      setBlueprint({ src(new objectURL), fileName,
                        width/height = SOURCE px,
                        metresPerPixel: 0.01,   ← ★ A GUESS
                        origin: centred on world origin,
                        opacity 0.5, visible true })
                    ↓
 CALIBRATE (optional, the ONLY deterministic scale path)
   pick 2 raw (UNSNAPPED) world points → type the real length in METRES
   mpp = clamp(1e-5, 1, mpp × typed/measured)
   updateBlueprint({mpp, origin pinned at picks[0]})
   markCalibrated(src)      ← a module-scope string. Not stored, not undoable.
                    ↓
 DETECT WALLS (deterministic CV)
   detectWallSegments(raster.image)              detectWalls.ts:716
     4 candidate ink masks → band pipeline each → keep the highest-scoring
     (Otsu/auto-invert · Chebyshev-from-paper · darker · lighter)
     findBands → mergeCollinear(gap ≤12×t) → keep() → mergeWallFaces
     → thickness floor 0.4×median → snapJunctions → requireJunction
   segmentsToWalls({ mpp / raster.scale, origin })   ← the ★ conversion
   panel: STAGED for review     |  auto-build: written straight to the store
                    ↓
 DETECT OPENINGS (AI)  — see §7
   toSendableJpeg(≤1100 px, q0.82) → POST /api/ai/openings
   placeOpenings (pickWall 2.2 m; sensibleWidth band-check)
   placeRooms (keyword match) · placeFurniture (fitToRoom)
   placeKitchenCounters / placeToiletFixtures (deterministic)
   ⚠ this manual path does NOT touch the scale
```

### D. 2D → 3D  ★ the Q1 path
```
setViewMode('3d')
 ├ App.tsx:92   <SceneCanvas/> replaces <FloorPlanEditor/>
 ├ useBlueprintStructure effect re-runs           ← see §6 for the full chain
 │    guards → analyseBlueprint (LLM) → applyPlanScale (★ OVERWRITES SCALE)
 │    → buildWallsFromBlueprint → placeOpenings/Rooms/Furniture
 └ SceneCanvas mounts
      Building.tsx:42  allFloors → per storey <group y=floorElevation(i)>
        FloorSlab(walls, ghost=!open) · Walls(walls, ghost=!open)
        open floor only: FurnitureModels · Stairs · RoomLabels ·
                         DimensionLabels · DoorLeaves
      Walls.tsx:119  wallPieces(wall)  → runs between openings
                                        + sill below + lintel above
                     rotationY = atan2(-dz, dx)   ← negated dz is load-bearing
                     y = SLAB.top (0.006)
      FrameBuilding  refits the orbit camera on viewEpoch
```

### E. Save / load
```
SAVE      floors = allFloors(getState())     ← imperative; as a selector it loops
          doc = serializeDesign({name, walls, furniture, roomLabels,
                                 stairs: floors[0].stairs,   ← NEVER written
                                 floors, plot, floorMaterial, viewMode,
                                 units, constructionRate, northOffset, plotFacing})
          saveProject(doc) → projects[doc.name] = doc → localStorage
                             ⚠ keyed on NAME. Overwrite, no confirm.

AUTOSAVE  every 4 s:  if (walls === savedWallsRef.current) return
                      ⚠ ONLY walls are watched — see issue #3
          writeAutosave({name, doc}); if (projectName) saveProject(doc)

LOAD      doc = loadProject(name)
            └ readProjects(): JSON.parse + parseDesign PER ENTRY, every call
          loadDesign({...})                          store:1076
            walls.map(normalizeWall)      ← ground floor only
            floors → EXACTLY 3 slots      ⚠ index >2 discarded silently
            selection:null · walkMode:false · viewEpoch+1

RESTORE   guarded by a MODULE-SCOPE `restored` flag (StrictMode-safe)
          readAutosave → parseDesign → loadDesign

SHARE     serializeDesign → JSON → gzip(CompressionStream) → base64url
          → `#design=g…`   (tag 'r' = raw fallback)
          load: hash → gunzip → parseDesign → loadDesign({readOnly:true})
          ⚠ App calls useSharedDesign (ASYNC) before useAutosave (SYNC);
            `readOnly` is only true after the decode resolves.  [U] race unverified
```

---

## 11. What works well and must not be rewritten

| # | Thing | Why |
|---|---|---|
| 1 | **`parseDesign` as the single gate for all untrusted input — including AI output** (`schema.ts:325-499`) | Four sources, one validator. `Number.isFinite` blocks `1e999`. The malformed-vs-odd distinction is consistently applied. **This is what keeps the AI blast radius contained.** |
| 2 | **The comment culture** — 930 lines, explaining *why* and naming the failure mode | With zero tests, these comments are the **only** encoding of the invariants. A violation will not fail a test; the reader has been told at the exact line what breaks. |
| 3 | **~2,300 LOC of pure, seamed algorithm** — `wallGeometry`, `collision`, `rooms/resolve`, `plan/rooms`, `vastu/*`, `site/*`, `units/length`, `walkMotion`, `avatarMotion`, `export/statement` | Imports only `type` from the store. `detectWalls` even defines `RasterLike` "so the detector runs outside a browser too". **The architecture is test-ready; adding a suite is a pure addition.** |
| 4 | **Room detection by planar-graph face traversal** (`plan/rooms.ts`) | Not a bounding-box approximation. Splits at T-junctions, prunes dangles to a fixed point, walks half-edges in angular order, discards the outer face by winding sign. Textbook-correct; handles L and U shapes. |
| 5 | **Label placement with a containment check** (`resolve.ts:140-194`) | The area centroid is computed **then tested**, because it falls outside an L. Falls back to the widest interior chord midpoint. |
| 6 | **Four-way binarisation scored by result** (`detectWalls.ts:725-745`) | Runs four ink readings and keeps whichever finds the most wall, rather than guessing the drawing's style. `mergeWallFaces` fixes doubled hollow walls from outlined drawings. |
| 7 | **`sensibleWidth`'s band check** (`detectOpenings.ts:496-511`) | A model number is accepted only inside a real-world plausibility band, else replaced with a physical default, then capped against geometry. **Exactly the pattern missing from `applyPlanScale` 12 lines earlier.** |
| 8 | **Honesty about uncertainty, surfaced in the UI** | `'no-rule'` ≠ `'okay'`; coverage <75% is hedged in the sentence; Vastu score is `null` not 0; cost is `null` not ₹0; `MEASUREMENT_BASIS` travels in the data so every renderer must print it; dropped openings are counted. |
| 9 | **The API-key boundary** | `[X]` zero `import.meta.env` in `src/`; `process.env` in one file; `server/` outside `tsconfig.app.json`'s include, so client code **cannot** import it and still typecheck. |
| 10 | **Read-only mode enforced at 10 independent sites** | Toolbar, panels, autosave, both shortcuts, and five separate 3D click handlers. |
| 11 | **Zero network dependency for rendering** | Procedural textures, in-scene environment map, `<Html>` captions instead of troika `<Text>`, hand-rolled PDF, native `CompressionStream`. Verified: the only egress is the two same-origin AI calls. |
| 12 | **Documented performance decisions** — `avatarState` as a singleton, `allFloors` via `getState`, imperative canvas + refs, memoised graph walks, one shared unit cube, canvas-bounded hatching, colliders rebuilt only on wall change, swept collision | Each names the symptom it prevents. Not premature. |
| 13 | **Rendering details tuned against a real frame** — tone mapping off, light intensities summing to ~π, one shadow caster, `normalBias 0.02`, half-pixel grid offsets, slab at `y=0.006` | Not derivable by inspection. |

### Do not touch without deep study

| # | Area | The trap |
|---|---|---|
| 1 | **The undo recorder** (`useDesignStore.ts:1269-1328`) | A subscriber that writes back into the store it observes, gated by 3 module flags + a `viewEpoch` watcher. `designChanged` is a **pure reference compare** — a `.map()` returning a new unchanged array records a phantom edit. |
| 2 | **The checked-out floor** (`:311-321`) | `floors[activeFloor]` is deliberately stale. Reading `state.floors` instead of `allFloors(state)` silently uses the last-switched-away-from storey. |
| 3 | **`atan2(-dz, dx)`** (`wallGeometry.ts:24`) | Wrong sign **mirrors the entire building**, invisible on any symmetric plan. |
| 4 | **`length.ts` format/parse asymmetry** | Round-tripping through a label walks the value up to half an inch **every edit**. |
| 5 | **`pdf.ts` byte offsets** | *"one wrong offset gives a file that some viewers open and others reject outright"* — with no test. |
| 6 | **`detectWalls.ts` stage order** | `mergeWallFaces` must run **before** `typicalThickness`, or the "typical wall" becomes the pen weight and every later filter is scaled to it. |
| 7 | **`vastu/zones.ts` frame order** | Rotate to north-up **first**, then take the bounding box. Reversed, the grid shears off the compass on every rotated plot. |
| 8 | **`resolve.ts` half-open PIP comparisons** | `<` → `<=` makes labels flicker between adjacent rooms on redraw. |
| 9 | **`collision.ts` degenerate branch** | Removing it yields `NaN` positions when the body centre is inside a box. |
| 10 | **`CharacterAvatar.retargetClip`** | Skipping the Hips bind pre-multiply tips the body flat; keeping the root track double-applies movement. |

---

## 12. Open questions and unverified areas

### Cannot be answered from the code

1. **Was `applyPlanScale`'s unconditional write intended to be conditional?** `isCalibrated` exists, is exported, and is consulted by no write path. Nothing in any comment or commit addresses the interaction.
2. **Is the AI-edit destruction of furniture/rooms/stairs/plot/floors known?** Generate warns; edit — which destroys strictly more — carries no warning.
3. **Did a test suite exist?** 121 `data-testid`s, a golden JSON with no consumer, a browser-free `RasterLike`, and three README sentences describing specific tests. Git history is 2 commits deep.
4. **Was the codebase authored with substantial AI assistance?** Signals: zero TODO/FIXME in 21,765 LOC; uniform comment register throughout; 2 commits containing everything; test-ids without tests; several dead "completeness" exports. It matters because the failure mode of that pattern is exactly Q1 and AI-2 — locally excellent modules with an unexamined interaction.
5. **What is the deployment target?** No CI, no Dockerfile, no `start` script, and a backend that only exists under `vite dev`.
6. **Why do the two server modules state opposite AI policies?**

### Answerable only by building or running — the audit did neither

7. **Is TypeScript `strict` actually on?** Not set in either tsconfig, no `extends`. `[U]` `npx tsc --showConfig`.
8. **Does `three-stdlib` resolve at build time?** Imported by 2 files, declared in neither dependency list. `[U]`
9. **Does the app currently build and run?** `typescript@~6.0.2` + `vite@^8.1.1` + a 31-file uncommitted change set. `[U]`
10. **Can the autosave restore race the share-link load?** `useSharedDesign` (async) runs before `useAutosave` (sync), and `readOnly` is only true after the decode resolves. `[U]`
11. **What happens under StrictMode double-invocation?** `useAutosave` uses a module-scope flag (safe). `useBlueprintStructure` uses a **ref** — risk of two vision calls and two wall builds. `[U]`
12. **What is the practical share-link ceiling?** Unbounded, unchecked, silent failure. `[U]`
13. **At what plan size does editing become unusable?** O(n²) × 6 per edit, no profiling harness. `[U]`
14. **How long does blueprint detection block the tab?** 4 binarisations over up to 4 MP, synchronously, no worker. `[U]`

### Product/policy questions the code raises but cannot answer

15. **Licence terms for `character.glb` and the two Mixamo FBX clips** — 3.5 MB in `public/`, no licence file. **The only unresolved licence exposure in the project.**
16. **Should ~4 MB of binary working files at the repo root be committed?** All staged, none imported by any source file. Permanent once committed.
17. **Is the three-floor limit a decision or a placeholder?** Hard-coded in four places; `emptyFloor(index)` already handles `index > 2`.
18. **Should stairs cut an opening in the slab above?** The two-storey relationship is acknowledged in code; the void is not.
19. **Is first-person walk's lack of collision intentional?** The README says yes, but that sentence predates `collision.ts` existing.
20. **Should the calibration input accept ft-in?** Hardcoded to metres in an app defaulting to `ftin`, with a parser that already handles `12'6"`.
21. **What is the intended answer for Indic text in PDFs?** Currently `?`.
22. **Is the free vision model a permanent choice?** Hardcoded id with its own "this will 404 eventually" warning and no fallback list.

### Do not assume anything about

| Area | Why |
|---|---|
| **Runtime behaviour of any kind** | The app was never run. Every behavioural claim is read from source. |
| **`plan/planSheet.ts` beyond line 180** | 694 LOC unread. The print sheet's actual rendering is undocumented here. |
| **`scene/FurnitureModels.tsx` beyond line 80** | 273 LOC of per-type box composition unread. |
| **`scene/RoomLabels.tsx` beyond line 70** | 179 LOC — the declutter loop and JSX — unread. |
| **`samples/gen-blueprint.mjs`** | 275 LOC unread; not shipped in the bundle. |
| **Git history as a signal** | 2 commits, 1 contributor. No churn signal, no bisect surface, no review trail. **Every "hot spot" here is size- or fan-in-based**, and that substitution is stated wherever it appears. |
| **The relationship to `HEAD`** | 31 files staged, `+27,338 / −550`. This describes the **working tree**. `HEAD` is materially different — `src/scene/Avatar.tsx` exists there and `CharacterAvatar.tsx` differs. |
