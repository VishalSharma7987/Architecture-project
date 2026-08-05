import { useEffect, useState } from 'react'

type Props = {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  onCommit: (value: number) => void
}

/**
 * Number input that edits live but tolerates half-typed values.
 *
 * The field keeps its own text while focused, so clearing it to type a new
 * number does not immediately push `NaN` (or a clamped 0) into the model. Valid
 * input commits on every keystroke; invalid input simply waits.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 0.1,
  unit = 'm',
  onCommit,
}: Props) {
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)

  // Track external edits (a different selection, or a clamp the store applied)
  // unless the user is mid-edit, where overwriting would fight their typing.
  useEffect(() => {
    if (!editing) setText(String(value))
  }, [value, editing])

  const handleChange = (next: string) => {
    setText(next)
    const parsed = Number.parseFloat(next)
    if (Number.isFinite(parsed)) onCommit(parsed)
  }

  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-600">{label}</span>
      <span className="relative">
        <input
          type="number"
          value={text}
          min={min}
          max={max}
          step={step}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false)
            // Snap the text back to whatever the store settled on.
            setText(String(value))
          }}
          className="w-24 rounded-md border border-slate-300 bg-white py-1 pl-2 pr-6 text-right tabular-nums text-slate-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
          {unit}
        </span>
      </span>
    </label>
  )
}
