import type { Connect, Plugin } from 'vite'
import type { ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import { editDesign, generateDesign } from './designAgent.ts'
import { analysePlan } from './openingDetector.ts'

/**
 * Dev-server API for the AI features.
 *
 * The browser calls `/api/ai/*`; this middleware makes the Anthropic call from
 * Node using a key read from the environment. The key is never sent to the
 * client and never appears in the bundle — which is the whole point of putting
 * the call behind an endpoint instead of calling the API from React.
 *
 * NOTE: this covers `vite dev` only. A production deployment needs the same
 * two endpoints on a real server; `npm run build` ships the front end alone.
 */

const MAX_BODY_BYTES = 1_000_000

// A design is a few KB, but a blueprint image sent for opening detection is a
// downscaled JPEG — larger, so its endpoint gets its own ceiling.
const MAX_IMAGE_BODY_BYTES = 8_000_000

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(payload)
}

function readBody(
  req: Connect.IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('Request body too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Turns SDK and validation failures into a message worth showing a user. */
function describeError(error: unknown): { status: number; message: string } {
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 502, message: 'The API key was rejected. Check ANTHROPIC_API_KEY.' }
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { status: 429, message: 'Rate limited by the API. Wait a moment and retry.' }
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { status: 504, message: 'Could not reach the API. Check your connection.' }
  }
  if (error instanceof Anthropic.APIError) {
    return { status: 502, message: `API error: ${error.message}` }
  }
  return {
    status: 500,
    message: error instanceof Error ? error.message : 'Unknown error.',
  }
}

export function aiPlugin(
  // Kept for signature stability with vite.config; generate/edit run on
  // OpenRouter now, so a separate Anthropic key is no longer used.
  _anthropicKey: string | undefined,
  openRouterKeys: string[],
): Plugin {
  // Every AI feature runs on OpenRouter, across however many keys are set.
  const detectionKeys = openRouterKeys.filter((k) => k && k.trim())

  const handle = async (
    req: Connect.IncomingMessage,
    res: ServerResponse,
    run: (keys: string[], body: Record<string, unknown>) => Promise<unknown>,
  ) => {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'Use POST.' })
      return
    }
    if (detectionKeys.length === 0) {
      json(res, 503, {
        error:
          'No API key configured. Copy .env.example to .env, add an OPENROUTER_API_KEY, and restart the dev server.',
      })
      return
    }

    try {
      const raw = await readBody(req)
      let body: Record<string, unknown>
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        json(res, 400, { error: 'Request body was not valid JSON.' })
        return
      }

      json(res, 200, await run(detectionKeys, body))
    } catch (error) {
      const { status, message } = describeError(error)
      // Server-side log keeps the full error; the client gets the summary.
      console.error('[ai]', error)
      json(res, status, { error: message })
    }
  }

  return {
    name: 'space-design-ai',
    configureServer(server) {
      server.middlewares.use('/api/ai/generate', (req, res) =>
        handle(req, res, (keys, body) => {
          const brief = typeof body.brief === 'string' ? body.brief.trim() : ''
          if (!brief) throw new Error('Describe what you want before generating.')
          return generateDesign(keys, brief)
        }),
      )

      server.middlewares.use('/api/ai/edit', (req, res) =>
        handle(req, res, (keys, body) => {
          const instruction =
            typeof body.instruction === 'string' ? body.instruction.trim() : ''
          if (!instruction) throw new Error('Describe the change you want.')
          if (!body.design) throw new Error('No current design was sent.')
          return editDesign(keys, body.design, instruction)
        }),
      )

      // Vision detection uses raw OpenRouter keys, not the Anthropic SDK client
      // (see openingDetector), and accepts a much larger body because it carries
      // an image — so it does not go through `handle`.
      server.middlewares.use('/api/ai/openings', (req, res) => {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'Use POST.' })
          return
        }
        if (detectionKeys.length === 0) {
          json(res, 503, {
            error:
              'No detection key configured. Copy .env.example to .env, add an OPENROUTER_API_KEY, and restart the dev server.',
          })
          return
        }
        void (async () => {
          try {
            const raw = await readBody(req, MAX_IMAGE_BODY_BYTES)
            let body: Record<string, unknown>
            try {
              body = JSON.parse(raw || '{}')
            } catch {
              json(res, 400, { error: 'Request body was not valid JSON.' })
              return
            }
            const image = typeof body.image === 'string' ? body.image : ''
            if (!image.startsWith('data:image/')) {
              throw new Error('No blueprint image was sent.')
            }
            json(res, 200, await analysePlan(detectionKeys, image))
          } catch (error) {
            const { status, message } = describeError(error)
            console.error('[ai:openings]', error)
            json(res, status, { error: message })
          }
        })()
      })
    },
  }
}
