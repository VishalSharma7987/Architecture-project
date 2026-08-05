import { materialsFor, type MaterialId, type Surface } from '../materials/palette'

type Props = {
  surface: Surface
  value: MaterialId
  onChange: (id: MaterialId) => void
  testId?: string
}

/** Swatch grid for choosing a finish. */
export function MaterialPicker({ surface, value, onChange, testId }: Props) {
  return (
    <div className="grid grid-cols-2 gap-1.5" data-testid={testId}>
      {materialsFor(surface).map((material) => {
        const active = material.id === value
        return (
          <button
            key={material.id}
            type="button"
            onClick={() => onChange(material.id)}
            aria-pressed={active}
            data-testid={`material-${material.id}`}
            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
              active
                ? 'border-blue-500 bg-blue-50 text-slate-900 ring-1 ring-blue-500'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span
              className="h-5 w-5 shrink-0 rounded border border-black/10"
              style={{ backgroundColor: material.color }}
              aria-hidden
            />
            <span className="truncate">{material.label}</span>
          </button>
        )
      })}
    </div>
  )
}
