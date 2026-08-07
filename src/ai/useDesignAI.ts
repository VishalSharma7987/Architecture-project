import { useCallback, useState } from 'react'
import { useDesignStore } from '../store/useDesignStore'
import { DESIGN_VERSION, parseDesign } from '../persistence/schema'
import {
  AI_TIMEOUT_MS,
  AI_UNAVAILABLE_MESSAGE,
  AiUnavailableError,
  aiFetch,
  isTimeout,
} from './endpoint'

export type AIStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; what: 'generate' | 'edit' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; notes: string; wallCount: number; repaired: number }

type Payload = { brief: string } | { instruction: string; design: unknown }

/**
 * Drives the two AI endpoints and loads their results into the store.
 *
 * The model's output is treated as untrusted and goes through the same
 * `parseDesign` validator as an imported file — structured outputs guarantee
 * the JSON *shape*, but nothing guarantees the geometry is sane, and a
 * hallucinated wall should never reach the renderer unchecked.
 */
export function useDesignAI() {
  const [status, setStatus] = useState<AIStatus>({ kind: 'idle' })

  const call = useCallback(
    async (
      endpoint: 'generate' | 'edit',
      payload: Payload,
      fallbackName: string,
    ) => {
      setStatus({ kind: 'loading', what: endpoint })

      let response: Response
      try {
        response = await aiFetch(`/api/ai/${endpoint}`, payload, AI_TIMEOUT_MS.design)
      } catch (error) {
        // Three genuinely different situations, which used to collapse into
        // one misleading sentence about the dev server.
        setStatus({
          kind: 'error',
          message:
            error instanceof AiUnavailableError
              ? AI_UNAVAILABLE_MESSAGE
              : isTimeout(error)
                ? 'The model took too long and the request was cancelled. ' +
                  'Try a shorter brief.'
                : 'Could not reach the server. Check your connection.',
        })
        return
      }

      let body: { error?: string; name?: string; notes?: string; walls?: unknown }
      try {
        body = await response.json()
      } catch {
        setStatus({ kind: 'error', message: 'The server returned a malformed response.' })
        return
      }

      if (!response.ok) {
        setStatus({ kind: 'error', message: body.error ?? 'The request failed.' })
        return
      }

      // Wrap the model's output as a design document so the existing validator
      // can check it — same path as Import JSON.
      const parsed = parseDesign({
        version: DESIGN_VERSION,
        name: body.name ?? fallbackName,
        savedAt: new Date().toISOString(),
        settings: { viewMode: useDesignStore.getState().viewMode },
        walls: body.walls,
      })

      if (!parsed.ok) {
        setStatus({
          kind: 'error',
          message: `The generated plan was not usable: ${parsed.error}`,
        })
        return
      }

      if (parsed.doc.walls.length === 0) {
        setStatus({
          kind: 'error',
          message: 'The model returned a plan with no walls. Try rewording the brief.',
        })
        return
      }

      // `replaceWalls`, NOT `loadDesign`. `loadDesign` defaults every field it
      // is not handed, so passing it walls alone deleted the furniture, the
      // room names, the stairs, the plot, the north rotation, the construction
      // rate, the floor finish and both upper storeys — and then bumped the
      // history epoch, so none of it could be undone. The model is only ever
      // shown walls and can only return walls; everything else is the user's
      // and is none of its business.
      useDesignStore.getState().replaceWalls(parsed.doc.walls, parsed.doc.name)

      setStatus({
        kind: 'done',
        notes: body.notes ?? '',
        wallCount: parsed.doc.walls.length,
        repaired: parsed.warnings.length,
      })
    },
    [],
  )

  const generate = useCallback(
    (brief: string) => call('generate', { brief }, 'Generated plan'),
    [call],
  )

  const edit = useCallback(
    (instruction: string) => {
      const { walls, projectName } = useDesignStore.getState()
      // Ids are internal bookkeeping; sending them wastes tokens and invites
      // the model to echo stale ones back.
      const design = {
        name: projectName ?? 'Untitled',
        walls: walls.map(({ id: _id, openings, ...wall }) => ({
          ...wall,
          openings: openings.map(({ id: _openingId, ...opening }) => opening),
        })),
      }
      return call('edit', { instruction, design }, projectName ?? 'Edited plan')
    },
    [call],
  )

  const reset = useCallback(() => setStatus({ kind: 'idle' }), [])

  return { status, generate, edit, reset }
}
