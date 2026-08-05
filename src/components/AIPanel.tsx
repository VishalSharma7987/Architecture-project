import { useState } from 'react'
import { useDesignAI } from '../ai/useDesignAI'
import { useDesignStore } from '../store/useDesignStore'

const EXAMPLE_BRIEF =
  'open-plan office for 20 people with 2 meeting rooms and a reception'

/**
 * Left-docked panel for the two AI flows: generate a plan from a brief, and
 * edit the current plan with an instruction.
 */
export function AIPanel() {
  const wallCount = useDesignStore((s) => s.walls.length)
  const setAiPanelOpen = useDesignStore((s) => s.setAiPanelOpen)

  const { status, generate, edit } = useDesignAI()
  const [brief, setBrief] = useState('')
  const [instruction, setInstruction] = useState('')

  const busy = status.kind === 'loading'

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white"
      data-testid="ai-panel"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Generate with AI</h2>
        <button
          type="button"
          onClick={() => setAiPanelOpen(false)}
          className="text-xs text-slate-400 hover:text-slate-700"
          aria-label="Close AI panel"
        >
          Close
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <section className="space-y-2">
          <label
            htmlFor="ai-brief"
            className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            Describe the space
          </label>
          <textarea
            id="ai-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={EXAMPLE_BRIEF}
            rows={4}
            disabled={busy}
            data-testid="ai-brief"
            className="w-full resize-y rounded-md border border-slate-300 px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
          />
          <button
            type="button"
            onClick={() => generate(brief)}
            disabled={busy || brief.trim().length === 0}
            data-testid="ai-generate"
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {status.kind === 'loading' && status.what === 'generate'
              ? 'Designing…'
              : 'Generate floor plan'}
          </button>
          {wallCount > 0 && (
            <p className="text-[11px] text-amber-600">
              This replaces the {wallCount} wall{wallCount === 1 ? '' : 's'}{' '}
              currently in the design.
            </p>
          )}
        </section>

        <section className="space-y-2 border-t border-slate-100 pt-4">
          <label
            htmlFor="ai-instruction"
            className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400"
          >
            Edit with AI
          </label>
          <textarea
            id="ai-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="make the reception bigger"
            rows={3}
            disabled={busy || wallCount === 0}
            data-testid="ai-instruction"
            className="w-full resize-y rounded-md border border-slate-300 px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
          />
          <button
            type="button"
            onClick={() => edit(instruction)}
            disabled={busy || wallCount === 0 || instruction.trim().length === 0}
            data-testid="ai-edit"
            className="w-full rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            {status.kind === 'loading' && status.what === 'edit'
              ? 'Applying…'
              : 'Apply edit'}
          </button>
          {wallCount === 0 && (
            <p className="text-[11px] text-slate-400">
              Draw or generate a plan first.
            </p>
          )}
        </section>

        {busy && (
          <p
            className="animate-pulse text-[11px] text-slate-500"
            data-testid="ai-loading"
          >
            Working on the layout — this usually takes 20–60 seconds.
          </p>
        )}

        {status.kind === 'error' && (
          <p
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700"
            data-testid="ai-error"
          >
            {status.message}
          </p>
        )}

        {status.kind === 'done' && (
          <div
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] leading-relaxed text-emerald-800"
            data-testid="ai-done"
          >
            <p className="font-semibold">Created {status.wallCount} walls.</p>
            {status.notes && <p className="mt-1">{status.notes}</p>}
            {status.repaired > 0 && (
              <p className="mt-1 text-emerald-700">
                {status.repaired} issue{status.repaired === 1 ? '' : 's'} in the
                output were repaired on import.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
