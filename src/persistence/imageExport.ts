import type { FurnitureItem, Wall, RoomLabel, Unit } from '../store/useDesignStore'
import { renderPlanSheet } from '../plan/planSheet'
import { getSceneCanvas } from '../scene/canvasRegistry'
import { toFileName } from './files'

/**
 * A4 landscape at roughly 150 dpi: prints crisply at full page, and still
 * lands well under the size that makes a PNG awkward to email.
 */
export const PLAN_SHEET_SIZE = { width: 2000, height: 1414 }

export type PlanPngOptions = {
  walls: Wall[]
  furniture: FurnitureItem[]
  /** Project name — becomes both the sheet title and the file name. */
  name: string
  /** ISO date for the title block. Defaults to now. */
  date?: string
  /** Where North points, in degrees clockwise from the top of the sheet. */
  northOffset?: number
  /** Display unit for the sheet's readings. */
  units?: Unit
  /** Room names, drawn with their areas. */
  roomLabels?: RoomLabel[]
}

/** Renders the design to a PNG at print resolution and downloads it. */
export async function downloadPlanPng(options: PlanPngOptions): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width = PLAN_SHEET_SIZE.width
  canvas.height = PLAN_SHEET_SIZE.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not open a 2D canvas.')

  renderPlanSheet(ctx, {
    walls: options.walls,
    furniture: options.furniture,
    title: options.name,
    date: options.date ?? new Date().toISOString(),
    width: PLAN_SHEET_SIZE.width,
    height: PLAN_SHEET_SIZE.height,
    northOffset: options.northOffset ?? 0,
    units: options.units,
    roomLabels: options.roomLabels,
  })

  const blob = await toPngBlob(canvas)
  if (!blob) throw new Error('This browser could not encode the plan as a PNG.')

  triggerDownload(blob, toPngName(options.name))
}

/** Downloads the current 3D viewport as a PNG. */
export async function downloadViewportPng(name: string): Promise<boolean> {
  const canvas = getSceneCanvas()
  if (!canvas) return false

  const blob = await toPngBlob(canvas)
  if (!blob) return false

  triggerDownload(blob, toPngName(`${name} view`))
  return true
}

/** The project's own slug rules, with a .png tail instead of .json. */
const toPngName = (name: string) => toFileName(name).replace(/\.json$/, '.png')

const toPngBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()

  // The click starts the download asynchronously, so revoking inline can lose
  // the file in some browsers; one turn of the event loop is enough. Without
  // revoking at all, the blob is pinned for the life of the document.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
