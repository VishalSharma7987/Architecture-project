import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BLUEPRINT_DEFAULTS, useDesignStore, type Blueprint } from '../store/useDesignStore'
import { resetStore, rectangleWalls } from '../test/fixtures'
import { applyPlanScale, type PlanAnalysis } from './detectOpenings'
import {
  CALIBRATION_RANK,
  describeCalibration,
  isMeasured,
  proposeCalibration,
  uncalibrated,
  unlockCalibration,
} from './calibration'

/**
 * Q1 regression suite.
 *
 * The defect: a vision model's reading of dimension text silently replaced a
 * scale the user had measured by hand, then every wall built afterwards was
 * baked at the model's number, and the banner reported the result as
 * "calibrated". Nothing was persisted or undoable, so there was no way back.
 *
 * `proposeCalibration` is now the only writer and it ranks its callers.
 */

const AT = '2026-08-07T00:00:00.000Z'

/** A loaded, uncalibrated 1000x800 px blueprint at the default guess. */
function loadBlueprint(): Blueprint {
  const metresPerPixel = BLUEPRINT_DEFAULTS.metresPerPixel
  const blueprint: Blueprint = {
    src: 'blob:test/plan.png',
    fileName: 'plan.png',
    width: 1000,
    height: 800,
    metresPerPixel,
    origin: { x: -(1000 * metresPerPixel) / 2, z: -(800 * metresPerPixel) / 2 },
    opacity: 0.5,
    visible: true,
    calibration: uncalibrated(metresPerPixel, AT),
  }
  useDesignStore.getState().setBlueprint(blueprint)
  return blueprint
}

/** What the vision model comes back with: a 40 ft building across 80% of the image. */
const AI_ANALYSIS: PlanAnalysis = {
  widthFeet: 40,
  depthFeet: 30,
  box: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
  openings: [],
  rooms: [],
  furniture: [],
}

beforeEach(() => resetStore())
afterEach(() => resetStore())

describe('the authority ladder', () => {
  it('ranks manual above every automated source', () => {
    const automated = ['dxf-units', 'vector', 'ocr', 'heuristic', 'ai', 'none'] as const
    for (const source of automated) {
      expect(CALIBRATION_RANK.manual).toBeLessThan(CALIBRATION_RANK[source])
    }
  })

  it('ranks ai above only the untouched default', () => {
    expect(CALIBRATION_RANK.ai).toBeLessThan(CALIBRATION_RANK.none)
    expect(CALIBRATION_RANK.ai).toBeGreaterThan(CALIBRATION_RANK.heuristic)
  })
})

describe('proposeCalibration', () => {
  it('accepts any source over the untouched default', () => {
    loadBlueprint()
    const result = proposeCalibration({ source: 'ai', metresPerPixel: 0.02, at: AT })
    expect(result.applied).toBe(true)
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.02)
  })

  it('locks the scale once the user measures it', () => {
    loadBlueprint()
    proposeCalibration({ source: 'manual', metresPerPixel: 0.019, at: AT })

    const calibration = useDesignStore.getState().blueprint?.calibration
    expect(calibration?.source).toBe('manual')
    expect(calibration?.lockedByUser).toBe(true)
    expect(isMeasured(calibration)).toBe(true)
  })

  it('★ refuses an AI estimate once the user has measured', () => {
    loadBlueprint()
    proposeCalibration({ source: 'manual', metresPerPixel: 0.019, at: AT })

    const result = proposeCalibration({ source: 'ai', metresPerPixel: 0.0305, at: AT })

    expect(result.applied).toBe(false)
    expect(result.applied === false && result.reason).toContain('locked')
    // The measurement is still exactly what the user set.
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.019)
  })

  it('refuses every weaker source against a measurement, not just ai', () => {
    loadBlueprint()
    proposeCalibration({ source: 'manual', metresPerPixel: 0.019, at: AT })

    for (const source of ['dxf-units', 'vector', 'ocr', 'heuristic', 'ai'] as const) {
      expect(proposeCalibration({ source, metresPerPixel: 0.5, at: AT }).applied).toBe(false)
    }
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.019)
  })

  it('lets the user re-measure their own scale', () => {
    loadBlueprint()
    proposeCalibration({ source: 'manual', metresPerPixel: 0.019, at: AT })
    const again = proposeCalibration({ source: 'manual', metresPerPixel: 0.021, at: AT })

    expect(again.applied).toBe(true)
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.021)
  })

  it('refuses a weaker source even without an explicit lock', () => {
    loadBlueprint()
    // `ocr` outranks `ai`, and neither locks.
    proposeCalibration({ source: 'ocr', metresPerPixel: 0.02, at: AT })
    const worse = proposeCalibration({ source: 'ai', metresPerPixel: 0.04, at: AT })

    expect(worse.applied).toBe(false)
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.02)
  })

  it('only an explicit user action can unlock a measurement', () => {
    loadBlueprint()
    proposeCalibration({ source: 'manual', metresPerPixel: 0.019, at: AT })
    unlockCalibration()

    expect(proposeCalibration({ source: 'ai', metresPerPixel: 0.03, at: AT }).applied).toBe(true)
  })

  it('clamps every source to the same bounds', () => {
    loadBlueprint()
    // 5 m per pixel is far past BLUEPRINT.maxMetresPerPixel of 1. The AI path
    // used to have no clamp at all while the manual path did.
    proposeCalibration({ source: 'ai', metresPerPixel: 5, at: AT })
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(1)

    resetStore()
    loadBlueprint()
    proposeCalibration({ source: 'ai', metresPerPixel: 1e-9, at: AT })
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(1e-5)
  })

  it('rejects a value that is not a scale', () => {
    loadBlueprint()
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(proposeCalibration({ source: 'manual', metresPerPixel: bad, at: AT }).applied).toBe(
        false,
      )
    }
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.01)
  })

  it('holds the anchor point fixed while the image resizes', () => {
    loadBlueprint()
    const anchor = { x: 1, z: 2 }
    // Doubling the scale must leave the anchored world point where it was.
    proposeCalibration({ source: 'manual', metresPerPixel: 0.02, anchor, at: AT })

    const bp = useDesignStore.getState().blueprint!
    // The anchor's position within the image, in pixels, is unchanged.
    const pixelX = (anchor.x - bp.origin.x) / bp.metresPerPixel
    expect(pixelX).toBeCloseTo(600, 6) // (1 - (-5)) / 0.01 = 600 px before
  })

  it('holds the image centre when given no anchor', () => {
    loadBlueprint()
    const before = useDesignStore.getState().blueprint!
    const centreBefore = {
      x: before.origin.x + (before.width * before.metresPerPixel) / 2,
      z: before.origin.z + (before.height * before.metresPerPixel) / 2,
    }

    proposeCalibration({ source: 'ai', metresPerPixel: 0.04, at: AT })

    const after = useDesignStore.getState().blueprint!
    expect(after.origin.x + (after.width * after.metresPerPixel) / 2).toBeCloseTo(
      centreBefore.x,
      9,
    )
    expect(after.origin.z + (after.height * after.metresPerPixel) / 2).toBeCloseTo(
      centreBefore.z,
      9,
    )
  })

  it('reports walls that were built at the old scale', () => {
    loadBlueprint()
    useDesignStore.setState({ walls: rectangleWalls() })

    const result = proposeCalibration({ source: 'manual', metresPerPixel: 0.02, at: AT })
    expect(result.applied && result.staleWalls).toBe(4)
  })
})

