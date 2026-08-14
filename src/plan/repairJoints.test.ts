import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findLooseJoints,
  weldJoints,
  REPAIR_EXTEND,
  REPAIR_MERGE,
} from './repairJoints'
import { detectRoomsUncached } from './rooms'
import { useDesignStore } from '../store/useDesignStore'
import { resetStore } from '../test/fixtures'
import type { Wall } from '../store/useDesignStore'

/**
 * Session 3a — the user-invoked joint repair.
 *
 * `JOIN_TOLERANCE` (15 mm) is a noise guard and closes nothing a user can see.
 * The diagnostic found real endpoints missing by 100–152 mm, which the guard
 * cannot touch and must not be widened to reach. This closes them on request
 * instead, with the user told what will move before it does.
 *
 * The fixtures are the ones from the diagnostic. Counts AND areas, always —
 * `rooms.length > 0` would pass on the bug.
 *
 * ── Demonstrated red (SD5) ──
 * Extension pass disabled: five failures, led by `expected 1 to be 5` on
 * fixtures D and B — the 100 mm and 152 mm cases are exactly what pass 2
 * exists for, and the merge pass alone cannot reach them.
 *
 * Extension moved to the PERPENDICULAR FOOT instead of along the wall's own
 * line: `expected 0.811033571919126 to be close to 0.7853981633974483` — a
 * 1.47° rotation of the diagonal. Worth recording that the first draft of that
 * test used only the rectilinear fixture, where the foot and the axis
 * intersection are the same point, and the substitution passed all fifteen
 * tests. The oblique wall is there because of it.
 */

const G = 0.1524
const SHELL = { w: 64, d: 54 }
const FULL_AREA = SHELL.w * G * (SHELL.d * G)

const wall = (id: string, ax: number, az: number, bx: number, bz: number, t: number): Wall => ({
  id,
  start: { x: ax * G, z: az * G },
  end: { x: bx * G, z: bz * G },
  height: 3,
  thickness: t,
  openings: [],
  material: 'white-paint',
  type: 'shell' as const,
})

/** Shell plus five partitions; `pullBack` drops each partition end short. */
function plan(pullBack = 0): Wall[] {
  const S = 0.2
  const P = 0.1
  const p = pullBack
  return [
    wall('s1', 0, 0, SHELL.w, 0, S),
    wall('s2', SHELL.w, 0, SHELL.w, SHELL.d, S),
    wall('s3', SHELL.w, SHELL.d, 0, SHELL.d, S),
    wall('s4', 0, SHELL.d, 0, 0, S),
    { ...wall('p1', 24, 0, 24, 30, P), start: { x: 24 * G, z: p } },
    { ...wall('p2', 0, 30, 24, 30, P), start: { x: p, z: 30 * G } },
    { ...wall('p3', 44, 0, 44, 30, P), start: { x: 44 * G, z: p } },
    { ...wall('p4', 24, 30, SHELL.w, 30, P), end: { x: SHELL.w * G - p, z: 30 * G } },
    { ...wall('p5', 30, 30, 30, SHELL.d, P), end: { x: 30 * G, z: SHELL.d * G - p } },
  ]
}

const measure = (walls: Wall[]) => {
  const rooms = detectRoomsUncached(walls)
  return { count: rooms.length, area: rooms.reduce((s, r) => s + r.area, 0) }
}

const angleOf = (w: Wall) =>
  Math.atan2(w.end.z - w.start.z, w.end.x - w.start.x)

describe('★ repair — the diagnostic fixtures resolve afterwards', () => {
  it('★ D · partitions drawn to the wall FACE (100 mm)', () => {
    const broken = plan(0.1)
    expect(measure(broken)).toEqual({ count: 1, area: expect.closeTo(FULL_AREA, 6) })

    const fixed = measure(weldJoints(broken))
    expect(fixed.count).toBe(5)
    expect(fixed.area).toBeCloseTo(FULL_AREA, 6)
  })

  it('★ B · partitions one grid cell short (152.4 mm)', () => {
    const broken = plan(G)
    expect(measure(broken).count).toBe(1)

    const fixed = measure(weldJoints(plan(G)))
    expect(fixed.count).toBe(5)
    expect(fixed.area).toBeCloseTo(FULL_AREA, 6)
  })

  it('★ G · an endpoint left behind by a typed length', () => {
    // What `setWallLength` did before Session 2, and what already-damaged
    // documents still carry — Session 2 fixed the future, not the past.
    const broken = plan(0)
    broken[0] = { ...broken[0], end: { x: 9.6, z: 0 } }
    expect(measure(broken)).toEqual({ count: 4, area: expect.closeTo(66.29, 1) })

    const fixed = measure(weldJoints(broken))
    expect(fixed.count).toBe(5)
    // NOT the original 80.27 m². The corner is closed at the MIDPOINT of the
    // two ends, because nothing tells the repair which of them was right — the
    // shell wall was shortened by a typed length and the wall it left behind
    // is equally plausible as the survivor. Splitting the difference is the
    // least-assumptive choice, and it costs 0.3 m² here.
    //
    // Asserted as the real number rather than loosened to a band: a band wide
    // enough to swallow this would also swallow a repair that moved the corner
    // somewhere else entirely.
    expect(fixed.area).toBeCloseTo(79.95, 2)
    expect(fixed.area).toBeLessThan(FULL_AREA)
  })

  it('★ a plan needing no repair is returned UNCHANGED, by identity', () => {
    const healthy = plan(0)
    expect(findLooseJoints(healthy)).toEqual([])
    // The same array, not an equal one. A new identity would make the store
    // record an undo step in which nothing changed (§10 rule 10).
    expect(weldJoints(healthy)).toBe(healthy)
    expect(measure(healthy)).toEqual({ count: 5, area: expect.closeTo(FULL_AREA, 6) })
  })
})

