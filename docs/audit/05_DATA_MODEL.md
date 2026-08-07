# 05 — Data Model

Every type below is **copied verbatim** from source, comments included, with its file:line. Nothing here is paraphrased.

## The core types — `src/store/useDesignStore.ts` `[V]`

```ts
// src/store/useDesignStore.ts:16
/**
 * A point on the floor plane, in metres.
 *
 * Named `x`/`z` (not `x`/`y`) to match three.js world axes: the floor is the
 * XZ plane and `y` is height. The 2D editor draws `z` as its vertical screen
 * axis, so a plan drawn top-down lines up with the 3D scene with no conversion.
 */
export type Point = { x: number; z: number }

// src/store/useDesignStore.ts:18
export type OpeningType = 'door' | 'window'

// src/store/useDesignStore.ts:20-31
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

// src/store/useDesignStore.ts:33-43
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

// src/store/useDesignStore.ts:51-64
export type RoomType =
  | 'living'
  | 'bedroom'
  | 'master-bedroom'
  | 'kitchen'
  | 'dining'
  | 'pooja'
  | 'toilet'
  | 'bathroom'
  | 'study'
  | 'store'
  | 'balcony'
  | 'guest-room'
  | 'staircase'

// src/store/useDesignStore.ts:76-86
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

// src/store/useDesignStore.ts:99-112
export type Plot = {
  /** Extent along world x, in metres. */
  width: number
  /** Extent along world z, in metres. */
  depth: number
  /** World position of the plot's minimum-x, minimum-z corner. */
  origin: Point
  setbacks: {
    front: number
    rear: number
    left: number
    right: number
  }
}

// src/store/useDesignStore.ts:128-138
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

// src/store/useDesignStore.ts:147-162
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

// src/store/useDesignStore.ts:172-184   ← THE SCALE CARRIER
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

// src/store/useDesignStore.ts:222-224
export type Unit = 'ftin' | 'm'
export const DEFAULT_UNIT: Unit = 'ftin'

// src/store/useDesignStore.ts:235-237
export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
export const DEFAULT_FACING: Facing = 'N'

// src/store/useDesignStore.ts:249-256   ← "A FLOOR PLAN"
export type FloorData = {
  id: string
  name: string
  walls: Wall[]
  furniture: FurnitureItem[]
  roomLabels: RoomLabel[]
  stairs: Stair[]
}

// src/store/useDesignStore.ts:275-296
export type ViewMode = '2d' | '3d'
export type WalkView = 'first' | 'third'
export type Tool = 'select' | 'wall' | 'door' | 'window' | 'stair'

export type Selection =
  | { kind: 'wall'; wallId: string }
  | { kind: 'room'; anchor: Point }        // ← by POINT, not id
  | { kind: 'stair'; stairId: string }
  | { kind: 'opening'; wallId: string; openingId: string }
  | { kind: 'furniture'; furnitureId: string }
  | { kind: 'floor' }
  | null
```

### Supporting types from other modules `[V]`

```ts
// src/materials/palette.ts:3-14
export type MaterialId =
  | 'white-paint' | 'warm-plaster' | 'sage' | 'brick' | 'concrete'
  | 'oak' | 'walnut' | 'polished-concrete' | 'tile'
export type Surface = 'wall' | 'floor'

// src/furniture/catalog.ts:1-8
export type FurnitureType =
  | 'table' | 'chair' | 'sofa' | 'desk' | 'bed' | 'kitchen-counter' | 'toilet'

// src/vastu/ruleset.ts:15
export type VastuZone = Facing | 'C'
```

### Derived (computed, never stored) `[V]`

```ts
// src/plan/rooms.ts:16-21
export type Room = {
  /** Closed ring of floor-plane points, in order. */
  polygon: Point[]
  /** Square metres. */
  area: number
}

// src/rooms/resolve.ts:5-22
export type ResolvedRoom = {
  polygon: Point[]
  area: number
  /** Where a label should sit — a point guaranteed INSIDE the polygon. */
  centroid: Point
  /** The user's name for this space, or null if it has not been named. */
  label: RoomLabel | null
  extraLabels: RoomLabel[]
}
```

### Constants that are effectively part of the model `[V]`

