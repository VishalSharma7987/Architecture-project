# 13 — Gaps

A pure inventory of what professional CAD/BIM software has that this codebase has **no trace of**. Every row was searched; the search is stated. Nothing here is a recommendation — it is a list of absences.

`[X]` throughout means: searched, and not found.

---

## 1. Drawing and editing

| Capability | Search run | Result |
|---|---|---|
| Object snap (endpoint, midpoint, intersection, perpendicular, tangent, nearest) | `grep -rn "snapTo\|osnap\|endpoint\|midpoint\|perpendicular\|nearest" src` | `[X]` Only `snapToGrid` ([viewport.ts:85](../../src/plan/viewport.ts#L85)) and `snapNorth` ([orientation.ts:116](../../src/site/orientation.ts#L116)) |
| Alignment guides / smart inference | `grep -rn "guide\|inference\|align" src` | `[X]` Only CSS `items-align` classes |
| Angle / polar snap while drawing | `grep -rn "angleSnap\|polar\|ortho" src` | `[X]` |
| Type a dimension while drawing (`8'` then Enter) | Read [FloorPlanEditor.tsx:457-469](../../src/plan/FloorPlanEditor.tsx#L457-L469) | `[X]` The chain is click-only. Exact length is settable **after** the fact, in the inspector |
| Move a wall endpoint | `grep -rn "start:" src/store/useDesignStore.ts` | `[X]` No action writes `Wall.start`. `setWallLength` pivots on `start` and swings `end` along the **existing direction** only |
| Rotate an object other than furniture/stairs | Read `DesignState` | `[X]` `Wall` has no rotation; only `FurnitureItem.rotation` and `Stair.rotation` exist |
| Mirror / flip | `grep -rni "mirror\|flip" src` | `[X]` |
| Offset a wall / parallel copy | `grep -rni "offset" src` | `[X]` Only pixel offsets in the renderers |
| Trim / extend / fillet / chamfer | `grep -rni "trim\|fillet\|chamfer\|extend" src` | `[X]` |
| Array / repeat | `grep -rni "array.*tool\|repeat.*pattern" src` | `[X]` |
| Copy / paste / duplicate | `grep -rni "clipboard\|paste\|duplicate" src` | `[X]` Only `navigator.clipboard.writeText` for the share URL |
| Multi-select / marquee / lasso | Read the `Selection` type ([useDesignStore.ts:289-296](../../src/store/useDesignStore.ts#L289-L296)) | `[X]` A single object or `null` |
| Group / ungroup | `grep -rni "group.*select\|ungroup" src` | `[X]` |
| Lock / unlock an object | `grep -rni "\block\b\|frozen" src` | `[X]` |
| Curved / arced / freeform walls | Read [wallGeometry.ts](../../src/scene/wallGeometry.ts) and the `Wall` type | `[X]` A wall is two `Point`s. The AI prompt states it explicitly: *"There are no curves and no arcs"* ([designAgent.ts:78](../../server/designAgent.ts#L78)) |
| Non-rectangular plot boundary | Read the `Plot` type | `[X]` Rectangle only — and the reason is documented at [useDesignStore.ts:88-98](../../src/store/useDesignStore.ts#L88-L98) |

## 2. Layers, standards and presentation

| Capability | Search | Result |
|---|---|---|
| User-definable layers | `grep -rni "layer" src` | `[X]` Only CSS z-index and three.js internals |
| Per-layer colour / lineweight / linetype | — | `[X]` |
| Layer-based print sets | — | `[X]` |
| Line types (dashed, chain, hidden) as a *model* property | `grep -rn "setLineDash" src` | `[X]` Dashes are hardcoded per renderer feature ([draw.ts:496,504,1073,1085,1385,1593](../../src/plan/draw.ts#L496)) |
| Lineweight standards | — | `[X]` Stroke widths are per-feature constants |
| Named views / saved cameras | `grep -rni "savedView\|namedView\|bookmark" src` | `[X]` |
| Sheet layouts / viewports / multiple sheets per drawing | Read [planSheet.ts:131-162](../../src/plan/planSheet.ts#L131-L162) | `[X]` One fixed A4 layout, one plan per sheet |
| Drawing templates / title-block templates | — | `[X]` One hardcoded title block |
| Drawing standards enforcement | — | `[X]` |

## 3. Annotation and documentation

| Capability | Search | Result |
|---|---|---|
| User-placed dimensions | Read [draw.ts:1405-1477](../../src/plan/draw.ts#L1405-L1477) | `[X]` Auto-generated per wall only |
| Chained / running / baseline dimensions | — | `[X]` |
| Radial / diameter / angular dimensions | — | `[X]` |
| Free text / notes on the drawing | `grep -rni "annotation\|textTool\|note.*place" src` | `[X]` |
| Leaders and callouts | `grep -rni "leader\|callout" src` | `[X]` |
| Revision clouds / revision history / drawing issue register | `grep -rni "revision\|issue.*register" src` | `[X]` |
| Hatch / fill patterns as a user tool | `grep -rn "hatch" src` | `[X]` One hardcoded 45° hatch for the buildable zone ([draw.ts:526-557](../../src/plan/draw.ts#L526-L557)) |
| Symbol / block library | `grep -rni "\bblock\b.*library\|symbol.*library" src` | `[X]` The 7-item furniture catalogue is the whole symbol set |
| Door / window schedules with counts and marks | `grep -rni "door.*schedule\|window.*schedule" src` | `[X]` There is a **room** schedule; openings are never tabulated |
| Finishes schedule | — | `[X]` |
| Drawing number / sheet number / scale bar per view | Read [planSheet.ts:50-56](../../src/plan/planSheet.ts#L50-L56) | Scale bar **exists** `[V]`; sheet numbering `[X]` |

## 4. Building elements

| Element | Search | Result |
|---|---|---|
| **Columns / pillars** | `grep -rni "column\|pillar" src` | `[X]` |
| **Beams** | `grep -rni "\bbeam\b" src` | `[X]` |
| **Roof** | `grep -rni "roof\|rafter\|truss\|gable" src` | `[X]` |
| **Ceiling** | `grep -rni "ceiling\|soffit" src` | `[X]` |
| **Floor slab as a modelled element** | Read [FloorSlab.tsx](../../src/scene/FloorSlab.tsx) | `[X]` The slab is auto-sized to `planBounds` with a 0.5 m margin. It has no thickness the user can set, no opening, no edge profile |
| **Slab openings (stairwells, voids)** | `grep -rn "opening" src/scene/FloorSlab.tsx` | `[X]` — **so every staircase rises into solid concrete** |
| Curtain walls / glazing systems | `grep -rni "curtain\|mullion\|glazing.*system" src` | `[X]` A window is a rectangular hole |
| Railings / balustrades | `grep -rni "railing\|balustrade\|handrail" src` | `[X]` |
| Ramps | `grep -rni "ramp" src` | `[X]` |
| Non-straight stairs (L, U, dog-leg, spiral, winders) | Read the `Stair` type and [Stairs.tsx](../../src/scene/Stairs.tsx) | `[X]` One straight flight: `{position, rotation, width, run}` |
| Landings | — | `[X]` |
| Wall layers / composite construction (brick + cavity + plaster) | Read the `Wall` type | `[X]` One `thickness`, one `material` |
| Wall base / top constraints (attach to level) | — | `[X]` `Wall.height` is an absolute number |
| Foundations, plinth, DPC | `grep -rni "foundation\|plinth" src` | `[X]` |
| Site: contours, levels, terrain, cut/fill | `grep -rni "terrain\|contour\|elevation.*ground\|cut.*fill" src` | `[X]` `Ground` is a flat 400 m plane ([Ground.tsx:13-16](../../src/scene/Ground.tsx#L13-L16)) |

## 5. BIM / information modelling

| Capability | Search | Result |
|---|---|---|
| IFC import or export | `grep -rni "ifc" src server package.json` | `[X]` |
| Parametric families / types | — | `[X]` Furniture is a 7-entry const array |
| Object properties / parameters beyond geometry | Read every model type | `[X]` No user-definable attributes, no key/value store on any object |
| Classification (Uniclass, OmniClass, NBS) | `grep -rni "uniclass\|omniclass\|classification" src` | `[X]` |
| Levels / storeys as first-class objects with elevations | Read `FloorData` | `[X]` Three fixed slots; elevation is `index × FLOOR_HEIGHT` ([useDesignStore.ts:264](../../src/store/useDesignStore.ts#L264)) |
| Grids and datums | `grep -rni "gridline\|datum" src` | `[X]` The visual grid is a drawing aid, not a model object |
| Phasing / demolition / existing-vs-proposed | `grep -rni "phase\|demolition\|existing" src` | `[X]` |
| Design options / variants | `grep -rni "variant\|design.*option\|scenario" src` | `[X]` |
| Clash detection | `grep -rni "clash\|interference" src` | `[X]` |
| Model federation / linked models / xrefs | `grep -rni "xref\|linked.*model\|federat" src` | `[X]` |
| **Provenance / confidence on any object** | Read every model type | `[X]` No `source`, `confidence`, `author`, `createdAt` or `lockedBy` field. An AI-invented wall is indistinguishable from a drawn one — see [09_AI_INVENTORY.md](09_AI_INVENTORY.md) Q3 |

## 6. Analysis

| Capability | Search | Result |
|---|---|---|
| Structural analysis | `grep -rni "structural\|load.*bearing\|moment\|deflection" src` | `[X]` |
| Energy / thermal / U-values | `grep -rni "thermal\|u-value\|insulation\|energy" src` | `[X]` |
| Daylight / solar / shadow study over time | `grep -rni "daylight\|solar\|sun.*path\|equinox" src` | `[X]` The sun is a fixed `directionalLight` at `[14,18,9]` ([Lighting.tsx:34](../../src/scene/Lighting.tsx#L34)) |
| Acoustics | `grep -rni "acoustic\|reverb\|sound" src` | `[X]` |
| Egress / travel distance / occupancy load | `grep -rni "egress\|evacuat\|occupancy\|travel.*distance" src` | `[X]` |
| Accessibility / turning circles / clear widths | `grep -rni "accessib\|wheelchair\|ada\|turning.*circle" src` | `[X]` No minimum door width, no corridor width check. The AI *prompt* mentions 1.2 m corridors ([designAgent.ts:100](../../server/designAgent.ts#L100)) — nothing verifies it |
| **Building-code compliance** beyond plot setbacks | `grep -rni "code.*check\|byelaw\|compliance\|FAR\|FSI\|far.*ratio" src` | `[X]` **Setbacks are the only regulatory check.** No FAR/FSI, no ground-coverage limit, no height limit, no light-and-ventilation area ratio, no parking requirement — all standard on an Indian sanction drawing |
| Circulation / adjacency analysis | — | `[X]` |
| Cost by quantity (real BOQ) | Read [statement.ts:258-273](../../src/export/statement.ts#L258-L273) | `[X]` One rate × one area — see [07_CURRENT_FEATURES.md §18](07_CURRENT_FEATURES.md) |

## 7. Interoperability

| Format | Direction | Search | Result |
|---|---|---|---|
| DWG | in / out | `grep -rni "dwg" src server package.json` | `[X]` |
| DXF | in / out | `grep -rni "dxf" src server package.json` | `[X]` |
| IFC | in / out | `grep -rni "ifc" …` | `[X]` |
| PDF | **in** | `grep -rni "pdfjs\|getDocument" src` | `[X]` (PDF **out** exists `[V]`) |
| SVG | in / out | `grep -rni "svg" src` | `[X]` Only `favicon.svg` and inline JSX `<svg>` |
| glTF / OBJ / FBX **export** | out | `grep -rni "GLTFExporter\|OBJExporter\|toGLTF" src` | `[X]` — despite `three` shipping exporters and the repo containing `.glb`/`.obj`/`.fbx` working files |
| Point cloud (E57, LAS) | in | `grep -rni "e57\|\.las\b\|pointcloud" src` | `[X]` |
| Image out | out | — | `[V]` PNG exists |
| CSV out | out | — | `[V]` Exists |
| **Any open exchange format for the model itself** | — | — | `[X]` The only round-trippable format is this app's own `.json` |

## 8. Platform, collaboration and operations

| Capability | Search | Result |
|---|---|---|
| User accounts / auth | `grep -rni "auth\|login\|session\|jwt\|oauth" src server package.json` | `[X]` See [07_CURRENT_FEATURES.md §22](07_CURRENT_FEATURES.md) |
| Server-side storage / a database | `grep -rni "sql\|prisma\|mongo\|supabase\|firebase" …` | `[X]` `localStorage` only |
| Realtime multi-user editing | `grep -rni "yjs\|automerge\|crdt\|socket\|liveblocks\|presence" …` | `[X]` |
| Comments / markup / redlines | `grep -rni "comment\|markup\|redline" src` | `[X]` |
| Version history / named versions / restore a version | `grep -rni "version.*history\|restore.*version\|snapshot.*save" src` | `[X]` Undo is in-session only, capped at 100 steps, and cleared on every load |
| Permissions / roles | — | `[X]` One binary: `readOnly` |
| Audit trail / change log | — | `[X]` |
| Offline-first sync / conflict resolution | — | `[X]` Two tabs silently overwrite each other every 4 s |
| Mobile / touch-optimised UI | `grep -rn "touch\|pointercoarse\|@media" src` | `[X]` One `touch-none` class on the compass ([CompassWidget.tsx:120](../../src/components/CompassWidget.tsx#L120)). Pointer events are used throughout, so basic touch works, but no gesture set, no responsive layout, no `@media` query in `index.css` |
| Undo across sessions | — | `[X]` |
| Templates / starter projects | — | `[X]` |
| Keyboard shortcut set beyond Esc / Delete / ⌘Z / Space | Read [useUndoShortcut.ts](../../src/components/useUndoShortcut.ts), [useDeleteShortcut.ts](../../src/components/useDeleteShortcut.ts), [FloorPlanEditor.tsx:364-417](../../src/plan/FloorPlanEditor.tsx#L364-L417) | `[X]` No tool shortcuts (W for wall, D for door), no zoom-extents key, no numeric entry |
| Command palette | — | `[X]` |
| Localisation / i18n | `grep -rni "i18n\|locale\|translat" src` | `[X]` All strings are hardcoded English. `Intl.NumberFormat('en-IN')` is used for grouping ([statement.ts:384](../../src/export/statement.ts#L384), [documents.ts:407](../../src/export/documents.ts#L407)) — number formatting is localised, text is not |
| Accessibility beyond ARIA labels | `grep -rn "aria-\|role=" src \| wc -l` | Partial `[V]` — `aria-label`, `aria-pressed`, `aria-expanded`, `aria-current`, `aria-busy`, `role="group"`, `role="status"`, `role="img"` are used consistently. `[X]` But the **two viewports are canvases with no keyboard path and no accessible alternative** — the entire drawing surface is pointer-only |

## 9. Testing, quality and release

| Capability | Search | Result |
|---|---|---|
| Unit / integration / E2E tests | `find` for every common pattern | `[X]` **Zero** |
| Visual regression testing | — | `[X]` |
| CI / CD | `ls -a` | `[X]` No `.github/`, no `.gitlab-ci.yml` |
| Error reporting (Sentry etc.) | `grep -rni "sentry\|bugsnag\|rollbar\|datadog" …` | `[X]` |
| Analytics / telemetry | `grep -rni "analytics\|posthog\|mixpanel\|gtag" …` | `[X]` |
| Feature flags | `grep -rni "featureFlag\|flags\.\|LaunchDarkly" src` | `[X]` The seven visibility booleans are UI state, not flags |
| Performance budget / profiling harness | — | `[X]` |
| Changelog / release notes / semver | `ls` | `[X]` `package.json` version is `0.0.0` |

---

## The five absences with the widest consequences

Stated as facts, not as work to do.

1. **No tests over ~3,900 LOC of pure algorithm** — the PDF byte writer, the CV pipeline, the planar-graph room detector, the untrusted-input validator and the unit parser are all unverified, and three README sentences describe tests that do not exist.
2. **No provenance field on any object** — nothing in the model, the UI, the saved file, the exported PDF or the cost estimate distinguishes an AI-generated wall from a hand-drawn one.
3. **No production backend** — the three AI endpoints exist only inside `vite dev`.
4. **No regulatory check beyond plot setbacks** — no FAR/FSI, ground coverage, height limit, light-and-ventilation ratio or parking requirement, in a product whose plot/setback feature signals a sanction-drawing audience.
5. **No structural elements** — no columns, beams, roof, ceiling or slab openings, which is what separates "a plan you can walk through" from "a building you can build".