describe('★ repair — the properties it has to have', () => {
  it('★ is idempotent — welding twice equals welding once', () => {
    const once = weldJoints(plan(0.1))
    const twice = weldJoints(once)
    expect(twice).toBe(once) // nothing left loose, so the same array back
    expect(measure(twice)).toEqual(measure(once))
  })

  it('★ is order-independent — a shuffled array welds identically', () => {
    const walls = plan(0.1)
    // Reversed and rotated: two different orders, one expected answer. The
    // union-find clusters and the id tie-break exist for exactly this, and an
    // unsorted mean would drift here because float addition is not associative.
    const shuffled = [...walls.slice(4), ...walls.slice(0, 4)].reverse()

    const a = weldJoints(walls)
    const b = weldJoints(shuffled)

    const key = (list: Wall[]) =>
      [...list]
        .sort((x, y) => (x.id < y.id ? -1 : 1))
        .map((w) => `${w.id}:${w.start.x},${w.start.z}->${w.end.x},${w.end.z}`)

    expect(key(b)).toEqual(key(a))
    expect(measure(b)).toEqual(measure(a))
  })

  it('★ never moves an endpoint further than the tolerance allows', () => {
    const walls = plan(0.1)
    for (const joint of findLooseJoints(walls)) {
      const travel = Math.hypot(joint.to.x - joint.at.x, joint.to.z - joint.at.z)
      // 100 mm here; the extension bound is half the 200 mm shell plus slack.
      expect(travel).toBeLessThanOrEqual(0.2)
    }
  })

  it('★ never rotates a wall — extension runs along its own axis, not to the foot', () => {
    // An OBLIQUE meeting, and that is the whole point of this fixture. The
    // first version of this test used only the rectilinear plan, where every
    // partition meets its target at 90° and the perpendicular foot IS the axis
    // intersection — so swapping one for the other passed all fifteen tests.
    // At 45° the two answers differ, and only then does the assertion bite.
    const oblique: Wall[] = [
      // A long wall along z = 0.
      { ...wall('shell', 0, 0, 0, 0, 0.2), start: { x: 0, z: 0 }, end: { x: 6, z: 0 } },
      // A diagonal running up-right, stopping 100 mm short of it.
      {
        ...wall('diag', 0, 0, 0, 0, 0.1),
        start: { x: 3.1, z: 0.1 },
        end: { x: 5, z: 2 },
      },
    ]

    const before = angleOf(oblique[1])
    const welded = weldJoints(oblique)
    const diag = welded.find((w) => w.id === 'diag')!

    // Bearing preserved to nine places: the endpoint slid ALONG the wall's own
    // line to meet the shell's centreline.
    expect(angleOf(diag)).toBeCloseTo(before, 9)
    // …and it genuinely moved, so this is not passing by doing nothing.
    expect(diag.start).not.toEqual(oblique[1].start)
    expect(diag.start.z).toBeCloseTo(0, 9)
    // The perpendicular foot would have been x = 3.1; the axis intersection is
    // x = 3.0. Asserting the number is what makes the two distinguishable.
    expect(diag.start.x).toBeCloseTo(3.0, 9)

    // And the rectilinear plan keeps every bearing too.
    const rect = plan(0.1)
    const rectWelded = weldJoints(rect)
    for (let i = 0; i < rect.length; i++) {
      expect(angleOf(rectWelded[i])).toBeCloseTo(angleOf(rect[i]), 9)
    }
  })

  it('leaves walls further apart than the tolerance alone', () => {
    // Two ends 300 mm apart are not a joint at any tolerance this offers.
    const far: Wall[] = [
      wall('a', 0, 0, 10, 0, 0.1),
      { ...wall('b', 0, 0, 0, 10, 0.1), start: { x: 10 * G + 0.3, z: 0 } },
    ]
    expect(findLooseJoints(far)).toEqual([])
    expect(weldJoints(far)).toBe(far)
  })

  it('★ no merge ever moves an endpoint further than it promised', () => {
    // Transitive chaining can build a cluster far wider than any single pair.
    // Six ends stepping across at 150 mm each chain into a 750 mm run; merging
    // that would haul the outermost 375 mm, which nothing told the user could
    // happen. The whole cluster is refused instead.
    const step = REPAIR_EXTEND * 0.95
    const chain: Wall[] = Array.from({ length: 6 }, (_, i) => ({
      ...wall(`w${i}`, 0, 0, 0, 10, 0.1),
      // Alternating bearings, so every adjacent pair is angled and therefore
      // eligible for the wider reach — which is what makes the chain long.
      start: { x: 1 + step * i, z: 0 },
      end: { x: 1 + step * i + (i % 2 === 0 ? 3 : 0), z: i % 2 === 0 ? 0 : 3 },
    }))

    for (const joint of findLooseJoints(chain)) {
      const travel = Math.hypot(joint.to.x - joint.at.x, joint.to.z - joint.at.z)
      expect(travel).toBeLessThanOrEqual(REPAIR_EXTEND)
    }
  })

  it('leaves two near-PARALLEL ends alone at a distance a corner would close', () => {
    // 120 mm apart. Angled walls that close would be a corner; parallel ones
    // are as likely a duct shaft or a cavity, so the tighter tolerance holds
    // and nothing moves. This is the asymmetry `mergeReach` exists for.
    const parallel: Wall[] = [
      { ...wall('a', 0, 0, 0, 0, 0.1), start: { x: 0, z: 0 }, end: { x: 1, z: 0 } },
      { ...wall('b', 0, 0, 0, 0, 0.1), start: { x: 1.12, z: 0 }, end: { x: 2, z: 0 } },
    ]
    expect(findLooseJoints(parallel).filter((j) => j.kind === 'merge')).toEqual([])

    // …while the same gap between walls that meet at 90° IS closed.
    const corner: Wall[] = [
      { ...wall('a', 0, 0, 0, 0, 0.1), start: { x: 0, z: 0 }, end: { x: 1, z: 0 } },
      { ...wall('b', 0, 0, 0, 0, 0.1), start: { x: 1.12, z: 0 }, end: { x: 1.12, z: 2 } },
    ]
    expect(findLooseJoints(corner).filter((j) => j.kind === 'merge')).toHaveLength(2)
  })

  it('does not treat the two ends of one wall as a joint', () => {
    const stub: Wall[] = [{ ...wall('a', 0, 0, 0, 0, 0.1), end: { x: 0.01, z: 0 } }]
    expect(findLooseJoints(stub)).toEqual([])
  })
})