```ts
// src/store/useDesignStore.ts:186-213
export const BLUEPRINT_DEFAULTS = { metresPerPixel: 0.01, opacity: 0.5 } as const
export const WALL_DEFAULTS      = { height: 3, thickness: 0.2 } as const
export const OPENING_DEFAULTS: Record<OpeningType, Pick<Opening,'width'|'height'|'sill'>> = {
  door:   { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
}
export const LIMITS = {
  wallLength:    { min: 0.05, max: 500 },
  wallHeight:    { min: 0.2,  max: 20 },
  wallThickness: { min: 0.02, max: 2 },
  openingWidth:  { min: 0.1,  max: 20 },
  openingHeight: { min: 0.1,  max: 20 },
  furnitureSize: { min: 0.2,  max: 10 },
}

// src/store/useDesignStore.ts:114-119
export const PLOT_DEFAULTS = {
  width: 30 * 0.3048, depth: 40 * 0.3048, setback: 5 * 0.3048,
} as const

// src/store/useDesignStore.ts:140-145
export const STAIR_DEFAULTS = { width: 1.0, run: 3.6, riserHeight: 0.17 } as const

// src/store/useDesignStore.ts:258-264
export const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor']
export const FLOOR_HEIGHT = WALL_DEFAULTS.height + 0.15      // 3.15 m
export const floorElevation = (index: number) => index * FLOOR_HEIGHT
```

---

## Object diagram `[V]`

```
DesignDocument (the file)                      DesignState (the store)
├─ version: 1                                  ├─ floors: FloorData[3] ────────┐
├─ name, savedAt                               ├─ activeFloor: 0|1|2           │
├─ settings                                    │                               │
│   ├─ viewMode  floorMaterial  units          │  ⚠ floors[activeFloor] IS     │
│   ├─ constructionRate                        │    DELIBERATELY STALE:        │
│   └─ northOffset  plotFacing                 │                               │
├─ walls[]     ─┐ ground floor,                ├─ walls[]        ─┐ these ARE  │
├─ furniture[] ─┤ duplicated for               ├─ furniture[]    ─┤ the active │
├─ rooms[]     ─┘ backward compat              ├─ roomLabels[]   ─┤ floor      │
├─ plot | null                                 ├─ stairs[]       ─┘            │
└─ floors: FloorData[]                         │   reconciled ONLY by          │
    └─ { id name walls furniture               │   fileActiveFloor() / allFloors()
         roomLabels stairs }                   ├─ plot northOffset plotFacing  │
    ⚠ NO top-level `stairs` field              ├─ units constructionRate       │
                                               ├─ blueprint ⚠ NOT SAVED        │
FloorData                                      ├─ view flags (14 booleans)     │
 ├─ walls: Wall[]                              └─ past[] future[] ⚠ view state │
 │   └─ openings: Opening[]  (owned, nested)                                   │
 ├─ furniture: FurnitureItem[]                                                 │
 ├─ roomLabels: RoomLabel[]  ── anchor:Point ──┐                               │
 └─ stairs: Stair[]                            │                               │
                                               │ resolved by CONTAINMENT       │
                DERIVED, EVERY RENDER:         │ every time, never stored      │
                detectRooms(walls) → Room[] ───┤                               │
                resolveRooms(walls, labels) → ResolvedRoom[]                   │
                       └─ label ← the FIRST RoomLabel whose anchor is inside   │
                       └─ extraLabels ← the rest                               │
```

### Relationships and their cardinality `[V]`

