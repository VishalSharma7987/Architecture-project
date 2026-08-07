# 09 — AI Inventory (Q2, Q3, Q4)

## Q2 — Every LLM / vision call site

There are **exactly three** endpoints and **exactly two** outbound model calls. `[X]` grep for `fetch(`, `openrouter`, `anthropic`, `openai`, `generativelanguage` across `src/` and `server/` finds nothing else.

```
BROWSER                                  NODE (vite dev only)         EXTERNAL
─────────────────────────────────────────────────────────────────────────────
useDesignAI.call('generate')  ──POST──▶ /api/ai/generate
  src/ai/useDesignAI.ts:34                aiPlugin.ts:122
                                          └▶ generateDesign(keys, brief)
                                             designAgent.ts:216
                                             └▶ requestDesign → callOnce ──▶ openrouter.ai
                                                                            anthropic/
                                                                            claude-sonnet-4.5

useDesignAI.call('edit')      ──POST──▶ /api/ai/edit
  src/ai/useDesignAI.ts:34                aiPlugin.ts:130
                                          └▶ editDesign(keys, design, instruction)
                                             designAgent.ts:223           ──▶ (same)

analyseBlueprint()            ──POST──▶ /api/ai/openings
  src/blueprint/detectOpenings.ts:90      aiPlugin.ts:143
                                          └▶ analysePlan(keys, imageDataUrl)
                                             openingDetector.ts:230
                                             └▶ callModel ──────────────▶ openrouter.ai
                                                                          google/
                                                                          gemma-4-26b-a4b-it
                                                                          :free
```

`analyseBlueprint` has **two** triggers — the manual button and the automatic 2D→3D path — so there are **four user-facing AI entry points** in total.

---

## Call site 1 & 2 — `generateDesign` / `editDesign`