describe('★ repair — the real plan, which is what found the bugs', () => {
  /**
   * `samples/real-plan-cv-untitled.json` — a user's actual saved project.
   *
   * Both properties below were already asserted against synthetic fixtures and
   * both passed, because no synthetic ever put a MERGE and an EXTEND on the
   * same endpoint. This file does, twice, and it broke both:
   *
   *   idempotent            weldJoints(weldJoints(w)) !== weldJoints(w)
   *   travel <= 160 mm      one endpoint moved 169.4 mm
   *
   * Pass 2 now skips any slot pass 1 claimed, and measures travel from the
   * ORIGINAL endpoint rather than from wherever pass 1 left it.
   */
  const real = (): Wall[] => {
    const doc = JSON.parse(
      readFileSync('samples/real-plan-cv-untitled.json', 'utf8'),
    ) as { walls: Wall[] }
    return doc.walls
  }

  /**
   * The bound is `extendReach`, which SCALES WITH THE TARGET'S THICKNESS —
   * `max(REPAIR_EXTEND, thickness/2 + REPAIR_MERGE)`. For this plan's 276 mm
   * shell that is 188 mm, not 160.
   *
   * Session 3B reported "one endpoint moved 169.4 mm against a 160 mm bound"
   * and called it a bug. **That was my own misreading of my own code**: 169.4
   * is inside 188, and no bound was ever exceeded. The real defect was the
   * double-emit below. Recorded because a wrong diagnosis repeated as verified
   * is what finding 14 warns about.
   */
  it('★ moves each endpoint at most once, within the thickness-scaled bound', () => {
    const walls = real()
    const joints = findLooseJoints(walls)

    // TWELVE, not the fourteen the status bar showed before this fix. Two of
    // the fourteen were the same endpoint counted twice — once merged, once
    // extended — so the old number was inflated by the bug it was reporting.
    expect(joints.length).toBe(12)

    // Derived from the plan's own walls, so the assertion cannot drift from
    // the rule it is checking.
    const widest = Math.max(...walls.map((w) => w.thickness))
    const bound = Math.max(REPAIR_EXTEND, widest / 2 + REPAIR_MERGE)
    expect(bound).toBeCloseTo(0.1879, 4)

    for (const j of joints) {
      expect(Math.hypot(j.to.x - j.at.x, j.to.z - j.at.z)).toBeLessThanOrEqual(bound)
    }
  })

  /**
   * ★ CONVERGES rather than being idempotent in one call, and that is a
   * deliberate choice the real plan forced.
   *
   * Merging a corner genuinely moves geometry, which can bring a third wall
   * within reach that was not within reach before. On this file the sequence
   * is 12 joints, then 1, then 0.
   *
   * One-pass idempotence is reachable only by iterating internally to a fixed
   * point — and that is precisely the bug just fixed, generalised: N passes
   * inside one call let a single endpoint travel N x REPAIR_EXTEND while the
   * UI promises one bound. **The per-call promise is what must hold**, so each
   * call moves each endpoint at most once, and the status bar shows what is
   * left. The user can see the remaining count and click again.
   */
  it('★ converges to a fixed point, moving each endpoint at most once per call', () => {
    let walls = real()
    const counts: number[] = []

    for (let pass = 0; pass < 6; pass++) {
      const joints = findLooseJoints(walls)
      counts.push(joints.length)
      // The invariant that matters, on EVERY pass and not just the first.
      const bound = Math.max(
        REPAIR_EXTEND,
        Math.max(...walls.map((w) => w.thickness)) / 2 + REPAIR_MERGE,
      )
      for (const j of joints) {
        expect(Math.hypot(j.to.x - j.at.x, j.to.z - j.at.z)).toBeLessThanOrEqual(bound)
      }
      if (joints.length === 0) break
      walls = weldJoints(walls)
    }

    // Asserted as the actual sequence, not merely "reaches zero": a run that
    // oscillated 12, 1, 12, 1 would satisfy "reaches zero eventually" on a
    // lucky pass and would still be a broken repair.
    expect(counts).toEqual([12, 1, 0])
    // …and at the fixed point the same array comes back, so no undo step.
    expect(weldJoints(walls)).toBe(walls)
  })

  it('★ emits at most one joint per endpoint', () => {
    // The defect itself, named directly rather than through its symptoms: one
    // slot produced two joints and `weldJoints` applied both, last winning.
    const seen = new Set<string>()
    for (const j of findLooseJoints(real())) {
      const slot = `${j.wallId}:${j.which}`
      expect(seen.has(slot)).toBe(false)
      seen.add(slot)
    }
  })
})

