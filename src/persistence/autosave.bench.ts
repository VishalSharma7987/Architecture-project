// @vitest-environment jsdom
import { describe, it } from 'vitest'
import { gridPlan } from '../plan/gridPlan'
import {
  allFloors,
  emptyFloor,
  persistedFingerprint,
  useDesignStore,
  type FloorData,
} from '../store/useDesignStore'
import { serializeDesign } from './schema'
import { writeAutosave } from './storage'

/**
 * OQ13c — the autosave path against §9.2's budget.
 *
 * §9.2: *"Autosave — < 20 ms, non-blocking."* F1/F2 restructured exactly this
 * path and never measured it. B7.5 wants to add a room resolve to it, so the
 * budget has to be known BEFORE anything is added, not after.
 *
 * What one tick actually does, from `useAutosave.ts:111`:
 *   1. `persistedFingerprint` + `persistedChanged` — the dirty check
 *   2. `allFloors` — reconciles the checked-out storey
 *   3. `serializeDesign` — builds the document
 *   4. `writeAutosave` — `JSON.stringify` + two `localStorage.setItem`s
 *
 * Step 4 is the one that blocks: `localStorage` is synchronous, and the whole
 * tick runs on the main thread inside a `setInterval`. "Non-blocking" in §9.2
 * cannot mean it yields — it does not — so it can only mean "short enough not
 * to be felt", which is what the 20 ms is.
 *
 * Not part of `npm test`. Same reasoning as `rooms.bench.ts`, and the same
 * config picks it up: `npm run bench:rooms`.
 */

const RUNS = 21
const WARMUP = 5

type Timing = { median: number; min: number; max: number }

function measure(run: () => void): Timing {
  for (let i = 0; i < WARMUP; i++) run()
  const samples: number[] = []
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return {
    median: samples[(samples.length - 1) >> 1],
    min: samples[0],
    max: samples[samples.length - 1],
  }
}

const ms = (n: number) => n.toFixed(3).padStart(9)

/** A building of `storeys` identical floors, each `wallsPerFloor` walls. */
function loadBuilding(wallsPerFloor: number, storeys: number) {
  const floors: FloorData[] = []
  for (let i = 0; i < 3; i++) {
    const floor = emptyFloor(i)
    if (i < storeys) {
      const { walls, labels } = gridPlan(wallsPerFloor, i * 1000)
      floors.push({ ...floor, walls, roomLabels: labels })
    } else {
      floors.push(floor)
    }
  }

  useDesignStore.setState({
    floors,
    activeFloor: 0,
    walls: floors[0].walls,
    roomLabels: floors[0].roomLabels,
    furniture: [],
    stairs: [],
    projectName: 'bench',
  })
}

/** Exactly the body of the autosave tick, minus the interval around it. */
function autosaveTick(): void {
  const state = useDesignStore.getState()
  persistedFingerprint(state)
  const floors = allFloors(state)
  const doc = serializeDesign({
    name: state.projectName ?? 'Untitled',
    walls: state.walls,
    furniture: state.furniture,
    roomLabels: state.roomLabels,
    stairs: floors[0].stairs,
    floors,
    plot: state.plot,
    blueprint: state.blueprint,
    floorMaterial: state.floorMaterial,
    viewMode: state.viewMode,
    units: state.units,
    constructionRate: state.constructionRate,
    northOffset: state.northOffset,
    plotFacing: state.plotFacing,
  })
  writeAutosave({ name: state.projectName, doc })
}

describe('autosave', () => {
  it('measures one tick at 50 / 200 / 500 walls x 1 and 3 storeys', () => {
    const rows: string[] = []
    let bytes = 0

    for (const walls of [50, 200, 500]) {
      for (const storeys of [1, 3]) {
        loadBuilding(walls, storeys)

        // Sized once, outside the timing: the payload is what makes
        // `JSON.stringify` and `setItem` cost what they cost.
        const state = useDesignStore.getState()
        const floors = allFloors(state)
        bytes = JSON.stringify(
          serializeDesign({
            name: 'bench',
            walls: state.walls,
            roomLabels: state.roomLabels,
            floors,
            viewMode: '2d',
          }),
        ).length

        const tick = measure(autosaveTick)
        rows.push(
          [
            String(walls).padStart(5),
            String(storeys).padStart(7),
            String(Math.round(bytes / 1024)).padStart(6),
            ms(tick.median),
            ms(tick.min),
            ms(tick.max),
            tick.median < 20 ? '   under' : '   OVER ',
          ].join(' | '),
        )
      }
    }

    console.log(
      [
        '',
        `one autosave tick · median of ${RUNS} runs after ${WARMUP} warmup · ms`,
        "§9.2 budget: < 20 ms",
        '',
        'walls | storeys | KiB    |   tick ms |      min |      max | vs budget',
        '------|---------|--------|-----------|----------|----------|----------',
        ...rows,
        '',
      ].join('\n'),
    )
  })
})
