# Space Designer

A 3D space planning app.

- **Milestone 1** — the 3D workspace: a gridded floor you can orbit, pan, zoom.
- **Milestone 2** — a 2D floor-plan editor: click to draw walls on a snapping
  grid. Toggle 2D/3D from the toolbar. Walls live in a central Zustand store
  that both views read from.
- **Milestone 3** — the plan built in 3D: walls extrude into boxes on a floor
  slab, plus a first-person walk mode.
- **Milestone 4** — editing: select walls in either view, change height and
  thickness live, add doors and windows, delete anything.
- **Milestone 5** — persistence: named projects in localStorage, autosave, and
  JSON import/export.
- **Milestone 6** — AI: describe a space in plain language and get a floor plan,
  or edit the current plan with an instruction.
- **Milestone 7** — presentation: wall and floor finishes, furniture, studio
  lighting, a chrome-free Present mode, and read-only share links.
- **Later milestones**, not written up here: blueprint tracing with deterministic
  wall detection, room detection and naming, the area statement and cost sheet,
  plot boundaries and setbacks, Vastu analysis, multi-storey, stairs, PDF/CSV
  export, and a rigged walkthrough figure. See `docs/audit/` for what actually
  exists, feature by feature, and `docs/adr/` for what has changed since.

## Running it

```bash
npm install     # first time only
npm run dev
```

