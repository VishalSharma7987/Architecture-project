import {
  DEFAULT_FACING,
  DEFAULT_UNIT,
  emptyFloor,
  useDesignStore,
  type FloorData,
  type FurnitureItem,
  type Plot,
  type RoomLabel,
  type Stair,
  type Wall,
} from '../store/useDesignStore'
import { DEFAULT_FLOOR_MATERIAL, DEFAULT_WALL_MATERIAL } from '../materials/palette'

/**
 * Shared fixtures for the store-level suites.
 *
 * The store is a module singleton, so every test has to put it back or the
 * order tests run in starts to matter. `resetStore` is the only supported way
 * to do that: it writes every field, including the ones `newDesign` leaves
 * alone (units, rate, north, blueprint, readOnly), and bumps `historyEpoch` in
 * the same write so the undo recorder adopts the result as a clean baseline
 * rather than logging the reset itself as an undoable edit.
 */

/** A closed 4 m x 3 m rectangle on the wall centrelines. */
export function rectangleWalls(width = 4, depth = 3): Wall[] {
  const corners = [
    { x: 0, z: 0 },
    { x: width, z: 0 },
    { x: width, z: depth },
    { x: 0, z: depth },
  ]
  return corners.map((start, i) => ({
    id: `wall-${i}`,
    start,
    end: corners[(i + 1) % corners.length],
    height: 3,
    thickness: 0.2,
    openings: [],
    material: DEFAULT_WALL_MATERIAL,
  }))
}

export function resetStore(): void {
  const state = useDesignStore.getState()
  useDesignStore.setState({
    viewMode: '2d',
    walkMode: false,
    walkView: 'third',
    tool: 'wall',
    selection: null,
    floors: [emptyFloor(0), emptyFloor(1), emptyFloor(2)],
    activeFloor: 0,
    walls: [],
    furniture: [],
    roomLabels: [],
    stairs: [],
    floorMaterial: DEFAULT_FLOOR_MATERIAL,
    units: DEFAULT_UNIT,
    constructionRate: 0,
    northOffset: 0,
    plotFacing: DEFAULT_FACING,
    plot: null,
    blueprint: null,
    projectName: null,
    readOnly: false,
    autosave: { kind: 'idle' },
    past: [],
    future: [],
    viewEpoch: state.viewEpoch + 1,
    historyEpoch: state.historyEpoch + 1,
  })
}

export type RichDesign = {
  walls: Wall[]
  furniture: FurnitureItem[]
  roomLabels: RoomLabel[]
  stairs: Stair[]
  plot: Plot
  floors: FloorData[]
  northOffset: number
  constructionRate: number
}

/**
 * A design with something in every field an assistant edit is not allowed to
 * touch: furniture, a named room, a staircase, a plot with setbacks, a rotated
 * north, a construction rate, and drawn upper storeys.
 *
 * Deliberately maximal. The bug this guards against deleted all of it, and a
 * fixture that only carries walls would have passed.
 */
export function seedRichDesign(): RichDesign {
  resetStore()

  const walls = rectangleWalls()
  const furniture: FurnitureItem[] = [
    { id: 'sofa-1', type: 'sofa', position: { x: 2, z: 1.5 }, rotation: 0 },
    { id: 'bed-1', type: 'bed', position: { x: 1, z: 2 }, rotation: Math.PI / 2 },
  ]
  const roomLabels: RoomLabel[] = [
    { id: 'room-1', type: 'living', anchor: { x: 2, z: 1.5 }, name: 'Family Room' },
  ]
  const stairs: Stair[] = [
    { id: 'stair-1', position: { x: 3, z: 2 }, rotation: 0, width: 1, run: 3.6 },
  ]
  const plot: Plot = {
    width: 30 * 0.3048,
    depth: 40 * 0.3048,
    origin: { x: -2, z: -3 },
    setbacks: { front: 1.5, rear: 1.5, left: 1, right: 1 },
  }

  const firstFloor: FloorData = {
    ...emptyFloor(1),
    id: 'floor-1',
    walls: rectangleWalls(4, 3).map((w) => ({ ...w, id: `f1-${w.id}` })),
  }
  const secondFloor: FloorData = {
    ...emptyFloor(2),
    id: 'floor-2',
    walls: rectangleWalls(3, 3).map((w) => ({ ...w, id: `f2-${w.id}` })),
  }
  const floors: FloorData[] = [
    { ...emptyFloor(0), id: 'floor-0', walls, furniture, roomLabels, stairs },
    firstFloor,
    secondFloor,
  ]

  useDesignStore.setState({
    walls,
    furniture,
    roomLabels,
    stairs,
    floors,
    plot,
    northOffset: 47,
    constructionRate: 1800,
    units: 'ftin',
    projectName: 'Verma Residence',
    // Same reasoning as `resetStore`: seed as a fresh document so the seeding
    // itself is not the first entry on the undo stack.
    historyEpoch: useDesignStore.getState().historyEpoch + 1,
  })

  return {
    walls,
    furniture,
    roomLabels,
    stairs,
    plot,
    floors,
    northOffset: 47,
    constructionRate: 1800,
  }
}
