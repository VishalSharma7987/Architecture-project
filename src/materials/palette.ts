import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

export type MaterialId =
  | 'white-paint'
  | 'warm-plaster'
  | 'sage'
  | 'brick'
  | 'concrete'
  | 'oak'
  | 'walnut'
  | 'polished-concrete'
  | 'tile'

export type Surface = 'wall' | 'floor'

export type MaterialDef = {
  id: MaterialId
  label: string
  /** Base colour, also used for the palette swatch and the 2D plan. */
  color: string
  roughness: number
  metalness: number
  surfaces: Surface[]
  /**
   * Edge length in metres that one tile of the pattern covers. Textures are
   * tiled per-surface against real dimensions, so a 6 m wall shows twice the
   * brick courses of a 3 m wall instead of stretching the same image.
   */
  tileMetres?: number
  pattern?: (ctx: CanvasRenderingContext2D, size: number) => void
}

/* ---------- procedural patterns ---------------------------------------- */
/* Drawn to a canvas at load time rather than shipped as image files: no
 * binary assets, no network fetch, and the app stays fully self-contained. */

function brickPattern(ctx: CanvasRenderingContext2D, size: number) {
  const rows = 8
  const h = size / rows
  const w = size / 4

  ctx.fillStyle = '#8d5f4c'
  ctx.fillRect(0, 0, size, size)

  for (let row = 0; row < rows; row++) {
    // Every other course is offset by half a brick — a running bond.
    const offset = row % 2 === 0 ? 0 : -w / 2
    for (let col = -1; col <= 4; col++) {
      const x = col * w + offset
      const y = row * h
      // Slight per-brick variation, or the wall reads as printed wallpaper.
      const shade = 0.88 + ((row * 7 + col * 13) % 5) * 0.05
      ctx.fillStyle = `rgb(${Math.round(166 * shade)}, ${Math.round(108 * shade)}, ${Math.round(86 * shade)})`
      ctx.fillRect(x + 1.5, y + 1.5, w - 3, h - 3)
    }
  }
}

function concretePattern(ctx: CanvasRenderingContext2D, size: number) {
  ctx.fillStyle = '#b8b6b2'
  ctx.fillRect(0, 0, size, size)

  // Fine mottling. Deterministic so the texture is identical every session.
  let seed = 1
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < 4000; i++) {
    const v = 150 + Math.floor(rand() * 55)
    ctx.fillStyle = `rgba(${v}, ${v - 2}, ${v - 6}, 0.35)`
    ctx.fillRect(rand() * size, rand() * size, 2.5, 2.5)
  }
}

function plankPattern(base: string, grain: string, seam: string) {
  return (ctx: CanvasRenderingContext2D, size: number) => {
    const planks = 5
    const h = size / planks

    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)

    let seed = 7
    const rand = () => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }

    for (let p = 0; p < planks; p++) {
      const y = p * h
      // Grain runs along the plank.
      ctx.strokeStyle = grain
      ctx.lineWidth = 1
      for (let g = 0; g < 14; g++) {
        const gy = y + rand() * h
        ctx.globalAlpha = 0.12 + rand() * 0.18
        ctx.beginPath()
        ctx.moveTo(0, gy)
        ctx.bezierCurveTo(size * 0.3, gy + (rand() - 0.5) * 5, size * 0.7, gy + (rand() - 0.5) * 5, size, gy)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      // Seam between courses.
      ctx.fillStyle = seam
      ctx.fillRect(0, y, size, 1.5)
    }
  }
}

function tilePattern(ctx: CanvasRenderingContext2D, size: number) {
  const n = 4
  const s = size / n
  ctx.fillStyle = '#c9ccce'
  ctx.fillRect(0, 0, size, size)
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#e9ebec' : '#dfe2e4'
      ctx.fillRect(x * s + 2, y * s + 2, s - 4, s - 4)
    }
  }
}

/* ---------- the palette ------------------------------------------------- */

