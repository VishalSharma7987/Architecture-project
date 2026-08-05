import { useEffect, useState } from 'react'
import type { Unit } from '../store/useDesignStore'
import { formatLength, parseLength } from '../units/length'

type Props = {
  label: string
  /** The current value, in metres. */
  metres: number
  units: Unit
  testId?: string
  /** Called with metres whenever the typed text parses to something valid. */
  onCommit: (metres: number) => void
}

/**
 * Text input for a real-world length, in whatever unit is selected.
 *
 * A plain number input cannot express `12'6"`, so this is a text field with the
 * unit parser behind it. It keeps its own text while focused — reformatting
 * mid-keystroke would fight the user, since `12'` is an invalid prefix of the
 * perfectly good `12'6"` — and only pushes a value up when the text parses.
 * Unparseable text is marked rather than silently dropped, and the real value
 * comes back when the field is left.
 */
export function LengthField({ label, metres, units, testId, onCommit }: Props) {
  const [text, setText] = useState(() => formatLength(metres, units))
  const [editing, setEditing] = useState(false)

  // While the field is not being typed into it mirrors the model, so a change
  // from anywhere else — dragging a wall, switching ft to m — shows up here.
  useEffect(() => {
    if (!editing) setText(formatLength(metres, units))
  }, [metres, units, editing])

  const parsed = parseLength(text, units)
  const invalid = editing && parsed === null && text.trim() !== ''

  return (
    <label className="mt-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-slate-600">{label}</span>
      <input
        value={text}
        data-testid={testId}
        inputMode="text"
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setText(e.target.value)
          const next = parseLength(e.target.value, units)
          if (next !== null) onCommit(next)
        }}
        onBlur={() => {
          setEditing(false)
          setText(formatLength(metres, units))
        }}
        className={`w-24 rounded-md border px-2 py-1 text-right tabular-nums outline-none focus:ring-1 ${
          invalid
            ? 'border-red-400 text-red-700 focus:border-red-500 focus:ring-red-500'
            : 'border-slate-300 text-slate-800 focus:border-blue-500 focus:ring-blue-500'
        }`}
      />
    </label>
  )
}
