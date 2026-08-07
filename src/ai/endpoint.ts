/**
 * Where the AI endpoints live, and whether they exist at all.
 *
 * ── The problem this solves ──────────────────────────────────────────────
 * `server/aiPlugin.ts` mounts `/api/ai/*` from Vite's `configureServer` hook,
 * which runs under `vite dev` and nowhere else. `vite build` emits the front
 * end alone. So in every deployed build the three endpoints simply are not
 * there: the browser POSTs to a static host, gets a 404 HTML page back,
 * `response.json()` throws, and the user is told "The server returned a
 * malformed response" — which is true, useless, and looks like a bug in the
 * app rather than a feature that was never deployed.
 *
 * ── Why this is resolved at build time, not by asking ────────────────────
 * A capability probe would cost a round trip on every load, would have to be
 * cached somewhere, and would still be wrong offline. The answer is known when
 * the bundle is built, so it is baked in then.
 *
 * ── THE KEY BOUNDARY ─────────────────────────────────────────────────────
 * This is the ONLY module in `src/` permitted to read `import.meta.env`, and
 * it may read only `VITE_AI_BASE_URL` and `DEV`. `endpoint.test.ts` enforces
 * both rules across the whole source tree and fails the build if either is
 * broken.
 *
 * `VITE_AI_BASE_URL` is an ADDRESS, not a credential. Vite inlines every
 * `VITE_`-prefixed variable into the client bundle, which is exactly why the
 * API keys are deliberately NOT prefixed (see `vite.config.ts`). A URL is safe
 * to publish; a key is not. Never add a second `VITE_` variable here without
 * asking which of the two it is.
 */

/** Trailing slashes are stripped so `${base}${path}` never doubles them. */
function normaliseBase(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed === '' ? null : trimmed
}

/**
 * Base URL for the AI endpoints, or `null` when there are none.
 *
 * - Under `vite dev` (and under Vitest): `''`, i.e. same-origin — the plugin
 *   middleware is mounted and `/api/ai/generate` resolves.
 * - In a production build: whatever `VITE_AI_BASE_URL` was set to at build
 *   time, or `null` when it was not set — which is the honest default, because
 *   `npm run build` on its own ships no backend.
 */
export const AI_BASE_URL: string | null = import.meta.env.DEV
  ? ''
  : normaliseBase(import.meta.env.VITE_AI_BASE_URL)

/** Whether any AI feature can work at all in this build. */
export const isAiConfigured = (): boolean => AI_BASE_URL !== null

/**
 * The one sentence every AI surface shows when there is no backend.
 *
 * Deliberately explains the situation rather than reporting a failure: nothing
 * is broken, the feature was not deployed, and no amount of retrying will
 * change that.
 */
export const AI_UNAVAILABLE_MESSAGE =
  'AI features need a server and this build does not have one. Everything ' +
  'else — drawing, detection, measurement, export — works as normal.'

/** Thrown instead of a fetch when there is nowhere to send the request. */
export class AiUnavailableError extends Error {
  constructor() {
    super(AI_UNAVAILABLE_MESSAGE)
    this.name = 'AiUnavailableError'
  }
}

/**
 * Request timeouts, in milliseconds.
 *
 * There were none. A hung upstream left the panel spinning forever with no way
 * out but a reload — and OpenRouter routing to a cold model can hang for
 * minutes. These are generous rather than tight: the AI panel already tells
 * the user a plan "usually takes 20-60 seconds", so cutting a slow-but-working
 * generation off at 30s would break the feature to fix the hang.
 */
export const AI_TIMEOUT_MS = {
  /** A whole floor plan at 6000 max_tokens. */
  design: 120_000,
  /** One vision read at 1200 max_tokens, retried up to 2x per key server-side. */
  vision: 90_000,
} as const

/**
 * POSTs JSON to an AI endpoint, with a timeout and an unavailable-guard.
 *
 * Returns the raw `Response` so each caller keeps its own error vocabulary —
 * `useDesignAI` and `detectOpenings` report failures in different words to
 * different panels, and flattening that here would make both worse.
 */
export async function aiFetch(
  path: `/${string}`,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  if (AI_BASE_URL === null) throw new AiUnavailableError()

  // `AbortSignal.timeout` would be shorter, but it is unsupported in enough
  // still-current browsers that the explicit controller is worth the lines.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(`${AI_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** True when a caught error is this request having run out of time. */
export const isTimeout = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'