Open the URL it prints (usually http://localhost:5173).

### Enabling the AI features

The `AI` button needs an **OpenRouter** API key. Everything else works without
one. (`ANTHROPIC_API_KEY` is still read by `vite.config.ts` and then discarded —
generate/edit moved to OpenRouter.)

```bash
cp .env.example .env      # then edit .env and paste your key
npm run dev               # restart — the key is read at server start
```

Get a key from [openrouter.ai](https://openrouter.ai). Without one, the AI panel
still opens and reports that no key is configured.

**In a built deployment there are no AI endpoints at all** — they are Vite
dev-server middleware. A production build disables the AI controls and says so,
unless `VITE_AI_BASE_URL` points at a service you have stood up. See
`.env.example`.

Other scripts:

```bash
npm run build     # typecheck + production build into dist/
npm run preview   # serve the production build locally
```

## Controls

**3D view**

| Action | Mouse                                 |
| ------ | ------------------------------------- |
| Orbit  | left-click drag                       |
| Pan    | right-click drag (or two-finger drag) |
| Zoom   | scroll wheel / trackpad pinch         |

The camera cannot travel below the floor, and always keeps a slight downward
tilt so the scene never collapses to an empty horizon.

**2D view**

| Action                | Input                              |
| --------------------- | ---------------------------------- |
| Place / continue wall | left-click (snaps to the unit grid) |
| Finish wall chain     | `Esc` or double-click              |
| Pan                   | right-click or middle-click drag   |
| Zoom                  | scroll wheel (zooms toward cursor) |

A wall chain commits each segment to the store as you click, so the model is
always live — there is no separate "save" step.

**Tools** (toolbar, left)

| Tool     | What a click does                                     |
| -------- | ----------------------------------------------------- |
| `Select` | Selects a wall or opening; opens the inspector         |
| `Wall`   | Draws walls (plan view only)                           |
| `Door`   | Adds a door to the clicked wall, at the clicked point  |
| `Window` | Adds a window the same way                             |

Selection works in **both** views — click a wall in 3D and it highlights, with
the same inspector. `Esc` clears the selection (or finishes a wall chain first);
`Delete` / `Backspace` removes the selected item, except while typing in a
field. Editing a value updates the model on each keystroke, so a height change
is visible in 3D as you type.

**Finishes and furniture** (the `Finishes` button)

Select a wall to choose its finish in the inspector; the floor's finish lives in
the Finishes panel (or click the floor in 3D). Drag furniture from the panel
into either the plan or the 3D view — the plan drops at the cursor's grid point,
the 3D view raycasts onto the floor. Click a piece to move, rotate, or delete
it; drag it in the plan to reposition.

Textures are drawn procedurally to a canvas at load time — no image files, no
network fetch — and tiled against each surface's real dimensions, so brick
courses stay brick-sized on a 6 m wall and a 1 m one alike.

**Present** hides every panel and drops you into the walkthrough. `Esc` releases
the mouse; `Esc` again (or the button top-right) leaves.

**Share** copies a read-only link. The entire design travels in the URL
fragment, so **nothing is uploaded** — a fragment is never sent to a server.
The payload is gzipped before base64: a small plan is ~1.3 KB of JSON, which
would base64 to ~1.7 KB, but compresses to a link of about 800 characters.
Opening that link gives a viewer with 2D/3D, walk, and Present — but no editing
tools, no autosave, and no way to overwrite the viewer's own work. `Edit a copy`
releases it into a normal editable design.

**Projects** (the name button in the toolbar)

Type a name and `Save` to store a project in the browser. The dropdown lists
what is saved — click one to open it, `✕` to delete. `New` starts an empty
design; `Export` downloads the design as `.json`; `Import` loads one back.

The design **autosaves every 4 seconds** while it is changing, into a draft slot
that is restored on reload — so closing the tab does not lose work, named
project or not. If a project is open, autosave updates it too.

Loading or importing refits the plan view to the design's extents, so a project
drawn far from the origin does not open on empty grid and look broken.

**Walk mode** (3D only — press `Walk`, then click the scene to capture the
mouse)

| Action  | Input                    |
| ------- | ------------------------ |
| Look    | move the mouse           |
| Move    | `W` `A` `S` `D` / arrows |
| Run     | hold `Shift`             |
| Exit    | `Esc`, or `Exit walk`    |

Eye height is pinned at 1.7 m and movement is horizontal, so looking up does
not lift you off the floor. Entering walk mode drops you at the centre of the
layout; leaving it restores the orbit camera exactly where you left it.

**Collision differs between the two walk modes.** `Follow` resolves movement
against the walls with a swept circle, so a doorway is the only way through and
the camera pulls in rather than clipping into a wall. `Eyes` does not — it moves
the camera directly and you can walk through walls. That asymmetry is a known
gap, not a design: see `docs/audit/07_CURRENT_FEATURES.md`.

## Layout

```
server/                   Server-only — never imported by src/
  aiPlugin.ts             Vite middleware exposing /api/ai/generate and /edit
  designAgent.ts          Claude API call: system prompt + output schema
src/
  App.tsx                 App shell; renders the 2D or 3D viewport by store state
  ai/
    useDesignAI.ts        Calls the endpoints; validates results into the store
  components/
    Toolbar.tsx           Top bar — projects, AI, finishes, tools, Share, Present
    AIPanel.tsx           Brief -> plan, and instruction -> edited plan
    FurniturePanel.tsx    Floor finish + draggable furniture catalogue
    MaterialPicker.tsx    Swatch grid, filtered by surface
    PresentOverlay.tsx    The only chrome present mode shows
    SharedBanner.tsx      Header for a design opened from a share link
    ShareButton.tsx       Builds and copies the read-only link
  materials/
    palette.ts            Finishes + procedural canvas textures
  furniture/
    catalog.ts            Piece definitions and shared finishes
    ProjectsMenu.tsx      Save / open / delete / new / export / import
    InspectorPanel.tsx    Properties panel for the current selection
    NumberField.tsx       Number input that tolerates half-typed values
    useDeleteShortcut.ts  Delete/Backspace on the selection
  persistence/
    schema.ts             Document format + validator for untrusted JSON
    storage.ts            localStorage access, wrapped against failure
    files.ts              JSON download and file reading
    shareLink.ts          Gzip + base64url design <-> URL fragment
    useSharedDesign.ts    Loads a share link on startup and on hashchange
    useAutosave.ts        Draft restore on startup, periodic save
  store/
    useDesignStore.ts     Zustand store: walls, openings, selection, tool, view
  plan/                   2D floor-plan editor
    FloorPlanEditor.tsx   Canvas + pointer handling (draw / select / place / pan / zoom)
    draw.ts               Imperative canvas renderer (grid, walls, openings, selection)
    viewport.ts           Screen<->world transforms, grid snapping, zoom-to-cursor
  blueprint/              Trace an image: raster, deterministic wall detection,
                          the calibration authority ladder, the vision read
  rooms/ plan/rooms.ts    Rooms derived from the wall graph, names by containment
  site/                   Plot, setbacks, buildable area, bearings and sectors
  vastu/                  The placement ruleset, the nine-zone grid, the analysis
  units/                  length.ts — the sole unit converter, and the grid step
  export/                 pdf.ts (hand-rolled), statement.ts, documents.ts
  scene/                  3D workspace
    SceneCanvas.tsx       <Canvas> setup: renderer, camera, scene assembly
    Ground.tsx            Floor plane + infinite reference grid
    Walls.tsx             Store walls -> extruded boxes; click to select/place
    FloorSlab.tsx         Slab sized to the plan's extents
    FurnitureModels.tsx   Furniture as box compositions (no asset files)
    wallGeometry.ts       Pure: wall -> pieces, projection, hit-testing, bounds
    Lighting.tsx          Ambient + hemisphere + key/fill directional lights
    Controls.tsx          OrbitControls configuration
    WalkControls.tsx      First-person: pointer lock + WASD
    walkMotion.ts         Pure: key state -> velocity (pure, tested)
    config.ts             All scene tuning values in one place
```

### Lighting

The environment map is built from in-scene `Lightformer` planes rendered once to
a 256px cubemap, **not** from drei's `Environment preset`. The presets fetch
several megabytes of HDR from a CDN, which would make the app depend on the
network and stall the first frame. This gives real image-based reflections —
most visible on polished concrete — with nothing to download. `src/ai/endpoint.test.ts`
asserts that no deterministic module imports the AI layer, so the app keeps
working with every AI service down.

Only one light casts shadows. A second caster produces crossing shadows that
read as a rendering fault rather than as sunlight.

### Where the API key lives, and why

**The key is never sent to the browser.** This matters more than it looks: a
Vite app is client-side, so the obvious approach — `VITE_ANTHROPIC_API_KEY` and
`import.meta.env` — would compile the key straight into the JavaScript bundle
and ship it to every visitor. It would be "in an environment variable" and still
be fully public.

Instead the key is named `ANTHROPIC_API_KEY`, with **no `VITE_` prefix**, so
Vite will not expose it to client code. `vite.config.ts` reads it with
`loadEnv(mode, cwd, '')` and hands it to a dev-server middleware
([server/aiPlugin.ts](server/aiPlugin.ts)) that owns the Anthropic call. The
browser only ever talks to `/api/ai/generate` and `/api/ai/edit`.

Everything under `server/` is deliberately outside `src/` so it cannot be
imported by client code — importing it would pull the SDK, and the key, into the
bundle. To confirm the boundary holds, build and grep:

```bash
npm run build && grep -r "ANTHROPIC" dist/    # expect no matches
```

**This covers `npm run dev` only.** `npm run build` emits the front end alone —
a real deployment needs those two endpoints reimplemented on an actual server.
Do not solve that by moving the key into the client.

### How the AI output is handled

The model is asked for structured output against a JSON schema, so the response
is always shape-valid. That is not the same as *correct* — the geometry can
still be nonsense — so AI output goes through the **same `parseDesign`
validator as an imported file** before it reaches the store. A hallucinated wall
with an infinite coordinate is rejected exactly like a corrupt `.json`, and the
open design is left untouched.

Wall and opening ids are stripped before a design is sent for editing: they are
internal bookkeeping, cost tokens, and invite the model to echo stale ones back.
The validator assigns fresh ones on the way in.

### Saved file format

```json
{ "version": 2, "name": "...", "savedAt": "<ISO>",
  "settings": { "viewMode", "floorMaterial", "units",
                "constructionRate", "northOffset", "plotFacing" },
  "walls": [...], "furniture": [...], "rooms": [...],
  "plot": {...} | null, "floors": [...],
  "blueprint": {...} | null }
```

`version` is checked on load. A file from a newer app is refused rather than
half-read; an older one is migrated forward by `MIGRATIONS` in `parseDesign`,
one step at a time, and `ParseResult.originalVersion` reports where it came
from. Every migration ships with an old-format fixture and a round-trip test.

`blueprint` carries the traced underlay's placement and its calibration —
everything except the pixels, since an object URL cannot outlive the tab.
Re-picking the same file restores the measurement.

**Everything read from disk or localStorage goes through `parseDesign`**, which
treats its input as untrusted — a `.json` file is arbitrary user input, and
localStorage can be hand-edited in devtools. It distinguishes two cases:

- **Malformed** (not an object, no version, `walls` not an array, non-finite
  coordinates) → refused with a message, leaving the open design untouched.
- **Merely odd** (missing id, duplicate id, unknown opening type, zero-length
  wall) → repaired or dropped, and reported as a warning count.

One bad row should not cost someone their whole file, but nonsense should never
reach the geometry layer. Note `Number.isFinite` is load-bearing: JSON cannot
spell `Infinity`, but `1e999` parses to it and would otherwise produce an
unrenderable scene.

### Wall geometry

`wallPieces()` slices a wall into the solid boxes left once its openings are
removed: full-height runs between openings, plus the sill below and the lintel
above each one. A door with `sill = 0` simply produces no sill piece, so it
reads as a gap to the floor; a window leaves wall both below and above.

This is deliberately **not** a CSG boolean. Walls are axis-aligned boxes with
rectangular holes, so slicing the span gives an identical result with no
boolean-mesh dependency, and every piece stays a cheap unit cube. Openings that
overlap are skipped rather than allowed to emit negative-length geometry.

Each piece is a unit cube scaled to `(length, height, thickness)` and rotated
about Y. The rotation is `atan2(-dz, dx)` — **note the negated `dz`**.
A positive Y rotation carries local +X toward -Z, so the sign is what keeps the
3D build from mirroring the plan. It is easy to get backwards and invisible on
a symmetric layout, so `wallGeometry.ts` is kept pure and tested by mapping a
box's end faces back onto the wall's original endpoints.

Walls stand on `SLAB.top` rather than `y = 0`: the slab is lifted just above the
reference grid so it covers the grid inside the footprint instead of z-fighting
with it.

### The data model

Everything hangs off `useDesignStore`. A `Wall` is:

```ts
{ id, start: {x, z}, end: {x, z}, height /* 3 m */, thickness /* 0.2 m */ }
```

Points use `x`/`z` (not `x`/`y`) to match three.js world axes — the floor is the
XZ plane, `y` is up — so a plan drawn top-down maps into the 3D scene with no
conversion. The store rejects zero-length walls, which is also what makes the
second click of a double-click a harmless no-op.

Each wall carries its own openings:

```ts
{ id, type: 'door' | 'window', position /* m along the wall */, width, height, sill }
```

`sill` is the height of the opening's bottom edge: doors default to 0 (floor
level), windows to 0.9 m. Every write goes through `constrainOpening`, which
keeps an opening inside its wall — narrower than the wall, fully between its
ends, and no taller than the space above its sill. Shrinking a wall therefore
shrinks the openings in it rather than stranding them above the roofline, and
the geometry layer can trust whatever it is handed.

**One three.js unit = one metre.** The drawing grid belongs to the display
unit — 6 inches and 5 feet in `ft-in` mode (the default), 0.5 m and 5 m in
metric. On a half-metre grid no round imperial length is reachable by hand,
which is why the step follows the unit.
Keeping that ratio fixed means walls and furniture added later can be sized in
real-world metres with no conversion.

### Two rendering notes worth knowing

Both were tuned against a rendered frame, so don't "simplify" them without
looking at the result:

1. **Tone mapping is off** (`NoToneMapping` in `SceneCanvas.tsx`). R3F defaults
   to ACES filmic, which is built for photographic HDR and turns these flat
   near-white surfaces grey.
2. **Light intensities sum to ~π.** three.js applies the Lambert BRDF's `1/π`
   factor to every light, so a sum of π is what renders the floor at its actual
   `GROUND.color`. Lower values drift grey.

Shadow casting is on the key light; furniture, stairs, door leaves and the
walkthrough figure all cast, and the floor receives.
