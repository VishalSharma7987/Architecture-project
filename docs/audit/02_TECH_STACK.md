# 02 — Tech Stack

Every entry below is from [package.json](../../package.json) `[V]`. "Actually used for" is what the code does with it, verified by reading the import sites — not what the library is for in general.

## Runtime dependencies (7)

| Package | Version | Actually used for | Evidence |
|---|---|---|---|
| `react` | ^19.2.7 | UI. Hooks only — no class components except one error boundary. | [CharacterAvatar.tsx:190-201](../../src/scene/CharacterAvatar.tsx#L190-L201) is the sole `Component` subclass `[V]` |
| `react-dom` | ^19.2.7 | `createRoot` + `createPortal`. The portal is used once, for the Panels dropdown, to escape a toolbar `overflow-x:auto` clipping container. | [main.tsx:6](../../src/main.tsx#L6), [Toolbar.tsx:634-661](../../src/components/Toolbar.tsx#L634-L661) `[V]` |
| `zustand` | ^5.0.14 | **The entire application state.** One store, no middleware — not `persist`, not `immer`, not `devtools`. Undo/redo is a hand-written `store.subscribe` listener, not a middleware. | [useDesignStore.ts:714](../../src/store/useDesignStore.ts#L714), recorder at [:1282-1328](../../src/store/useDesignStore.ts#L1282-L1328) `[V]` |
| `three` | ^0.185.1 | 3D geometry and materials. Used **directly** for `BoxGeometry`, `MeshStandardMaterial`, `Raycaster`, `Plane`, `Vector2/3`, `Quaternion`, `Box3`, `CanvasTexture`, `AnimationClip`, `NoToneMapping`. | [Walls.tsx:3](../../src/scene/Walls.tsx#L3), [SceneCanvas.tsx:3](../../src/scene/SceneCanvas.tsx#L3), [palette.ts:1](../../src/materials/palette.ts#L1) `[V]` |
| `@react-three/fiber` | ^9.6.1 | `<Canvas>`, `useFrame`, `useThree`, `ThreeEvent` pointer events. | [SceneCanvas.tsx:2](../../src/scene/SceneCanvas.tsx#L2) `[V]` |
| `@react-three/drei` | ^10.7.7 | `OrbitControls`, `PointerLockControls`, `Grid`, `Html`, `Environment`, `Lightformer`, `useGLTF`, `useFBX`, `useAnimations`. | [Controls.tsx:1](../../src/scene/Controls.tsx#L1), [Ground.tsx:1](../../src/scene/Ground.tsx#L1), [Lighting.tsx:1](../../src/scene/Lighting.tsx#L1), [CharacterAvatar.tsx:4](../../src/scene/CharacterAvatar.tsx#L4) `[V]` |
| `@anthropic-ai/sdk` | ^0.112.4 | **Error-class matching only.** `Anthropic.AuthenticationError`, `RateLimitError`, `APIConnectionError`, `APIError` in one `instanceof` chain. **No Anthropic client is ever constructed and no request is made through the SDK.** | [aiPlugin.ts:3,55-72](../../server/aiPlugin.ts#L55-L72); `[X]` grep `new Anthropic` → 0 hits |

### `three-stdlib` — an undeclared dependency `[V]`

```
src/scene/CharacterAvatar.tsx:6   import { SkeletonUtils } from 'three-stdlib'
src/scene/FrameBuilding.tsx:3     import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
```

`three-stdlib` appears in **neither** `dependencies` nor `devDependencies` `[V]`. It resolves today because `@react-three/drei` depends on it, so it is hoisted into `node_modules`. This is a transitive dependency imported directly. `[U]` Whether it currently resolves at build time was not verified — `npm run build` was not run (audit constraint 6); `ls node_modules/three-stdlib` would confirm the hoist.

## Dev dependencies (10)

| Package | Version | Actually used for | Note |
|---|---|---|---|
| `vite` | ^8.1.1 | Dev server and bundler. **Also hosts the entire backend** — see below. | `[V]` [vite.config.ts:22-36](../../vite.config.ts#L22-L36) |
| `@vitejs/plugin-react` | ^6.0.3 | React fast refresh / JSX transform | `[V]` |
| `typescript` | ~6.0.2 | `tsc -b` typecheck in the build script | `[V]` |
| `tailwindcss` + `@tailwindcss/vite` | ^4.3.3 | All styling. Utility classes inline; `src/index.css` is 23 lines. | `[V]` |
| `oxlint` | ^1.71.0 | Lint. Config enables **two rules only**: `react/rules-of-hooks` (error) and `react/only-export-components` (warn). | `[V]` [.oxlintrc.json](../../.oxlintrc.json) |
| `@types/node`, `@types/react`, `@types/react-dom`, `@types/three` | — | Types | `[V]` |

### There is no test framework `[X]`

`package.json` has no `test` script and no test dependency. `find` for `*.test.*`, `*.spec.*`, `__tests__`, `vitest.config*`, `jest.config*`, `playwright.config*` returns nothing.

Note: **121 `data-testid` attributes (100 distinct values)** exist across the components (e.g. `blueprint-apply-scale`, `vastu-score`, `export-pdf`, `wall-length-input`) `[V]` — `grep -c 'data-testid' src/**/*.tsx`. They were written for a test suite that is not in this repository. `[I]` The density and specificity suggest a suite existed and was removed or never committed; nothing in the repo confirms which.

---

## The backend is a Vite plugin `[V]`

The three `/api/ai/*` endpoints exist **only** inside `configureServer` of a Vite plugin:

```ts
// server/aiPlugin.ts:119-177
return {
  name: 'space-design-ai',
  configureServer(server) {
    server.middlewares.use('/api/ai/generate', ...)
    server.middlewares.use('/api/ai/edit',     ...)
    server.middlewares.use('/api/ai/openings', ...)
  },
}
```

`configureServer` runs for `vite dev` only. `vite build` emits static assets; `vite preview` serves them without the plugin's middleware. The code says so itself: *"NOTE: this covers `vite dev` only. A production deployment needs the same two endpoints on a real server"* — [aiPlugin.ts:15-17](../../server/aiPlugin.ts#L15-L17). Consequence traced in [09_AI_INVENTORY.md](09_AI_INVENTORY.md) and [10_KNOWN_ISSUES.md](10_KNOWN_ISSUES.md).

---

## External services reached at runtime `[V]`

| Host | From | Purpose | Auth |
|---|---|---|---|
| `https://openrouter.ai/api/v1/chat/completions` | [designAgent.ts:14](../../server/designAgent.ts#L14) | Plan generate / edit, model `anthropic/claude-sonnet-4.5` | `Bearer` OpenRouter key |
| `https://openrouter.ai/api/v1/chat/completions` | [openingDetector.ts:16](../../server/openingDetector.ts#L16) | Vision read of a blueprint, model `google/gemma-4-26b-a4b-it:free` | `Bearer` OpenRouter key |

Both are **server-side `fetch` from the Node process**. `[X]` The browser never contacts either host — grep for `openrouter` under `src/` → 0 hits. The client only calls same-origin `/api/ai/*` ([useDesignAI.ts:34](../../src/ai/useDesignAI.ts#L34), [detectOpenings.ts:90](../../src/blueprint/detectOpenings.ts#L90)).

`[X]` **No other network calls exist anywhere.** grep for `fetch(`, `XMLHttpRequest`, `axios`, `WebSocket`, `EventSource` across `src/` returns only the two `/api/ai/*` calls above. This is consistent with the README's zero-external-request claim (C1) even though the test that asserted it does not exist.

---

## Q12 — Dependency risk

### Licence risk `[V]`

| Package | Licence | Risk |
|---|---|---|
| react, react-dom, three, zustand, vite, typescript, tailwindcss, oxlint, @anthropic-ai/sdk | MIT / Apache-2.0 (permissive) | **None** |
| @react-three/fiber, @react-three/drei, three-stdlib | MIT | **None** |

`[X]` **No GPL, AGPL, or commercially-licensed dependency exists.** There is **no DWG library at all** (see below), so the usual DWG licence trap — ODA Teigha / RealDWG — is entirely absent. This is the cleanest possible licence position for a CAD-adjacent product.

### Absent categories a CAD tool would normally carry `[X]`

Searched `package.json` and all imports:

| Category | Would expect | Present? |
|---|---|---|
| PDF generation | `pdf-lib`, `jspdf`, `pdfkit` | **No** — hand-written, [export/pdf.ts](../../src/export/pdf.ts) 975 LOC |
| PDF *parsing* | `pdf.js` | **No** — PDF import does not exist |
| DXF | `dxf-parser`, `dxf-writer` | **No** |
| DWG | ODA/Teigha, `libredwg` | **No** |
| Computer vision | `opencv.js`, `jsfeat` | **No** — hand-written Otsu + band detection, [blueprint/detectWalls.ts](../../src/blueprint/detectWalls.ts) 851 LOC |
| OCR | `tesseract.js` | **No** — dimension reading is delegated to the vision LLM |
| Geometry / CSG | `three-bvh-csg`, `clipper-lib`, `martinez`, `polybooljs` | **No** — hand-written Sutherland-Hodgman ([analyse.ts:349-387](../../src/vastu/analyse.ts#L349-L387)), planar face traversal ([plan/rooms.ts:202-251](../../src/plan/rooms.ts#L202-L251)), crossing-number PIP ([resolve.ts:118-130](../../src/rooms/resolve.ts#L118-L130)) |
| Compression | `pako`, `fflate` | **No** — native `CompressionStream` ([shareLink.ts:28-31](../../src/persistence/shareLink.ts#L28-L31)) |
| Validation | `zod`, `yup`, `valibot` | **No** — hand-written validator, [schema.ts:106-499](../../src/persistence/schema.ts#L106-L499) |
| Router | `react-router` | **No** — single screen |
| Testing | anything | **No** |

**The risk is not what is in the tree; it is how much is hand-written.** ~4,900 LOC of load-bearing algorithmic code (PDF writer, CV pipeline, polygon algebra, JSON validator) exists with **zero test coverage** `[V]`.

### Unusual / notable

- `three@0.185` is pinned via `^0.185.1`. three.js does not follow semver on minor bumps; `@react-three/drei@10.7` and `@types/three@0.185` must move with it. `[I]` inferred from the ecosystem's convention and from a comment already recording one such break: *"drei's `<SoftShadows>` PCSS patch is not compatible with three 0.185 — it injects GLSL calling `unpackRGBAToDepth`, which no longer compiles"* ([Lighting.tsx:20-25](../../src/scene/Lighting.tsx#L20-L25)) `[V]`.
- `typescript@~6.0.2` and `vite@^8.1.1` are both major versions ahead of what most tooling targets. `[U]` Whether every plugin in the tree supports them was not verified — the build was not run.
- `@anthropic-ai/sdk` is a **dead-weight runtime dependency**: it is imported for four `instanceof` checks that can now only fire if the SDK is used, which it no longer is. Its errors can never be thrown by the OpenRouter `fetch` path. See [11_TECH_DEBT.md](11_TECH_DEBT.md).

### Binary assets in the repo `[V]`

| Path | Size | Licence status |
|---|---|---|
| `public/character.glb` | 1.18 MB | `[U]` **Unknown.** The comment calls it a *"skinned construction-worker mesh"* on a *"Mixamo skeleton"* ([CharacterAvatar.tsx:10-20](../../src/scene/CharacterAvatar.tsx#L10-L20)). No licence file accompanies it. |
| `public/animations/Walking.fbx` | 822 KB | `[U]` **Unknown.** Comment says *"Mixamo FBX clips"*. Mixamo assets carry Adobe's own terms. No licence file. |
| `public/animations/Idle.fbx` | 1.50 MB | `[U]` Same |
| Repo-root: `textures.zip` (686 KB), `usd.usdc` (680 KB), `stl.stl` (482 KB), `animations.zip`, `glb.glb`, `fbx.fbx`, `obj.obj`+`obj.mtl`, `dae.dae`, `blender(construction+worker).blend`, `blueborder.webp` | ~4 MB total | `[U]` Provenance unknown. **None are imported by any source file** — `[X]` grep for each filename across `src/` → 0 hits. They are staged for commit and appear to be working files. |

**Flagged:** the only licence exposure in this project is in the **3D character assets**, not in the npm tree. It is unresolved from the repository alone.