export const MATERIALS: MaterialDef[] = [
  {
    id: 'white-paint',
    label: 'White paint',
    color: '#eceef1',
    roughness: 0.92,
    metalness: 0,
    surfaces: ['wall'],
  },
  {
    id: 'warm-plaster',
    label: 'Warm plaster',
    color: '#e6ded2',
    roughness: 0.95,
    metalness: 0,
    surfaces: ['wall'],
  },
  {
    id: 'sage',
    label: 'Sage',
    color: '#b8c4b4',
    roughness: 0.9,
    metalness: 0,
    surfaces: ['wall'],
  },
  {
    id: 'brick',
    label: 'Brick',
    color: '#a66c56',
    roughness: 0.95,
    metalness: 0,
    surfaces: ['wall'],
    tileMetres: 1.6,
    pattern: brickPattern,
  },
  {
    id: 'concrete',
    label: 'Concrete',
    color: '#b8b6b2',
    roughness: 0.88,
    metalness: 0,
    surfaces: ['wall', 'floor'],
    tileMetres: 2.4,
    pattern: concretePattern,
  },
  {
    id: 'oak',
    label: 'Oak floor',
    color: '#c69963',
    roughness: 0.62,
    metalness: 0,
    surfaces: ['floor'],
    tileMetres: 2,
    pattern: plankPattern('#c69963', '#8a6437', '#a67c48'),
  },
  {
    id: 'walnut',
    label: 'Walnut floor',
    color: '#8a5f42',
    roughness: 0.55,
    metalness: 0,
    surfaces: ['floor'],
    tileMetres: 2,
    pattern: plankPattern('#8a5f42', '#4f3320', '#6d4a33'),
  },
  {
    id: 'polished-concrete',
    label: 'Polished concrete',
    color: '#c2c3c4',
    roughness: 0.35,
    metalness: 0.05,
    surfaces: ['floor'],
    tileMetres: 3,
    pattern: concretePattern,
  },
  {
    id: 'tile',
    label: 'Tile',
    color: '#dfe2e4',
    roughness: 0.4,
    metalness: 0,
    surfaces: ['floor'],
    tileMetres: 1.2,
    pattern: tilePattern,
  },
]

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]))

export const DEFAULT_WALL_MATERIAL: MaterialId = 'white-paint'
export const DEFAULT_FLOOR_MATERIAL: MaterialId = 'oak'

export const isMaterialId = (value: unknown): value is MaterialId =>
  typeof value === 'string' && BY_ID.has(value as MaterialId)

export function getMaterial(id: MaterialId | undefined, fallback: MaterialId): MaterialDef {
  return BY_ID.get(id ?? fallback) ?? BY_ID.get(fallback)!
}

export const materialsFor = (surface: Surface) =>
  MATERIALS.filter((m) => m.surfaces.includes(surface))

/* ---------- texture cache ---------------------------------------------- */

const TEXTURE_SIZE = 512
const cache = new Map<MaterialId, Texture>()

/**
 * The base texture for a material, drawn once and shared.
 *
 * Callers that need real-world tiling clone this and set `repeat` — clones
 * share the underlying image, so per-surface tiling costs almost nothing.
 */
export function baseTexture(def: MaterialDef): Texture | null {
  if (!def.pattern) return null

  const cached = cache.get(def.id)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_SIZE
  canvas.height = TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  def.pattern(ctx, TEXTURE_SIZE)

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  // Pattern canvases hold colour, not data, so they must be read as sRGB.
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8

  cache.set(def.id, texture)
  return texture
}

/** A clone tiled to cover `width` x `height` metres at the material's scale. */
export function tiledTexture(
  def: MaterialDef,
  width: number,
  height: number,
): Texture | null {
  const base = baseTexture(def)
  if (!base) return null

  const tile = def.tileMetres ?? 1
  const texture = base.clone()
  texture.needsUpdate = true
  texture.repeat.set(Math.max(0.25, width / tile), Math.max(0.25, height / tile))
  return texture
}