describe('applyPlanScale — the 2D→3D path', () => {
  it('★ leaves a measured scale alone and says so', () => {
    loadBlueprint()
    proposeCalibration({ source: 'manual', metresPerPixel: 0.019, at: AT })

    const source = applyPlanScale(AI_ANALYSIS)

    expect(source.kind).toBe('kept-measured')
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.019)
  })

  it('sizes an unmeasured image, and calls the result an estimate', () => {
    loadBlueprint()

    const source = applyPlanScale(AI_ANALYSIS)

    // Both dimensions were legible, so the two independent readings are
    // averaged — 40 ft across 800 px, and 30 ft across 640 px.
    expect(source.kind).toBe('estimated')
    const fromWidth = (40 * 0.3048) / (0.8 * 1000)
    const fromDepth = (30 * 0.3048) / (0.8 * 800)
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBeCloseTo(
      (fromWidth + fromDepth) / 2,
      9,
    )
    expect(useDesignStore.getState().blueprint?.calibration.source).toBe('ai')
  })

  it('never reports an estimate as a calibration', () => {
    loadBlueprint()
    const source = applyPlanScale(AI_ANALYSIS)
    // The literal string that used to reach the user's banner.
    expect(JSON.stringify(source)).not.toContain('calibrated')
    expect(describeCalibration(useDesignStore.getState().blueprint!.calibration)).toBe(
      'estimated by a vision model',
    )
  })

  it('falls back to a guess when no dimension was legible', () => {
    loadBlueprint()
    const source = applyPlanScale({ ...AI_ANALYSIS, widthFeet: null, depthFeet: null })
    expect(source.kind).toBe('guess')
    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.01)
  })

  it('falls back to a guess when the model returned no building box', () => {
    loadBlueprint()
    const source = applyPlanScale({ ...AI_ANALYSIS, box: null })
    expect(source.kind).toBe('guess')
  })
})

describe('a calibration is undoable', () => {
  it('★ ⌘Z restores the previous scale', () => {
    // The recorder coalesces edits made within HISTORY_COALESCE_MS into one
    // step, so loading and calibrating microseconds apart would undo as a
    // single "no blueprint at all". In real use they are seconds apart; fake
    // timers reproduce that rather than testing the burst window by accident.
    vi.useFakeTimers()
    try {
      loadBlueprint()
      vi.advanceTimersByTime(500)

      proposeCalibration({ source: 'manual', metresPerPixel: 0.019, at: AT })
      expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.019)

      useDesignStore.getState().undo()

      expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.01)
      expect(useDesignStore.getState().blueprint?.calibration.source).toBe('none')
    } finally {
      vi.useRealTimers()
    }
  })

  it('an opacity change does not create an undo step', () => {
    loadBlueprint()
    const stepsBefore = useDesignStore.getState().past.length

    useDesignStore.getState().updateBlueprint({ opacity: 0.9 })
    useDesignStore.getState().updateBlueprint({ opacity: 0.3 })

    expect(useDesignStore.getState().past.length).toBe(stepsBefore)
  })
})

describe('only the service may write a scale', () => {
  const SRC = join(process.cwd(), 'src')

  function sourceFiles(dir = SRC): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }

  it('no module outside calibration.ts writes metresPerPixel through updateBlueprint', () => {
    const offenders = sourceFiles()
      .map((path) => ({
        path: relative(process.cwd(), path).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
      }))
      .filter((f) => !f.path.startsWith('src/blueprint/calibration'))
      .filter((f) => !f.path.startsWith('src/test/'))
      // `updateBlueprint({ ... metresPerPixel ... })` in any spelling.
      .filter((f) => /updateBlueprint\(\s*\{[^}]*metresPerPixel/s.test(f.text))
      .map((f) => f.path)

    expect(
      offenders,
      'metresPerPixel has exactly one writer: proposeCalibration. Writing it ' +
        'directly bypasses the authority ladder, which is how an AI estimate ' +
        'came to overwrite a user measurement.',
    ).toEqual([])
  })
})
