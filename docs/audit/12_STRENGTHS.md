# 12 — Strengths

Evidence-based. Each entry names the code and says what specifically is good about it.

---

## 1. The comment culture is the codebase's most valuable asset `[V]`

930 comment lines across `src/` + `server/`, and the sampled ones are **explanations of *why*, not restatements of *what***. They routinely name the failure mode that motivated the code, which means the reasoning survives even where the code is wrong.

Representative examples:

> *"A positive Y rotation carries local +X toward -Z, so mapping +X onto the wall direction needs `atan2(-dz, dx)` — note the negated dz. Getting this sign wrong mirrors the whole plan, which is invisible on a symmetric one."*
> — [wallGeometry.ts:19-24](../../src/scene/wallGeometry.ts#L19-L24)

> *"The length filter runs BEFORE grouping, and that is the whole trick: at a corner, the crossing wall contributes a run only as long as it is thick, so discarding short runs stops a band from leaking down the wall it meets."*
> — [detectWalls.ts:412-418](../../src/blueprint/detectWalls.ts#L412-L418)

> *"Must reset, not just cancel: `requestDraw` treats a non-null ref as 'a frame is already queued'. Leaving the stale id here latches that guard on permanently, and the canvas never paints again after a remount."*
> — [FloorPlanEditor.tsx:422-427](../../src/plan/FloorPlanEditor.tsx#L422-L427)

> *"`formatLength` is lossy … and `parseLength` is NOT its inverse. Never feed a formatted string back into the model to 'normalise' a value: round-tripping a wall through a label would quietly walk its length by up to half an inch every edit."*
> — [length.ts:9-12](../../src/units/length.ts#L9-L12)

> *"Each sector spans 45°, centred on its own bearing — so North runs from 337.5° round to 22.5°, not from 0° to 45°. Getting that wrong rotates every reading by half a sector, which is invisible on a square plot and wrong on every other one."*
> — [orientation.ts:74-81](../../src/site/orientation.ts#L74-L81)

**Why this matters concretely:** with **zero tests**, these comments are the only encoding of the invariants. A change that violates one will not fail a test — but the reader has been told, at the exact line, what will break.

---

## 2. Untrusted input has exactly one gate, and AI output goes through it `[V]`

`parseDesign` ([schema.ts:325-499](../../src/persistence/schema.ts#L325-L499)) validates **four** sources with one implementation:

| Source | Call site |
|---|---|
| `.json` file import | [files.ts:45](../../src/persistence/files.ts#L45) |
| localStorage (projects and autosave) | [storage.ts:61, 111](../../src/persistence/storage.ts#L61) |
| Share-link fragment | [shareLink.ts:81](../../src/persistence/shareLink.ts#L81) |
| **LLM output** | [useDesignAI.ts:62-68](../../src/ai/useDesignAI.ts#L62-L68) |

The fourth is the notable one. The model's response is **wrapped as a `DesignDocument`** and pushed through the same validator as a file someone emailed you:

```ts
const parsed = parseDesign({
  version: DESIGN_VERSION,
  name: body.name ?? fallbackName,
  savedAt: new Date().toISOString(),
  settings: { viewMode: useDesignStore.getState().viewMode },
  walls: body.walls,
})
```

And the validator's central guard is exactly right for that input:

> *"`Number.isFinite` is the important part: JSON cannot encode NaN or Infinity, but `1e999` parses to Infinity and would otherwise flow into geometry and produce an unrenderable scene."*
> — [schema.ts:109-115](../../src/persistence/schema.ts#L109-L115)

The **malformed vs merely-odd** distinction is applied consistently: a bad `start` point rejects the file; a zero-length wall is dropped with a warning; an unknown material falls back; a missing id gets a fresh UUID. The stated principle — *"One bad row should not cost someone their whole file, but nonsense should never reach the geometry layer"* ([README.md:264-265](../../README.md#L264-L265)) — is actually implemented.

**Do not rewrite this.** It is the single decision that keeps the AI blast radius contained (Q4).

---

## 3. Pure, seamed algorithm modules `[V]`

~2,300 LOC of side-effect-free geometry that imports **only `type`** from the store:

| Module | LOC | Notable |
|---|---|---|
| [scene/wallGeometry.ts](../../src/scene/wallGeometry.ts) | 313 | `wallPieces`, `projectOntoWall`, `pickWall`, `pickOpening`, `pickFurniture`, `planBounds` |
| [scene/collision.ts](../../src/scene/collision.ts) | 301 | Swept-circle separation with a correct degenerate branch when the centre is inside the box |
| [vastu/analyse.ts](../../src/vastu/analyse.ts) | 399 | Sutherland-Hodgman clip, area-weighted dominant zone |
| [vastu/zones.ts](../../src/vastu/zones.ts) | 214 | The north-up frame transform |
| [plan/rooms.ts](../../src/plan/rooms.ts) | 251 | Planar-graph face traversal |
| [rooms/resolve.ts](../../src/rooms/resolve.ts) | 208 | Crossing-number PIP, area centroid with an inside-check fallback |
| [site/plot.ts](../../src/site/plot.ts) | 195 | Rectangle algebra, facing-aware setback mapping |
| [site/orientation.ts](../../src/site/orientation.ts) | 120 | Bearings, sectors, snapping |
| [units/length.ts](../../src/units/length.ts) | 254 | The sole unit authority |
| [export/statement.ts](../../src/export/statement.ts) | 522 | Design → statement object, no I/O |
| [scene/walkMotion.ts](../../src/scene/walkMotion.ts) | 68 | keys → velocity |
| [scene/avatarMotion.ts](../../src/scene/avatarMotion.ts) | 47 | Angle wrapping, damped turn, follow-camera placement |

`detectWalls.ts` goes further and defines its own `RasterLike` type *"so the detector runs outside a browser too"* ([:100](../../src/blueprint/detectWalls.ts#L100)) — an explicit testability seam.

**The architecture is unusually test-ready.** Adding a suite is a pure addition; nothing needs restructuring first.

---

## 4. Three genuinely hard algorithms, correctly implemented

### Room detection by planar-graph face traversal — [plan/rooms.ts](../../src/plan/rooms.ts)
Not a bounding-box or flood-fill approximation. `splitAtIntersections` creates a node at every T-junction (without which *"the traversal walks straight past it and merges two rooms into one"*, [:79-85](../../src/plan/rooms.ts#L79-L85)); `pruneDangles` iterates to a fixed point; `traceFaces` walks half-edges in angular order, hugging each face; the unbounded outer face is discarded by winding sign ([:6-14, 51-52](../../src/plan/rooms.ts#L51-L52)). This is the textbook-correct approach and it handles L- and U-shaped rooms.

### Label placement — [rooms/resolve.ts:140-194](../../src/rooms/resolve.ts#L140-L194)
The area-weighted centroid is computed, **then tested for containment**, because it falls outside an L-shaped room — *"a 'Kitchen' caption floating in the hallway makes the whole feature look broken"*. The fallback is the midpoint of the widest interior horizontal chord, sampled only at the scanlines halfway between consecutive vertex heights, which is exact for rectilinear plans. A cheap, correct stand-in for the pole of inaccessibility.

### Wall detection's four-way binarisation — [detectWalls.ts:725-745](../../src/blueprint/detectWalls.ts#L725-L745)
Rather than guessing the drawing's style, it runs **four** ink readings (Otsu-on-luma with auto-invert; Chebyshev distance from the sheet's dominant colour; darker-than-paper; lighter-than-paper) and **scores the candidates by total detected wall length**, keeping the best. The reasoning is explicit: *"Scoring the actual candidates is more honest than guessing the drawing's style up front, and costs one extra pass over an image already in memory."* `mergeWallFaces` then fuses the two drawn faces of an outlined wall — the fix for *"every wall built twice with a slot down the middle"* ([:615-630](../../src/blueprint/detectWalls.ts#L615-L630)).

---

## 5. Honesty about uncertainty, surfaced in the UI `[V]`

This runs through the whole product and is rare:

| Where | What it says |
|---|---|
| [analyse.ts:26-29](../../src/vastu/analyse.ts#L26-L29) | `'no-rule'` is a **distinct status from `'okay'`** — *"which is a different statement from `okay`"* |
| [analyse.ts:180-185](../../src/vastu/analyse.ts#L180-L185) | Below 75% coverage the sentence names the fraction rather than implying the whole room is in that zone |
| [statement.ts:102-108](../../src/export/statement.ts#L102-L108) | Vastu score is `null`, not 0, when nothing is named — *"averaging no readings gives 0, which would read as a terrible score rather than as no score"* |
| [statement.ts:64-69](../../src/export/statement.ts#L64-L69) | Cost is `null`, not ₹0 — *"a document showing ₹0 would read as a quotation for free work"* |
| [statement.ts:23-35](../../src/export/statement.ts#L23-L35) | `MEASUREMENT_BASIS` is carried **in the data** so every renderer must print it: *"a document that does not name its basis invites the reader to assume whichever one suits them"* |
| [BlueprintPanel.tsx:401-406](../../src/components/BlueprintPanel.tsx#L401-L406) | *"Not calibrated yet — this is the default guess, not a measurement."* |
| [detectOpenings.ts:194](../../src/blueprint/detectOpenings.ts#L194) | Dropped openings are **counted and reported**, not hidden |
| [App.tsx:104-106](../../src/App.tsx#L104-L106) | *"a silently empty scene would read as the app failing rather than the image being untraceable"* |
| [VastuPanel.tsx:279-283](../../src/components/VastuPanel.tsx#L279-L283) | *"this panel reports what one written ruleset says, and you and your client decide what to follow"* |
| [VastuPanel.tsx:18-21](../../src/components/VastuPanel.tsx#L18-L21) | Status carries a **word and a mark**, not only a colour — *"so the reading survives a greyscale print and a colour-blind reader"* |

The one place this discipline fails is exactly the place it matters most: `applyPlanScale` returns `kind: 'calibrated'` for an LLM estimate, and the banner says *"Sized to 40′ from the drawing."* (Q1). That is a lapse **against an otherwise consistent standard**, which is why it stands out.

---

## 6. The API-key boundary is airtight and structurally enforced `[V]`

| Guarantee | Verification |
|---|---|
| `server/` is never imported by `src/` | `[X]` grep → 0 hits. Sole importer: [vite.config.ts:5](../../vite.config.ts#L5) |
| No env value reaches client code | `[X]` grep `import.meta.env` across `src/` → **0 hits** |
| `process.env` read in exactly one file | [vite.config.ts](../../vite.config.ts) `[V]` |
| Keys passed as function arguments, never into `define` | [vite.config.ts:24-34](../../vite.config.ts#L24-L34) `[V]` |
| Enforced by build config, not convention | `server/` is outside `tsconfig.app.json`'s `include`, so client code **cannot** import it and still typecheck `[V]` |

The reasoning is spelled out at [vite.config.ts:9-17](../../vite.config.ts#L9-L17): naming it `VITE_ANTHROPIC_API_KEY` *"would inline the secret into the browser bundle and ship it to every visitor."* The README even supplies the verification command: `npm run build && grep -r "ANTHROPIC" dist/`.

---

## 7. Read-only mode is enforced at ten independent sites `[V]`

Not a single UI-level guard. `readOnly` gates:

`Toolbar` replacement ([App.tsx:66-70](../../src/App.tsx#L66-L70)) · every editing panel ([App.tsx:53](../../src/App.tsx#L53)) · autosave ([App.tsx:50](../../src/App.tsx#L50)) · undo shortcut ([useUndoShortcut.ts:28](../../src/components/useUndoShortcut.ts#L28)) · delete shortcut ([useDeleteShortcut.ts:34](../../src/components/useDeleteShortcut.ts#L34)) · 3D wall click ([Walls.tsx:210,219](../../src/scene/Walls.tsx#L210)) · 3D floor click ([FloorSlab.tsx:87](../../src/scene/FloorSlab.tsx#L87)) · 3D stair click ([Stairs.tsx:58](../../src/scene/Stairs.tsx#L58)) · 3D furniture click ([FurnitureModels.tsx:48](../../src/scene/FurnitureModels.tsx#L48)) · compass drag ([CompassWidget.tsx:122](../../src/components/CompassWidget.tsx#L122)).

The reason is stated: *"a read-only viewer that still showed Save, AI, and the drawing tools would be lying about what it can do"* ([SharedBanner.tsx:4-9](../../src/components/SharedBanner.tsx#L4-L9)).

---

## 8. The zero-network-dependency commitment, kept `[V]`

| Decision | Where | Reason given |
|---|---|---|
| Procedural canvas textures, no image files | [palette.ts:33-35](../../src/materials/palette.ts#L33-L35) | *"no binary assets, no network fetch, and the app stays fully self-contained"* |
| Environment map from in-scene `Lightformer` planes, not a preset HDR | [Lighting.tsx:3-15](../../src/scene/Lighting.tsx#L3-L15) | *"presets fetch several MB from a CDN, which would make the app depend on the network and stall the first render"* |
| 3D captions via drei `<Html>`, not `<Text>` | [RoomLabels.tsx:48-63](../../src/scene/RoomLabels.tsx#L48-L63) | *"`<Text>` renders through troika, which fetches a font file at runtime. That would break offline and under a strict CSP"* |
| PDF writer from scratch | [pdf.ts:1-9](../../src/export/pdf.ts#L1-L9) | base-14 fonts mean *"the viewer supplies the font, so nothing has to be embedded"* |
| Native `CompressionStream`, not `pako` | [shareLink.ts:28-38](../../src/persistence/shareLink.ts#L28-L38) | with an `'r'` fallback for browsers lacking it |
| Furniture as box compositions | [FurnitureModels.tsx:12-18](../../src/scene/FurnitureModels.tsx#L12-L18) | *"no asset files to fetch, no licences to track"* |
| Character model served from `public/`, not a CDN | [CharacterAvatar.tsx:10-12](../../src/scene/CharacterAvatar.tsx#L10-L12) | *"the app's own origin — no CDN"* |

Verified: **the only outbound requests in the entire client are the two same-origin `/api/ai/*` calls** `[X]`.

---

## 9. Deliberate, documented, well-argued performance choices `[V]`

Not premature optimisation — each names the symptom it prevents:

| Choice | Where | Reason |
|---|---|---|
| `avatarState` as a module singleton | [avatarState.ts:1-13](../../src/scene/avatarState.ts#L1-L13) | *"putting it in zustand would re-render the whole 3D tree 60 times a second to produce exactly the same React output"* |
| `allFloors` read via `getState()`, never as a selector | [ProjectsMenu.tsx:114-116](../../src/components/ProjectsMenu.tsx#L114-L116), [Building.tsx:38-41](../../src/scene/Building.tsx#L38-L41) | *"it builds a fresh array each call, so as a selector it would hand zustand a new snapshot on every render and spin forever"* |
| Imperative canvas + refs | [FloorPlanEditor.tsx:40-44](../../src/plan/FloorPlanEditor.tsx#L40-L44) | *"a React re-render per mousemove would be wasted work when the output is a canvas"* |
| Rooms and Vastu cells memoised outside the paint | [FloorPlanEditor.tsx:252-286](../../src/plan/FloorPlanEditor.tsx#L252-L286) | *"running it inside the paint would put a graph traversal on every pointer move"* |
| One shared unit-cube geometry for every wall piece | [Walls.tsx:38-42, 48](../../src/scene/Walls.tsx#L38-L42) | *"a wall costs draw calls rather than geometry allocations"* |
| Hatching bounded by the canvas, not the box | [draw.ts:518-525](../../src/plan/draw.ts#L518-L525) | *"zoomed in … hatching all of it would be thousands of strokes per frame to paint the handful that land on screen"* |
| Ghost storeys skip textures entirely | [Walls.tsx:128-131](../../src/scene/Walls.tsx#L128-L131) | *"a texture it cannot show is a canvas allocated per piece for nothing"* |
| Colliders rebuilt only when walls change | [ThirdPersonControls.tsx:85-87](../../src/scene/ThirdPersonControls.tsx#L85-L87) | *"Doing this per frame would re-slice every wall around every door sixty times a second for an identical answer"* |
| Swept collision rather than destination-only | [collision.ts:201-209](../../src/scene/collision.ts#L201-L209) | *"a running body covers up to 0.62 m in one capped frame, which is wider than a wall plus the body"* |
| Ghost material with `depthWrite: false` | [Walls.tsx:56-58](../../src/scene/Walls.tsx#L56-L58) | stops storey pieces cutting holes in each other at corners |
| Ghost storeys out of the shadow pass | [Walls.tsx:255-258](../../src/scene/Walls.tsx#L255-L258) | *"the shadow map has no notion of opacity, so a see-through storey would otherwise throw a solid shadow"* |

---

## 10. Rendering details that were tuned against a real frame `[V]`

| Detail | Where |
|---|---|
| **Tone mapping off** — R3F's ACES default *"is built for photographic HDR and turns these flat near-white surfaces grey"* | [SceneCanvas.tsx:120-125](../../src/scene/SceneCanvas.tsx#L120-L125) |
| **Light intensities sum to ~π** — *"three.js applies the Lambert BRDF's 1/π factor to every light, so a sum of π is what renders the floor at its actual colour"* | [Lighting.tsx:12-16](../../src/scene/Lighting.tsx#L12-L16) |
| **One shadow caster only** — *"a second caster produces crossing shadows that read as a rendering fault rather than as sunlight"* | [Lighting.tsx:30-32](../../src/scene/Lighting.tsx#L30-L32) |
| **`shadow-normalBias: 0.02`** — *"clears the acne that thin geometry (door reveals, table tops) otherwise shows"* | [Lighting.tsx:40-42](../../src/scene/Lighting.tsx#L40-L42) |
| **`SoftShadows` deliberately not used** — it *"injects GLSL calling `unpackRGBAToDepth`, which no longer compiles in three 0.185"* | [Lighting.tsx:20-25](../../src/scene/Lighting.tsx#L20-L25) |
| **Slab top at `y = 0.006`** — above `GROUND.gridOffsetY` *"so the slab cleanly covers the reference grid inside the building footprint instead of z-fighting with it"* | [config.ts:66-72](../../src/scene/config.ts#L66-L72) |
| **Half-pixel offsets on grid strokes** — *"lands the stroke on a pixel centre, so thin lines render crisp instead of blurred across two pixels"* | [draw.ts:1222-1224](../../src/plan/draw.ts#L1222-L1224) |
| **Nearest-neighbour when up-scaling a raster** — *"smoothing would ramp a crisp 1px wall into a grey gradient"* | [raster.ts:131-135](../../src/blueprint/raster.ts#L131-L135) |
| **Selection band clipped to the room and stroked at 2× width** — so the whole band lands inside, where walls do not cover it | [draw.ts:1019-1037](../../src/plan/draw.ts#L1019-L1037) |
| **Shared Vastu grid edges deduplicated** — *"a shared edge stroked twice paints at twice the intended weight … and the two dash runs would fill each other's gaps in"* | [draw.ts:1122-1132](../../src/plan/draw.ts#L1122-L1132) |

---

## 11. The `sensibleWidth` band check — the one place AI output is distrusted `[V]`

```ts
// src/blueprint/detectOpenings.ts:496-511
const OPENING_BAND_M = { door: [0.6, 1.4], window: [0.5, 3.0] }
function sensibleWidth(metres, type, wall) {
  const [min, max] = OPENING_BAND_M[type]
  const believable = Number.isFinite(metres) && metres >= min && metres <= max
  const chosen = believable ? metres : OPENING_DEFAULT_M[type]
  return Math.min(chosen, wallLength(wall) * 0.9)
}
```

> *"The free vision model's width is unreliable — it routinely over-reports, and an over-report used to survive as anything up to 90% of the wall, which is why doors rendered as wall-sized panels. So the detected width is trusted only when it lands in a sane band for its type."*

A model number is accepted **only inside a real-world plausibility band**, otherwise replaced with a physical default, then capped against the geometry. This is exactly the pattern that is **missing** from `applyPlanScale` twelve lines earlier in the same file.

---

## 12. Error handling that degrades rather than fails `[V]`

| Failure | Degradation |
|---|---|
| localStorage unavailable / full | Typed result with a quota-specific message; the app keeps working ([storage.ts:14-44](../../src/persistence/storage.ts#L14-L44)) |
| Character model missing or broken | Error boundary + `<Suspense>` → empty follow-camera, scene intact ([CharacterAvatar.tsx:189-216](../../src/scene/CharacterAvatar.tsx#L189-L216)) |
| Clipboard denied | Link shown in a selectable field instead ([ShareButton.tsx:71-79](../../src/components/ShareButton.tsx#L71-L79)) |
| `CompressionStream` absent | Share link falls back to raw base64 with an `'r'` tag ([shareLink.ts:40, 51-52](../../src/persistence/shareLink.ts#L51)) |
| Damaged share link | Still enters read-only **with the reason shown** — *"silently dropping into the editor would be more confusing"* ([useSharedDesign.ts:34-45](../../src/persistence/useSharedDesign.ts#L34-L45)) |
| Vision reply truncated mid-array | Regex salvage recovers the complete tuples — *"partial detection beats none on the shoestring budget this runs under"* ([openingDetector.ts:173-189](../../server/openingDetector.ts#L173-L189)) |
| Every AI key out of credit | One clean message rather than a dump of per-key errors ([designAgent.ts:143-148](../../server/designAgent.ts#L143-L148)) |
| Nothing drawn on any storey when exporting | Still issues one sheet with *"nothing drawn yet"* inside the frame — *"a document that opens on the area statement does not"* explain what happened ([documents.ts:89-92](../../src/export/documents.ts#L89-L92)) |
| PDF with no pages | A blank page is generated, because *"a PDF with no pages is not a valid PDF"* ([pdf.ts:907-918](../../src/export/pdf.ts#L907-L918)) |

---

## Parts a newcomer should not touch without deep study

Ranked by how expensive a mistake would be, and by how invisible the mistake would be.

| # | Area | Why | The specific trap |
|---|---|---|---|
| **1** | **The undo recorder** — [useDesignStore.ts:1269-1328](../../src/store/useDesignStore.ts#L1269-L1328) | A `subscribe` listener that writes back into the store it observes, gated by three module-scope flags and a `viewEpoch` watcher | Removing the `historyApplying` guard makes undo push its own result onto history. `designChanged` is a **pure reference compare** — introducing a `.map()` that returns a new array unchanged would record a phantom edit. |
| **2** | **The checked-out floor** — [useDesignStore.ts:311-321, 595-635](../../src/store/useDesignStore.ts#L311-L321) | `floors[activeFloor]` is **deliberately stale**. Reconciled in exactly three places. | Reading `state.floors` directly instead of `allFloors(state)` silently uses the last-switched-away-from version of the open storey. Six call sites already depend on getting this right. |
| **3** | **The wall rotation sign** — [wallGeometry.ts:19-24](../../src/scene/wallGeometry.ts#L19-L24) | `atan2(-dz, dx)` | Getting it wrong **mirrors the entire building** and is invisible on any symmetric plan. |
| **4** | **`length.ts`'s format/parse asymmetry** — [length.ts:1-13](../../src/units/length.ts#L1-L13) | `formatLength` rounds to the nearest inch; `parseLength` is not its inverse | Any round trip through a label walks the value by up to half an inch **every edit**. |
| **5** | **`pdf.ts`'s byte offsets** — [pdf.ts:821-828](../../src/export/pdf.ts#L821-L828) | Offsets are measured off the emitted chunks, never predicted | *"one wrong offset gives a file that some viewers open and others reject outright"* — with no test to catch it. |
| **6** | **`detectWalls.ts`'s ordering** — [detectWalls.ts:788-798](../../src/blueprint/detectWalls.ts#L788-L798) | `mergeWallFaces` must run **before** `typicalThickness`, or *"the 'typical wall' of a hatched drawing would be the weight of its pen rather than the width of its walls, and every later test would be scaled to that"* | Reordering two lines silently degrades every subsequent filter. |
| **7** | **`vastu/zones.ts`'s frame order** — [zones.ts:6-19](../../src/vastu/zones.ts#L6-L19) | Rotate to north-up **first**, then take the bounding box | *"Taking the box first and rotating the labels afterwards would shear the grid off the compass on every rotated plot — which is invisible on a square plan and wrong on all the others."* |
| **8** | **`rooms/resolve.ts`'s half-open PIP comparisons** — [resolve.ts:107-130](../../src/rooms/resolve.ts#L107-L130) | A point exactly on a shared wall belongs to exactly one room, never both, never neither | Changing `<` to `<=` makes labels **flicker between adjacent rooms as the plan redraws**. |
| **9** | **`collision.ts`'s degenerate branch** — [collision.ts:149-162](../../src/scene/collision.ts#L149-L162) | When the body centre is inside the box there is no separating direction to normalise | Removing it produces `NaN` positions and the figure vanishes. |
| **10** | **`CharacterAvatar.retargetClip`** — [CharacterAvatar.tsx:46-83](../../src/scene/CharacterAvatar.tsx#L46-L83) | Drops root-position tracks, pre-multiplies the Hips track by the rig's bind rotation | Skipping the bind pre-multiply *"tips the body flat"*; keeping the root track double-applies movement as drift. |
| **11** | **`Lighting.tsx`'s intensities** — [Lighting.tsx:12-16](../../src/scene/Lighting.tsx#L12-L16) | Tuned against a rendered frame with tone mapping off | *"Lower values drift grey."* Not derivable from first principles by inspection. |
