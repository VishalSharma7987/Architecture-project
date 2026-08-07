# 01 — Project Overview

## What the software is, from the code `[V]`

A **single-page, browser-only floor-plan designer** for Indian residential architecture. One React app draws a plan in 2D on a `<canvas>` and the same model in 3D with three.js. There is no backend, no database, no accounts. `[V]` [src/App.tsx:30-153](../../src/App.tsx#L30-L153), [src/store/useDesignStore.ts:714](../../src/store/useDesignStore.ts#L714), `[X]` grep for `react-router|createBrowserRouter` → 0 hits; `package.json` has no DB driver, no auth library.

### The Indian-residential focus is explicit in the code, not inferred `[V]`

- `RoomType` includes `'pooja'` and separates `'toilet'` from `'bathroom'` — [useDesignStore.ts:51-64](../../src/store/useDesignStore.ts#L51-L64), commented *"standard on Indian residential plans, which is what this list is drawn for"*.
- Default unit is feet-and-inches: `DEFAULT_UNIT: Unit = 'ftin'` — [useDesignStore.ts:224](../../src/store/useDesignStore.ts#L224), commented *"what building drawings use across India"*.
- Cost is in **rupees per square foot**, formatted with lakh/crore grouping — [statement.ts:382-402](../../src/export/statement.ts#L382-L402), `Intl.NumberFormat('en-IN')`.
- A whole subsystem reads the plan against **Vastu Shastra** — [src/vastu/](../../src/vastu/), 791 LOC.
- Plot **setbacks** and a buildable envelope, i.e. the sanction-drawing check — [src/site/plot.ts](../../src/site/plot.ts), and the plan canvas draws violations in red at [draw.ts:624-678](../../src/plan/draw.ts#L624-L678).
- The area statement names the Indian measurement problem outright: *"In Indian practice carpet, built-up and super built-up are three different numbers with legal meaning"* — [statement.ts:23-35](../../src/export/statement.ts#L23-L35).

### Who it is for `[I]`

Inferred from UI copy and document output, not from any stated persona:
- **A designer/architect producing a deliverable** — the export menu builds a multi-page PDF drawing set with title blocks, area statement and cost sheet ([documents.ts:83-107](../../src/export/documents.ts#L83-L107)), and the Vastu panel's footer says *"you and your client decide what to follow"* ([VastuPanel.tsx:279-283](../../src/components/VastuPanel.tsx#L279-L283)).
- **A homeowner exploring** — Present mode, walkthrough with a human figure, and share-by-link are all viewer-facing ([PresentOverlay.tsx](../../src/components/PresentOverlay.tsx), [CharacterAvatar.tsx](../../src/scene/CharacterAvatar.tsx), [ShareButton.tsx](../../src/components/ShareButton.tsx)).

### The vision, as evidenced by comments `[V]`

Recurring, consistent design commitments visible in the source comments:
1. **No network dependency for rendering.** Textures are drawn procedurally to canvas rather than fetched ([palette.ts:33-35](../../src/materials/palette.ts#L33-L35)); the environment map is built from in-scene `Lightformer` planes rather than a CDN HDR ([Lighting.tsx:3-15](../../src/scene/Lighting.tsx#L3-L15)); 3D room captions use drei `<Html>` rather than `<Text>` *because troika fetches a font at runtime* ([RoomLabels.tsx:48-63](../../src/scene/RoomLabels.tsx#L48-L63)).
2. **No dependency added if it can be written.** The PDF writer is hand-rolled — *"because this project ships no PDF library and may not add one"* ([pdf.ts:1-9](../../src/export/pdf.ts#L1-L9), 975 LOC).
3. **Nothing is uploaded.** Share links carry the design in the URL **fragment**, which is never sent to a server ([shareLink.ts:3-11](../../src/persistence/shareLink.ts#L3-L11)).
4. **Honesty about uncertainty in the UI.** AI-derived scale is captioned *"Sized by best guess — no dimension was legible"* ([App.tsx:113-117](../../src/App.tsx#L113-L117)); Vastu has a `'no-rule'` status distinct from `'okay'` ([analyse.ts:26-29](../../src/vastu/analyse.ts#L26-L29)).

---

## Claimed vs implemented

### Claims in [README.md](../../README.md) that the code contradicts

| # | README claim | What the code shows | Tag |
|---|---|---|---|
| C1 | *"There is a test asserting the app makes zero external requests"* — [README.md:201](../../README.md#L201) | **No test files exist.** `find` for `*.test.*`, `*.spec.*`, `__tests__`, `vitest.config*`, `jest.config*` → 0 matches. No test runner in `package.json` scripts. | `[X]` **CONFLICT** |
| C2 | *"`walkMotion.ts` … kept separate to test"* [README.md:190](../../README.md#L190); *"`wallGeometry.ts` is kept pure and tested"* [README.md:285](../../README.md#L285) | Same — no tests exist. Both files ARE pure and testable; nothing tests them. | `[X]` **CONFLICT** |
| C3 | *"There is **no wall collision** — you can walk through walls. That is a deliberate omission"* — [README.md:138-139](../../README.md#L138-L139) | **Collision is fully implemented.** [src/scene/collision.ts](../../src/scene/collision.ts) (301 LOC) provides `wallColliders`, `resolveCollisions`, `moveWithCollisions`, `clampCameraDistance`; `ThirdPersonControls` calls `moveWithCollisions` every frame ([ThirdPersonControls.tsx:207-214](../../src/scene/ThirdPersonControls.tsx#L207-L214)). | `[V]` **CONFLICT — README is stale** |
| C4 | README documents Milestones 1–7 only | Code comments reference **Milestone 9, 12, 13** ([schema.ts:382,398,454](../../src/persistence/schema.ts#L382)) | `[V]` README ~6 milestones behind |
| C5 | *"The `AI` button needs an Anthropic API key"* — [README.md:31](../../README.md#L31) | Generate/edit run on **OpenRouter** (`anthropic/claude-sonnet-4.5` via OpenRouter's OpenAI-format endpoint) — [designAgent.ts:9-14](../../server/designAgent.ts#L9-L14). `aiPlugin` takes `_anthropicKey` and **ignores it**: *"generate/edit run on OpenRouter now, so a separate Anthropic key is no longer used"* ([aiPlugin.ts:74-81](../../server/aiPlugin.ts#L74-L81)). | `[V]` **CONFLICT** |
| C6 | README "Layout" section lists `src/` folders | Omits `blueprint/`, `vastu/`, `export/`, `rooms/`, `site/`, `units/` — 6 of 14 source folders, ~5,300 LOC, entirely undocumented | `[V]` |
| C7 | *"Saved file format: `{version, name, savedAt, settings:{viewMode}, walls}`"* — [README.md:247-250](../../README.md#L247-L250) | Actual `DesignDocument` also carries `furniture`, `rooms`, `plot`, `floors`, and **six** settings fields — [schema.ts:38-64](../../src/persistence/schema.ts#L38-L64) | `[V]` |
| C8 | *"snaps to 0.5 m grid"* — [README.md:65](../../README.md#L65) | With the default unit (`ftin`) the snap is `METRES_PER_FOOT / 2` = **0.1524 m** — [length.ts:34-37](../../src/units/length.ts#L34-L37). 0.5 m only in metric mode. | `[V]` |
| C9 | *"the AI panel still opens and reports that no key is configured"* — [README.md:39](../../README.md#L39) | True in effect, but the message names the **wrong variable**: *"add an OPENROUTER_API_KEY"* ([aiPlugin.ts:92-97](../../server/aiPlugin.ts#L92-L97)) while README says to set `ANTHROPIC_API_KEY`. | `[V]` |
| C10 | *"Shadow casting is already wired up … there is just nothing standing on it yet"* — [README.md:335](../../README.md#L335) | Furniture, stairs, door leaves and the character all set `castShadow` — [FurnitureModels](../../src/scene/FurnitureModels.tsx), [Stairs.tsx:100](../../src/scene/Stairs.tsx#L100), [DoorLeaves.tsx:126](../../src/scene/DoorLeaves.tsx#L126), [CharacterAvatar.tsx:107](../../src/scene/CharacterAvatar.tsx#L107) | `[V]` stale |

### Claims in the code's own comments that the code contradicts

| # | Comment claim | Reality | Tag |
|---|---|---|---|
| CC1 | `schema.ts:33-35`: *"Bump when the on-disk shape changes incompatibly, **and add a migration in `parseDesign`**"* | `parseDesign` contains **no migration branch**. Only a forward-rejection at [schema.ts:332-337](../../src/persistence/schema.ts#L332-L337). `DESIGN_VERSION` is still 1, so nothing is yet broken — but the mechanism does not exist. | `[V]` |
| CC2 | `openingDetector.ts:6-8`: *"this project **deliberately does not use Claude/Anthropic**"* | `designAgent.ts` MODEL is `'anthropic/claude-sonnet-4.5'` — [designAgent.ts:13](../../server/designAgent.ts#L13). The two server modules state opposite policies. | `[V]` **CONFLICT (internal)** |
| CC3 | `README.md:144`: *"`server/` — Server-only — never imported by `src/`"* | Holds. `[X]` grep `from '.*server/` inside `src/` → 0 hits. The only importer is [vite.config.ts:5](../../vite.config.ts#L5). | `[V]` claim is TRUE |

---

## What the code says it is *for* that no UI reaches

`[V]` [src/vastu/ruleset.ts:130-143](../../src/vastu/ruleset.ts#L130-L143) defines `SITE_RULES` (underground water tank, overhead tank) and [:156-161](../../src/vastu/ruleset.ts#L156-L161) defines `BRAHMASTHAN_RULE`. `[X]` grep for `SITE_RULES` and `BRAHMASTHAN_RULE` across `src/` → **the only occurrences are their own definitions**. Both are exported and unreferenced. The file's own comment acknowledges this for `SITE_RULES`: *"They drive no results"*. See [11_TECH_DEBT.md](11_TECH_DEBT.md).