describe('★ repair — the store action', () => {
  const settle = () => vi.advanceTimersByTime(250)

  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetStore()
  })

  it('★ is ONE undo step however many endpoints move', () => {
    useDesignStore.setState({ walls: plan(0.1) })
    settle()
    const before = useDesignStore.getState().past.length

    const moved = useDesignStore.getState().repairJoints()
    settle()

    // Five partitions, so five endpoints — and still one step. Asserted
    // directly rather than through the recorder's 200 ms window, which would
    // make undo depend on how fast the machine ran.
    expect(moved).toBe(5)
    expect(useDesignStore.getState().past.length).toBe(before + 1)
  })

  it('★ one undo restores every endpoint it moved', () => {
    useDesignStore.setState({ walls: plan(0.1) })
    settle()
    const original = useDesignStore.getState().walls

    useDesignStore.getState().repairJoints()
    settle()
    expect(detectRoomsUncached(useDesignStore.getState().walls)).toHaveLength(5)

    useDesignStore.getState().undo()

    expect(useDesignStore.getState().walls).toEqual(original)
    expect(detectRoomsUncached(useDesignStore.getState().walls)).toHaveLength(1)
  })

  it('reports zero and records nothing when there is nothing to repair', () => {
    useDesignStore.setState({ walls: plan(0) })
    settle()
    const before = useDesignStore.getState().past.length

    expect(useDesignStore.getState().repairJoints()).toBe(0)
    settle()

    // The count is what lets the status bar say "Nothing to connect" instead
    // of appearing to have done nothing.
    expect(useDesignStore.getState().past.length).toBe(before)
  })
})
