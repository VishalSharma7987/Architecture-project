export type FurnitureType =
  | 'table'
  | 'chair'
  | 'sofa'
  | 'desk'
  | 'bed'
  | 'kitchen-counter'
  | 'toilet'

export type FurnitureDef = {
  type: FurnitureType
  label: string
  /** Footprint in metres, used for 2D plan symbols and drop previews. */
  width: number
  depth: number
  height: number
}

export const FURNITURE: FurnitureDef[] = [
  { type: 'table', label: 'Table', width: 1.6, depth: 0.9, height: 0.75 },
  { type: 'chair', label: 'Chair', width: 0.5, depth: 0.52, height: 0.85 },
  { type: 'sofa', label: 'Sofa', width: 2.0, depth: 0.9, height: 0.8 },
  { type: 'desk', label: 'Desk', width: 1.4, depth: 0.7, height: 0.74 },
  { type: 'bed', label: 'Bed', width: 1.6, depth: 2.0, height: 0.5 },
  // A standard base run: 2.4 m long, 600 mm deep, worktop at 900 mm. Its back
  // (local -z) carries the splashback, so it seats against a wall like a bed's
  // headboard does.
  {
    type: 'kitchen-counter',
    label: 'Kitchen counter',
    width: 2.4,
    depth: 0.6,
    height: 0.9,
  },
  // A WC: the cistern (local -z) meets the wall like a bed's headboard, the
  // bowl faces into the room. Sized to a real toilet so it marks a bathroom
  // at a glance.
  { type: 'toilet', label: 'Toilet', width: 0.42, depth: 0.68, height: 0.78 },
]

const BY_TYPE = new Map(FURNITURE.map((f) => [f.type, f]))

export const isFurnitureType = (value: unknown): value is FurnitureType =>
  typeof value === 'string' && BY_TYPE.has(value as FurnitureType)

export const getFurniture = (type: FurnitureType): FurnitureDef =>
  BY_TYPE.get(type) ?? FURNITURE[0]

/**
 * A placed piece's actual footprint: its own width/depth overrides when it has
 * them, otherwise the catalogue default for its type. Height always comes from
 * the catalogue — only the floor footprint is resizable. One source of truth so
 * the 3D model, the plan symbol and the inspector all agree on the size.
 */
export function furnitureSize(item: {
  type: FurnitureType
  width?: number
  depth?: number
}): { width: number; depth: number; height: number } {
  const def = getFurniture(item.type)
  return {
    width: item.width ?? def.width,
    depth: item.depth ?? def.depth,
    height: def.height,
  }
}

/** Shared finishes so the pieces read as one set rather than five unrelated props. */
export const FURNITURE_COLORS = {
  wood: '#a4784b',
  darkWood: '#6f4f33',
  fabric: '#8f97a6',
  lightFabric: '#c3c8d1',
  metal: '#8c9096',
  /** Kitchen: pale cabinet carcass, dark stone worktop, near-black appliances. */
  cabinet: '#e7e2d8',
  stone: '#3f4650',
  appliance: '#23272e',
  /** Sanitaryware white. */
  porcelain: '#f3f5f7',
}