| Relation | Kind | Note |
|---|---|---|
| `Wall` → `Opening[]` | **composition, nested** | Openings live inside their wall. Deleting the wall deletes them. `position` is measured along **that wall's own** start→end axis. |
| `RoomLabel` → room | **spatial, by containment — no foreign key** | `resolveRooms` tests `containsPoint(polygon, label.anchor)`. [resolve.ts:52-57](../../src/rooms/resolve.ts#L52-L57). Move a wall past the anchor and the name silently detaches. Documented at [useDesignStore.ts:66-75](../../src/store/useDesignStore.ts#L66-L75). |
| Two labels in one enclosure | **first wins** | Earliest in `roomLabels` becomes `label`; the rest become `extraLabels` (the "open plan" case). [resolve.ts:55-56](../../src/rooms/resolve.ts#L55-L56) |
| `Selection{kind:'room'}` → room | **by `anchor: Point`, not id** | Rooms have no identity. [useDesignStore.ts:291](../../src/store/useDesignStore.ts#L291) |
| `Stair` → floor above | **implicit** | `FLOOR_HEIGHT` decides the riser count; nothing links the two storeys. `copyToNextFloor` deliberately does **not** copy stairs ([:867-870](../../src/store/useDesignStore.ts#L867-L870)). |
| `Blueprint` → design | **none** | Not in `DesignDocument`, not in `DesignSnapshot`. |
| `Plot` → floors | **site-level** | One plot for the whole building. |

---

## Q8 — The persistence contract

### What gets saved, in what format, where `[V]`

```ts
// src/persistence/schema.ts:38-64  — VERBATIM
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

| Destination | Key / format | Written by | `[V]` |
|---|---|---|---|
| localStorage | `space-design.projects.v1` — `Record<name, DesignDocument>` as JSON | `saveProject` | [storage.ts:3,80-84](../../src/persistence/storage.ts#L80-L84) |
| localStorage | `space-design.autosave.v1` — `{name: string\|null, doc: DesignDocument}` | `writeAutosave` | [storage.ts:4,123-125](../../src/persistence/storage.ts#L123-L125) |
| Disk | `<slug>.json`, pretty-printed, 2-space | `downloadDesign` | [files.ts:14-27](../../src/persistence/files.ts#L14-L27) |
| URL fragment | `#design=` + `g`/`r` tag + base64url(gzip(JSON)) | `createShareLink` | [shareLink.ts:13,48-56](../../src/persistence/shareLink.ts#L48-L56) |

`[X]` **No server persistence. No IndexedDB.** grep for `indexedDB`, `openDatabase`, `fetch(.*POST.*save` → 0 hits.

### Schema version field `[V]`

`DESIGN_VERSION = 1` — [schema.ts:36](../../src/persistence/schema.ts#L36). Written on every save ([:87](../../src/persistence/schema.ts#L87)) and checked on every load ([:328-337](../../src/persistence/schema.ts#L328-L337)).

### Is there migration code? `[X]` — **No.**

`parseDesign` handles exactly two version cases:
```ts
// schema.ts:328-337
const version = num(value.version)
if (version === null) return { ok:false, error:'Missing "version" — not a Space Designer file.' }
if (version > DESIGN_VERSION) return { ok:false, error:`File version ${version} is newer than…` }
```
There is **no branch on `version < DESIGN_VERSION`** and no migration table. The file's own comment says one should exist: *"Bump when the on-disk shape changes incompatibly, **and add a migration in `parseDesign`**"* ([:33-35](../../src/persistence/schema.ts#L33-L35)). Since `DESIGN_VERSION` is still 1, nothing is yet broken — the mechanism is simply absent.

**Forward compatibility is achieved by optional-field defaulting instead** `[V]`: `furniture` ([:370](../../src/persistence/schema.ts#L370)), `rooms` ([:386](../../src/persistence/schema.ts#L386)), `floors` ([:402](../../src/persistence/schema.ts#L402)), `plot` ([:455](../../src/persistence/schema.ts#L455)) are each `undefined`-tolerant with a stated milestone in the comment.

### What happens when an old file is opened `[V]`

| Case | Behaviour | Line |
|---|---|---|
| `version` missing / non-numeric | **Rejected** with a message; open design untouched | [:329-331](../../src/persistence/schema.ts#L329) |
| `version > 1` | **Rejected** — refuses rather than half-reads | [:332-337](../../src/persistence/schema.ts#L332) |
| `walls` not an array | **Rejected** | [:339-341](../../src/persistence/schema.ts#L339) |
| A wall with a bad `start`/`end` | **Rejects the whole file** | [:350](../../src/persistence/schema.ts#L350) |
| A zero-length wall | **Dropped**, warning recorded | [:176-178, 351-354](../../src/persistence/schema.ts#L351) |
| A bad opening | **Dropped**, counted in a warning | [:186-191, 356-362](../../src/persistence/schema.ts#L356) |
| Unknown `material` | Falls back to `DEFAULT_WALL_MATERIAL` | [:205](../../src/persistence/schema.ts#L205) |
| Missing / duplicate id | Fresh `crypto.randomUUID()` | [:149-153](../../src/persistence/schema.ts#L149) |
| `1e999` in a coordinate | **Rejected** — `Number.isFinite` is the gate | [:114-115](../../src/persistence/schema.ts#L114) |
| Bad `plot` | Whole plot dropped, warning | [:253-260, 455-458](../../src/persistence/schema.ts#L455) |
| `northOffset` out of range | Wrapped into `[0,360)` | [:472](../../src/persistence/schema.ts#L472) |
| `constructionRate ≤ 0` | Coerced to `0` = "no estimate" | [:469-470](../../src/persistence/schema.ts#L469) |

### Contract defects found `[V]`

| # | Defect | Evidence |
|---|---|---|
| **D1** | **`Blueprint` is never persisted.** It is absent from `DesignDocument` ([:38-64](../../src/persistence/schema.ts#L38-L64)) and no `loadDesign` caller passes it. Saving, reloading or sharing a design loses the traced underlay, its calibrated `metresPerPixel`, and its `origin`. `src` is a per-session object URL, so it *could* not be persisted as-is — but nothing (filename, scale, origin) is preserved either. | schema + all 4 `loadDesign` call sites |
| **D2** | **`Blueprint` is not in the undo snapshot.** `DesignSnapshot` omits it ([:653-665](../../src/store/useDesignStore.ts#L653-L665)), so **calibration cannot be undone** and a scale overwritten by the AI (Q1) cannot be recovered with ⌘Z. |
| **D3** | **Top-level `stairs` are dropped on serialise.** `serializeDesign` accepts a `stairs?` input ([:76](../../src/persistence/schema.ts#L76)) and **never writes it** ([:86-103](../../src/persistence/schema.ts#L86-L103)). `DesignDocument` has no top-level `stairs`. Stairs survive only inside `floors[].stairs`. Every caller passes `floors`, so in practice they round-trip via `floors[0].stairs` — but the parameter is a no-op and the asymmetry is invisible. |
| **D4** | **A file with more than 3 floors loses everything above index 2, silently.** `loadDesign` hard-codes `[0,1,2].map(...)` ([:1099-1114](../../src/store/useDesignStore.ts#L1099-L1114)). No warning is produced. |
| **D5** | **`parseDesign` returns `version: DESIGN_VERSION`, not the file's version** ([:481](../../src/persistence/schema.ts#L481)). The original version is unrecoverable after parse, so a future migration cannot inspect it downstream. |
| **D6** | **`floors[].walls` failures are silently swallowed.** Ground-floor `parseWall` failures reject the file ([:350](../../src/persistence/schema.ts#L350)); the identical failure inside `floors[i].walls` is dropped with **no warning** ([:410-414](../../src/persistence/schema.ts#L410-L414) — `if (parsed.ok === true) floorWalls.push(...)`). Two different contracts for the same data. |
| **D7** | **`viewMode` narrows lossily.** `settings.viewMode === '3d' ? '3d' : '2d'` ([:461](../../src/persistence/schema.ts#L461)) — a corrupt value becomes `2d` with no warning. |
| **D8** | **Autosave's dirty check watches only `walls`.** `if (walls === savedWallsRef.current) return` ([useAutosave.ts:73](../../src/persistence/useAutosave.ts#L73)). Furniture, room names, stairs, plot, setbacks, north, rate and floor-material changes **do not mark the design dirty**. See [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md). |
| **D9** | **`saveProject` is keyed on `doc.name`.** Saving under an existing name overwrites it with no confirmation ([storage.ts:80-84](../../src/persistence/storage.ts#L80-L84)); autosave does the same every 4 s when a project is open ([useAutosave.ts:99-102](../../src/persistence/useAutosave.ts#L99-L102)). |

---

## How model changes propagate `[V]`

```
store.setState (any action)
   │
   ├─▶ zustand notifies every selector subscriber
   │      ├─ React components re-render if their slice changed by reference
   │      ├─ FloorPlanEditor.tsx:250  subscribe → requestDraw() → rAF → drawPlan
   │      └─ useDesignStore.ts:1282   the undo recorder (see below)
   │
   ├─▶ derived data is recomputed IN THE CONSUMER, never cached centrally:
   │      resolveRooms(walls, roomLabels)   in 5 separate useMemos
   │      detectRooms(walls)                inside resolveRooms + StatusBar
   │      vastuZones(walls, northOffset)    in FloorPlanEditor
   │      analyseVastu(...)                 in VastuPanel and in statement.ts
   │      wallColliders(walls)              in ThirdPersonControls
   │      planBounds(walls)                 in ~8 places
   │
   └─▶ 3D meshes rebuild via useMemo keyed on the wall object identity
          Walls.tsx:119-120  wallPieces(wall) / openingBoxes(wall)
```

**Immutability is the propagation contract.** Every action replaces arrays and objects rather than mutating: `walls.map`, `[...state.walls, wall]`, `{...wall, ...}` `[V]` throughout [useDesignStore.ts:1150-1266](../../src/store/useDesignStore.ts#L1150-L1266). The undo recorder relies on this — `designChanged` is **pure reference comparison** ([:682-695](../../src/store/useDesignStore.ts#L682-L695)) with no deep compare. `[V]` No direct mutation of shared state was found in any store action; see Q7 in [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md) for the mutation map and the two exceptions outside the store.