| Field | Value |
|---|---|
| **Client file** | [src/ai/useDesignAI.ts:24-99](../../src/ai/useDesignAI.ts#L24-L99) |
| **Server file** | [server/designAgent.ts](../../server/designAgent.ts) |
| **Trigger (generate)** | AI panel → "Generate floor plan" — [AIPanel.tsx:59](../../src/components/AIPanel.tsx#L59) → `generate(brief)`. Disabled while busy or when the brief is empty. |
| **Trigger (edit)** | AI panel → "Apply edit" — [AIPanel.tsx:95](../../src/components/AIPanel.tsx#L95) → `edit(instruction)`. Disabled when `walls.length === 0`. |
| **Model** | `'anthropic/claude-sonnet-4.5'` — [designAgent.ts:13](../../server/designAgent.ts#L13) |
| **Endpoint** | `https://openrouter.ai/api/v1/chat/completions` — [:14](../../server/designAgent.ts#L14) |
| **max_tokens** | `6000` — [:15](../../server/designAgent.ts#L15) |
| **response_format** | `{ type: 'json_object' }` — *"the widest response-format constraint every provider on OpenRouter honours"* [:165-167](../../server/designAgent.ts#L165-L167) |

### The system prompt, quoted verbatim `[V]` — [designAgent.ts:69-104](../../server/designAgent.ts#L69-L104)

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

Appended at request time — [designAgent.ts:172-174](../../server/designAgent.ts#L172-L174):
```
\n\nReturn a JSON object matching this JSON Schema exactly:\n{…DESIGN_SCHEMA…}
```

### The user messages, verbatim `[V]`

**generate** — [designAgent.ts:216-221](../../server/designAgent.ts#L216-L221):
```
Design a floor plan for this brief:

${brief}
```

**edit** — [designAgent.ts:223-240](../../server/designAgent.ts#L223-L240):
```
Here is the current floor plan:

${JSON.stringify(design, null, 2)}

Apply this change:

${instruction}

Return the COMPLETE updated plan, including every wall you are keeping unchanged. Preserve the existing geometry wherever the instruction does not require altering it — do not redraw the building from scratch.
```

`design` is built at [useDesignAI.ts:108-117](../../src/ai/useDesignAI.ts#L108-L117) and contains **`{name, walls[]}` with all `id`s stripped** (walls' and openings'). Ids are removed because *"they are internal bookkeeping, cost tokens, and invite the model to echo stale ones back"* ([:109-110](../../src/ai/useDesignAI.ts#L109-L110)).

### Expected response shape `[V]` — `DESIGN_SCHEMA`, [designAgent.ts:44-67](../../server/designAgent.ts#L44-L67)

```jsonc
{ "name": "string", "notes": "string",
  "walls": [ { "start": {"x":n,"z":n}, "end": {"x":n,"z":n},
               "height": n, "thickness": n,
               "openings": [ {"type":"door"|"window","position":n,
                              "width":n,"height":n,"sill":n} ] } ] }
```
`additionalProperties: false` throughout; `required` on every field.
**The schema is instructed, not enforced** — [designAgent.ts:207](../../server/designAgent.ts#L207): *"The schema is instructed, not enforced, so strip any code fence and parse."*

### How the response is parsed `[V]`

**Server** — [designAgent.ts:194-213](../../server/designAgent.ts#L194-L213):
1. `payload.error` present → throw its message
2. `finish_reason === 'length'` → throw *"The plan was too large to finish. Try a smaller or simpler brief."*
3. no `content` → throw *"The model returned no design."*
4. strip a ```` ```json ```` fence with `/```(?:json)?\s*([\s\S]*?)```/`
5. `JSON.parse` → on failure throw *"The model did not return a readable plan."*
6. Returned **unvalidated** as `DesignResult {name, notes, walls: unknown[]}`

**Client** — [useDesignAI.ts:47-96](../../src/ai/useDesignAI.ts#L47-L96):
```ts
const parsed = parseDesign({
  version: DESIGN_VERSION,
  name: body.name ?? fallbackName,
  savedAt: new Date().toISOString(),
  settings: { viewMode: useDesignStore.getState().viewMode },
  walls: body.walls,
})
if (!parsed.ok) → error "The generated plan was not usable: …"
if (parsed.doc.walls.length === 0) → error "…returned a plan with no walls."
useDesignStore.getState().loadDesign({ name: parsed.doc.name, walls: parsed.doc.walls })
```

**★ This is the single best decision in the AI integration** `[V]`: the model's output is wrapped as a `DesignDocument` and pushed through the **same `parseDesign` validator as an untrusted file import**. A hallucinated `1e999` coordinate is rejected by `Number.isFinite` exactly like a corrupt `.json` ([schema.ts:109-115](../../src/persistence/schema.ts#L109-L115)), and the open design is left untouched.

### Failure / timeout / malformed handling `[V]`

| Failure | Behaviour | Line |
|---|---|---|
| No key configured | 503 + *"No API key configured. Copy .env.example to .env, add an OPENROUTER_API_KEY, and restart the dev server."* | [aiPlugin.ts:92-98](../../server/aiPlugin.ts#L92-L98) |
| Non-POST | 405 | [:88-91](../../server/aiPlugin.ts#L88-L91) |
| Body > 1 MB | reject → catch → 500 *"Request body too large."* (not 413) | [:41-47, 111-116](../../server/aiPlugin.ts#L41-L47) |
| Bad JSON body | 400 | [:104-108](../../server/aiPlugin.ts#L104-L108) |
| Empty brief / instruction | `throw new Error(...)` → 500 with the message | [:124-136](../../server/aiPlugin.ts#L124-L136) |
| Upstream 401 | *"The AI key was rejected. Check the key in .env."* | [designAgent.ts:183-185](../../server/designAgent.ts#L183-L185) |
| Upstream 402 | *"The AI account is out of credit. Top it up at openrouter.ai to generate plans."* | [:186-190](../../server/designAgent.ts#L186-L190) |
| Other upstream status | `The AI service returned ${status}. ${detail.slice(0,200)}` | [:191](../../server/designAgent.ts#L191) |
| **All keys failed** | If every failure contains "out of credit" → one clean message; otherwise the per-key reasons are joined with ` \| ` | [:143-148](../../server/designAgent.ts#L143-L148) |
| Client cannot reach the server | *"Could not reach the server. Is the dev server running?"* | [useDesignAI.ts:39-45](../../src/ai/useDesignAI.ts#L39-L45) |
| Client cannot parse the response | *"The server returned a malformed response."* | [:50-53](../../src/ai/useDesignAI.ts#L50-L53) |
| **Timeout** | **`[X]` NONE.** No `AbortController`, no `signal`, no `setTimeout` on either fetch. A hung upstream hangs the request until the browser or Node gives up. grep `AbortController\|AbortSignal\|signal:` across `src`/`server` → 0 hits. |

### ★ Does any number from this response reach geometry?

**YES — all of it.** `walls[].start/end/height/thickness` and `openings[].position/width/height/sill` become the design outright. The only gates are:
- `Number.isFinite` ([schema.ts:114-115](../../src/persistence/schema.ts#L114-L115))
- `normalizeWall` → clamps to `LIMITS` and re-constrains every opening ([useDesignStore.ts:575-587](../../src/store/useDesignStore.ts#L575-L587), applied at [:1093](../../src/store/useDesignStore.ts#L1093))
- zero-length walls dropped ([schema.ts:176-178](../../src/persistence/schema.ts#L176-L178))

**Nothing checks that the geometry is architecturally sensible.** Rooms that do not close, walls crossing mid-span, a bedroom with no door — all pass. The README states this plainly: *"That is not the same as *correct* — the geometry can still be nonsense"* ([README.md:234-236](../../README.md#L234-L236)).

### Retry / cache / rate limit / cost tracking

| | Status |
|---|---|
| **Retry** | `[V]` **Key failover only, no retry on the same key.** `requestDesign` loops `available` keys once each ([designAgent.ts:131-139](../../server/designAgent.ts#L131-L139)). A transient 500 on a single-key setup fails outright. |
| **Cache** | `[X]` **None.** No memo, no ETag, no dedup. The same brief twice = two paid calls. |
| **Rate limit** | `[X]` **None** server-side. The only throttle is the UI disabling the button while `status.kind === 'loading'` ([AIPanel.tsx:60,96](../../src/components/AIPanel.tsx#L60)). |
| **Cost tracking** | `[X]` **None.** No token counting, no usage log, no budget. `payload.usage` is not read. |
| **Cost exposure** | `[V]` **Real.** `claude-sonnet-4.5` at `max_tokens: 6000` is a paid model. The *edit* path additionally sends the **entire current plan as pretty-printed JSON with 2-space indentation** in the user message ([:232](../../server/designAgent.ts#L232)) — a 60-wall plan is tens of KB of input tokens per edit. |

---

## Call site 3 — `analysePlan` (blueprint vision read)

| Field | Value |
|---|---|
| **Client file** | [src/blueprint/detectOpenings.ts:78-113](../../src/blueprint/detectOpenings.ts#L78-L113) |
| **Server file** | [server/openingDetector.ts](../../server/openingDetector.ts) |
| **Trigger A** | Blueprint panel → "Detect doors & windows" — [BlueprintPanel.tsx:552](../../src/components/BlueprintPanel.tsx#L552) → `detectAndPlaceOpenings()`. Refuses when `walls.length === 0`. **Does not touch the scale.** |
| **Trigger B ★** | **Automatic, on switching to 3D** — [useBlueprintStructure.ts:56-118](../../src/blueprint/useBlueprintStructure.ts#L56-L118). Fires when `viewMode==='3d'` **and** a visible blueprint exists **and** `walls.length === 0`. **This one DOES write the scale.** |
| **Model** | `'google/gemma-4-26b-a4b-it:free'` — [openingDetector.ts:23](../../server/openingDetector.ts#L23) |
| **max_tokens** | `1200` — [:26](../../server/openingDetector.ts#L26) |
| **Attempts** | `ATTEMPTS_PER_KEY = 2`, looped over every key → up to `2 × keys` requests — [:36, 248-264](../../server/openingDetector.ts#L248-L264) |
| **Payload** | JPEG data URL, ≤1100 px longest edge, quality 0.82 — [detectOpenings.ts:20, 522-544](../../src/blueprint/detectOpenings.ts#L522-L544) |

### The prompt, quoted verbatim `[V]` — [openingDetector.ts:44-57](../../server/openingDetector.ts#L44-L57)

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

The tuple/short-key format exists purely to fit the 1200-token budget — *"the binding constraint here is the token budget, not legibility"* ([:38-43](../../server/openingDetector.ts#L38-L43)).

### Expected response shape `[V]`

```jsonc
{ "w": 40|null, "d": 30|null,
  "box": [x0,y0,x1,y1],
  "o": [["d"|"w", x, y, width], …],
  "r": [[name, x, y], …],
  "f": [[kind, x, y], …] }
```

### How the response is parsed `[V]` — [openingDetector.ts:331-384](../../server/openingDetector.ts#L331-L384)

```
unfence(text)                                                    :92-98
  strip <think>…</think>, closed OR unclosed-to-end
  strip a ```json fence
JSON.parse
 ├─ SUCCESS  :343-361
 │    widthFeet = num(w) ?? num(widthFeet)      num() = finite AND > 0
 │    depthFeet = num(d) ?? num(depthFeet)      ← the old verbose keys accepted too
 │    box       = parseBox(box)   accepts [4] or {x0,y0,x1,y1};
 │                                 REJECTS a degenerate box (x1<=x0 || y1<=y0)
 │    openings  = (o ?? openings).map(parseOpening).filter(non-null)
 │                 tuple OR object; type "d"/"door", "w"/"window"
 │                 inFrame: -0.1 < x,y < 1.1
 │    rooms     = parseLabels(r ?? rooms)     name non-empty, x/y in frame
 │    furniture = parseLabels(f ?? furniture)
 └─ FAILURE (truncated / prose) :363-383   ← the SALVAGE path
      salvageOpenings(body)  regex /\[\s*"([dw])"\s*,\s*(-?[\d.]+)…\]/g
      salvageLabels(body)    split at the `"f":` marker — tuples before it are
                             rooms, after it furniture. This is what stops
                             "bedroom" containing "bed" from crossing buckets.
      if all three are empty → throw "The model did not return readable JSON."
      else return { widthFeet: null, depthFeet: null, box: null, … }
                          ↑ NOTE: the salvage path always yields NO SCALE
```

`isEmptyAnalysis` ([:276-283](../../server/openingDetector.ts#L276-L283)) treats a read with no openings, no rooms, no furniture **and** no box as worth retrying; `bestEmpty` keeps the first such read as a last resort ([:242, 255, 268](../../server/openingDetector.ts#L268)).

### Failure handling `[V]`

| Failure | Behaviour |
|---|---|
| No key | 503 with a distinct message — [aiPlugin.ts:148-154](../../server/aiPlugin.ts#L148-L154) |
| Body > 8 MB | reject → 500 |
| `image` not `data:image/` | throw *"No blueprint image was sent."* — [aiPlugin.ts:165-168](../../server/aiPlugin.ts#L165-L168) |
| Upstream non-2xx | `returned ${status}. ${detail.slice(0,200)}` per key, collected |
| All attempts failed | `Detection failed. ${failures.join(' | ')}` |
| Client: image undecodable | *"That blueprint image could not be read."* — [detectOpenings.ts:85-87](../../src/blueprint/detectOpenings.ts#L85-L87) |
| Client: network | *"Could not reach the detection service."* — [:110-112](../../src/blueprint/detectOpenings.ts#L110-L112) |
| **Timeout** | `[X]` **NONE** |

### ★ Does any number from this response reach geometry?

**YES, four separate ways** — and one of them is the most consequential number in the app.

| # | Response field | Reaches | Guard |
|---|---|---|---|
| **1** | `w`, `d`, `box` | **`blueprint.metresPerPixel` and `blueprint.origin`** — [detectOpenings.ts:145-153](../../src/blueprint/detectOpenings.ts#L145-L153). Every subsequently detected wall's world coordinates are derived from this. | `num()` requires finite and > 0; `parseBox` rejects degenerate boxes; when both dimensions are read the two estimates are **averaged**. **No clamp on the result.** |
| **2** | `o[].x, y` | Opening world position → `pickWall(..., 2.2 m)` → `addOpening(wall, type, t)` | 2.2 m snap tolerance; a miss is **dropped and counted** ([:194](../../src/blueprint/detectOpenings.ts#L194)) |
| **3** | `o[].width` | Opening width | **`sensibleWidth`** — trusted only inside `[0.6,1.4]` m (door) / `[0.5,3.0]` m (window), else replaced with 0.9 / 1.2 m, then capped at 90% of the wall ([:481-511](../../src/blueprint/detectOpenings.ts#L481-L511)). The comment explains the history: *"an over-report used to survive as anything up to 90% of the wall, which is why doors rendered as wall-sized panels."* **This is the one place the code distrusts the model's numbers, and it is well done.** |
| **4** | `r[].x,y` / `f[].x,y` | Room-label anchors; furniture positions | Rooms: keyword-matched or skipped. Furniture: `fitToRoom` re-seats the piece against the nearest wall and clamps its rotated footprint inside the room bounds ([:382-419](../../src/blueprint/detectOpenings.ts#L382-L419)) |

### Retry / cache / rate limit / cost

| | Status |
|---|---|
| **Retry** | `[V]` **Yes** — `2 rounds × N keys`, first non-empty wins. Reasoned: *"the model is sampled, not deterministic: the same plan can come back fully read on one call and empty on the next, which is what makes detection feel like it 'sometimes works'"* ([:244-247](../../server/openingDetector.ts#L244-L247)). |
| **Cache** | `[X]` **None.** Pressing "Detect doors & windows" twice re-sends the JPEG. |
| **Rate limit** | `[X]` None in-app. The **upstream** free tier rate-limits, which is why multiple keys exist ([.env.example:11-14](../../.env.example)). |
| **Cost tracking** | `[X]` None. |
| **Cost exposure** | `[V]` **Low by design.** `:free` is explicitly chosen *"so it never touches account credit"* and *"sidesteps OpenRouter's out-of-credit 402"* ([:20-23](../../server/openingDetector.ts#L20-L23)). |
| **Model fragility** | `[V]` The id is hardcoded with a note: *"If this id 404s it has been renamed — pick another from https://openrouter.ai/models"* ([:21-23](../../server/openingDetector.ts#L21-L23)). A free model id is not a stable contract. |

---

## Q3 — Geometry provenance

Every code path that can create each entity, classified.

### Walls

| # | Path | Class | Evidence |
|---|---|---|---|
| W1 | 2D wall tool click chain | **deterministic** | [FloorPlanEditor.tsx:457-469](../../src/plan/FloorPlanEditor.tsx#L457-L469) → `addWall` |
| W2 | Blueprint "Detect walls" → "Add these walls" | **deterministic** (CV, staged for review) | [BlueprintPanel.tsx:212-230](../../src/components/BlueprintPanel.tsx#L212-L230) |
| W3 | **Auto-build on 2D→3D** | **deterministic geometry at an AI-derived scale** | [buildStructure.ts:44-74](../../src/blueprint/buildStructure.ts#L44-L74). The *segments* come from CV; their *metres* come from `applyPlanScale`. |
| W4 | AI generate | **AI-derived** | [useDesignAI.ts:86-89](../../src/ai/useDesignAI.ts#L86-L89) → `loadDesign` |
| W5 | AI edit | **AI-derived** | same |
| W6 | Load project / import `.json` / autosave restore / share link | **deterministic** (replay) | 4 `loadDesign` call sites |
| W7 | `copyToNextFloor` | **deterministic** (copy with fresh ids) | [useDesignStore.ts:833-876](../../src/store/useDesignStore.ts#L833-L876) |

### Doors / windows (`Opening`)

| # | Path | Class | Evidence |
|---|---|---|---|
| O1 | Door/Window tool click in 2D | **deterministic** | [FloorPlanEditor.tsx:603-619](../../src/plan/FloorPlanEditor.tsx#L603-L619) |
| O2 | Door/Window tool click in 3D | **deterministic** | [Walls.tsx:222-237](../../src/scene/Walls.tsx#L222-L237) |
| O3 | Inspector edits (width/height/sill/position) | **deterministic** | [InspectorPanel.tsx:84-117](../../src/components/InspectorPanel.tsx#L84-L117) |
| O4 | Drag an opening along its wall | **deterministic** | [FloorPlanEditor.tsx:631-637](../../src/plan/FloorPlanEditor.tsx#L631-L637) |
| O5 | `placeOpenings` — manual "Detect doors & windows" | **AI-derived** | [detectOpenings.ts:167-195](../../src/blueprint/detectOpenings.ts#L167-L195) |
| O6 | `placeOpenings` — automatic on 2D→3D | **AI-derived** | [useBlueprintStructure.ts:98](../../src/blueprint/useBlueprintStructure.ts#L98) |
| O7 | AI generate / edit (nested in walls) | **AI-derived** | via `parseDesign` |
| O8 | Load / import / restore / share / copy-up | **deterministic** | |

### Rooms

Rooms are **never created** — they are derived from the wall graph every time `detectRooms(walls)` runs ([plan/rooms.ts:37](../../src/plan/rooms.ts#L37)). **`RoomLabel`s** are what get created:

| # | Path | Class | Evidence |
|---|---|---|---|
| R1 | Click open floor → Room inspector → pick a type | **deterministic** | [InspectorPanel.tsx:510-513](../../src/components/InspectorPanel.tsx#L510-L513) → `nameRoom` |
| R2 | Typed custom name | **deterministic** | [InspectorPanel.tsx:583-585](../../src/components/InspectorPanel.tsx#L583-L585) |
| R3 | `placeRooms` — either detection trigger | **AI-derived** | [detectOpenings.ts:285-298](../../src/blueprint/detectOpenings.ts#L285-L298). Name **and** anchor point both come from the model. |
| R4 | Load / import / restore / share / copy-up | **deterministic** | |
| — | AI generate / edit | **cannot** — `DESIGN_SCHEMA` has no rooms field, and `loadDesign` from the AI path passes no `roomLabels`. **Every existing room name is destroyed instead.** |

### Furniture

| # | Path | Class | Evidence |
|---|---|---|---|
| F1 | Drag from the panel to 2D | **deterministic** | [FloorPlanEditor.tsx:677-685](../../src/plan/FloorPlanEditor.tsx#L677-L685) |
| F2 | Drag from the panel to 3D | **deterministic** (raycast) | [SceneCanvas.tsx:70-100](../../src/scene/SceneCanvas.tsx#L70-L100) |
| F3 | Click a catalogue item → drops at the plan centre | **deterministic** | [FurniturePanel.tsx:41-47](../../src/components/FurniturePanel.tsx#L41-L47) |
| F4 | `placeKitchenCounters` / `placeToiletFixtures` | **deterministic** (driven by room names, which may themselves be AI-derived) | [detectOpenings.ts:344-375](../../src/blueprint/detectOpenings.ts#L344-L375) |
| F5 | `placeFurniture` — either detection trigger | **AI-derived** | [detectOpenings.ts:309-329](../../src/blueprint/detectOpenings.ts#L309-L329) |
| F6 | Inspector / drag edits | **deterministic** | |
| F7 | Load / import / restore / share / copy-up | **deterministic** | |
| — | AI generate / edit | **cannot** create it — and **destroys** all of it |

### Stairs and Plot — **100% deterministic** `[V]`
`addStair` from the stair tool ([FloorPlanEditor.tsx:475-480](../../src/plan/FloorPlanEditor.tsx#L475-L480)) or the panel button ([FurniturePanel.tsx:49-53](../../src/components/FurniturePanel.tsx#L49-L53)); `setPlot` from the plot panel ([PlotPanel.tsx:69-86](../../src/components/PlotPanel.tsx#L69-L86)). No AI path touches either.

### Provenance summary

**Nothing in the model records where an object came from.** `[X]` No `source`, `origin`, `confidence` or `provenance` field exists on `Wall`, `Opening`, `RoomLabel` or `FurnitureItem` — see the verbatim types in [05_DATA_MODEL.md](05_DATA_MODEL.md). An AI-invented wall is indistinguishable from a hand-drawn one the moment it lands in the store, in the UI, in the saved file, in the exported PDF and in the cost estimate.

---

## Q4 — What happens if every AI call fails right now?

Assume every request to `/api/ai/*` returns an error (no key, no credit, upstream down, or a production build where the endpoints do not exist at all).

### BREAKS — the feature is unusable

| Feature | What the user sees | Line that produces it |
|---|---|---|
| **AI: generate a plan** | Error text in the panel: the server's message, or *"Could not reach the server. Is the dev server running?"*. No design change. | [useDesignAI.ts:39-58](../../src/ai/useDesignAI.ts#L39-L58) → [AIPanel.tsx:120-127](../../src/components/AIPanel.tsx#L120-L127) |
| **AI: edit a plan** | Same. **The existing design is untouched** — `loadDesign` is only reached after `parsed.ok`. | same |
| **Blueprint: "Detect doors & windows"** | Error in the panel; walls unchanged. | [BlueprintPanel.tsx:242-245](../../src/components/BlueprintPanel.tsx#L242-L245) |

### DEGRADES — still works, with less

| Feature | Degraded behaviour | Line |
|---|---|---|
| **2D→3D with a blueprint and no walls** | `analyseBlueprint()` returns `{ok:false}` → `scale = {kind:'guess'}` → **`applyPlanScale` is never called, so the manual calibration SURVIVES** → `buildWallsFromBlueprint()` still runs and builds walls from the CV detector at whatever scale the blueprint currently has → phase becomes `'walls-only'` and the banner reads *"Built N walls, but the doors and windows could not be read (…). Add them from the Blueprint panel or by hand."* | [useBlueprintStructure.ts:78-96](../../src/blueprint/useBlueprintStructure.ts#L78-L96), banner at [App.tsx:133-134](../../src/App.tsx#L133-L134) |

`[V]` **Note the inversion:** with AI *down*, the calibration bug (Q1) cannot fire. The failure mode is strictly safer than the success mode.

### UNAFFECTED — everything else

`[V]` **No AI call is on any of these paths** (verified by following every import of `useDesignAI` and `detectOpenings`):

drawing walls · doors/windows by hand · the inspector · undo/redo · rooms and areas · the room schedule · **the entire Vastu subsystem** · the plot, setbacks and buildable check · the compass · units · materials and textures · furniture (drag, place, quick-fill counters/toilets) · stairs · multi-storey and copy-up · **wall detection from a blueprint** (CV, fully deterministic) · manual calibration · 3D rendering, orbit, both walk modes, the character, door leaves · Present mode · **every export** (plan PDF, statement PDF, CSV, plan PNG, 3D PNG, `.json`) · save/load/autosave · share links.

### Which lines throw

`[V]` **None reach the user as an unhandled throw.** Every AI path is `try`/`catch`-wrapped end to end:

| Layer | Guard |
|---|---|
| `callOnce` / `callModel` | `throw` on any non-2xx, caught by `requestDesign` / `analysePlan`'s per-key loop |
| `requestDesign` / `analysePlan` | `throw` only after every key fails — caught by `aiPlugin.handle`'s `try` ([:100-116](../../server/aiPlugin.ts#L100-L116)) and by the `openings` handler's own `try` ([:156-174](../../server/aiPlugin.ts#L156-L174)) |
| `useDesignAI.call` | both `fetch` and `response.json()` in their own `try`; `!response.ok` handled | [useDesignAI.ts:32-58](../../src/ai/useDesignAI.ts#L32-L58) |
| `analyseBlueprint` | `toSendableJpeg` and `fetch` each in a `try`, returning a typed `{ok:false, error}` | [detectOpenings.ts:82-112](../../src/blueprint/detectOpenings.ts#L82-L112) |
| `useBlueprintStructure` | never inspects `analysis.error` beyond displaying it; the async IIFE has no rejecting path | [useBlueprintStructure.ts:68-113](../../src/blueprint/useBlueprintStructure.ts#L68-L113) |

The AI blast radius is **well contained**. The design decision to route AI output through `parseDesign` and to keep the failure path as a typed result rather than an exception is the reason.

---

## The two structural AI problems

### AI-1 — Every AI feature is dead in any deployed build `[V]`

`configureServer` is a `vite dev` hook ([aiPlugin.ts:121](../../server/aiPlugin.ts#L121)). `npm run build` emits the front end alone. In a deployed app the three `/api/ai/*` calls hit the static host and 404, so the client shows *"The server returned a malformed response."* (a 404 HTML body fails `response.json()`) rather than anything actionable. Acknowledged in-source at [:15-17](../../server/aiPlugin.ts#L15-L17) and [README.md:228-230](../../README.md#L228-L230).

### AI-2 — AI edit destroys everything except walls `[V]`

```ts
// src/ai/useDesignAI.ts:86-89
useDesignStore.getState().loadDesign({
  name: parsed.doc.name,
  walls: parsed.doc.walls,
})
```

`loadDesign` ([useDesignStore.ts:1076-1132](../../src/store/useDesignStore.ts#L1076-L1132)) applies `?? []` / `?? null` to every field it is not given:

| Field | After an AI edit |
|---|---|
| `furniture` | `[]` — **every piece deleted** |
| `roomLabels` | `[]` — **every room name deleted** |
| `stairs` | `[]` — **every staircase deleted** |
| `floors` | rebuilt as ground-floor-only + 2 empties — **the first and second floors are deleted** |
| `plot` | `null` — **the plot, setbacks and buildable check are deleted** |
| `northOffset` | `0` — **the compass is reset** |
| `plotFacing` | `'N'` — reset |
| `constructionRate` | `0` — **the cost estimate is cleared** |
| `floorMaterial` | `DEFAULT_FLOOR_MATERIAL` — reset |
| `viewEpoch` | `+1` → **`past` and `future` are cleared, so ⌘Z cannot recover any of it** |

The AI panel's only warning is *"This replaces the N walls currently in the design"* ([AIPanel.tsx:69-72](../../src/components/AIPanel.tsx#L69-L72)) — and that warning is shown for **generate**, not for **edit**. The edit control carries no warning at all.

Autosave then writes the wreckage over the named project within 4 seconds ([useAutosave.ts:99-102](../../src/persistence/useAutosave.ts#L99-L102)) — `walls` changed, so the dirty check passes.
