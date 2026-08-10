import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesignStore, type Blueprint } from './useDesignStore'
import { uncalibrated } from '../blueprint/calibration'
import { rectangleWalls, resetStore } from '../test/fixtures'

/**
 * The undo engine, and the blueprint's place in it.
 *
 * `blueprint` is part of `DesignSnapshot` because a calibration must be
 * undoable — losing one used to be unrecoverable. But a blueprint also carries
 * an object URL, which has a lifetime the snapshot does not respect, and that
 * is what this suite pins down.
 */

const AT = '2026-08-10T00:00:00.000Z'

function blueprintNamed(fileName: string, src: string): Blueprint {
  return {
    src,
    fileName,
    width: 1000,
    height: 800,
    metresPerPixel: 0.01,
    origin: { x: -5, z: -4 },
    opacity: 0.5,
    visible: true,
    calibration: uncalibrated(0.01, AT),
  }
}

/** Every object URL `setBlueprint` has revoked this test. */
let revoked: string[]

/**
 * Closes the current undo burst.
 *
 * Edits within `HISTORY_COALESCE_MS` of each other coalesce into one step, so
 * that a drag undoes as a single move. Two edits meant to be two steps have to
 * be separated by more than that — otherwise a test measuring `past.length`
 * measures the coalescing rather than the thing it is asking about.
 */
function settle() {
  vi.advanceTimersByTime(250)
}

beforeEach(() => {
  vi.useFakeTimers()
  resetStore()
  revoked = []
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
    revoked.push(url)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  resetStore()
})

/**
 * ★ F3 — undo used to hand back a blueprint whose pixels had been freed.
 *
 * `setBlueprint` revokes the outgoing object URL, and `blueprint` is in the
 * undo snapshot, so undoing a replacement restored a `Blueprint` whose `src`
 * pointed at a `blob:` URL that had already been revoked. The image silently
 * failed to load — and the panel's own "remembers the file but not the image"
 * message never fired, because it tests `!blueprint.src` and a revoked URL is
 * still a non-null string. The user got a blank underlay and no explanation.
 */
describe('★ a blueprint restored by undo never carries a dead object URL', () => {
  it('does not hand back a revoked URL', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    useDesignStore.getState().setBlueprint(blueprintNamed('second.png', 'blob:test/second'))
    settle()

    expect(revoked, 'the first image was freed on replacement').toContain(
      'blob:test/first',
    )

    useDesignStore.getState().undo()

    const src = useDesignStore.getState().blueprint?.src ?? null
    expect(src === null || !revoked.includes(src)).toBe(true)
  })

  it('reports no image, which is the state the panel already explains', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    useDesignStore.getState().setBlueprint(blueprintNamed('second.png', 'blob:test/second'))
    settle()
    useDesignStore.getState().undo()

    const blueprint = useDesignStore.getState().blueprint
    expect(blueprint?.fileName, 'the placement is still remembered').toBe('first.png')
    expect(blueprint?.src, 'but the pixels are gone, and it says so').toBeNull()
  })

  it('keeps the scale the restored placement was measured at', () => {
    const first = blueprintNamed('first.png', 'blob:test/first')
    useDesignStore.getState().setBlueprint({ ...first, metresPerPixel: 0.019 })
    settle()
    useDesignStore.getState().setBlueprint(blueprintNamed('second.png', 'blob:test/second'))
    settle()
    useDesignStore.getState().undo()

    expect(useDesignStore.getState().blueprint?.metresPerPixel).toBe(0.019)
  })

  it('does not revoke the URL of the blueprint still on screen', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('only.png', 'blob:test/only'))
    expect(revoked).not.toContain('blob:test/only')
  })
})

/**
 * The fix nulls `src` inside the snapshot, so `blueprintChanged` can no longer
 * tell two different images apart by their URLs. These pin the behaviour that
 * would otherwise be lost silently — a replacement that stopped being an undo
 * step would be a data-safety regression wearing a performance disguise.
 */
describe('replacing a blueprint is still one undo step', () => {
  it('records the replacement', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    const before = useDesignStore.getState().past.length

    useDesignStore.getState().setBlueprint(blueprintNamed('second.png', 'blob:test/second'))
    settle()

    expect(useDesignStore.getState().past.length).toBeGreaterThan(before)
  })

  it('records a replacement by an image of a different size', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('plan.png', 'blob:test/a'))
    settle()
    const before = useDesignStore.getState().past.length

    useDesignStore.getState().setBlueprint({
      ...blueprintNamed('plan.png', 'blob:test/b'),
      width: 2000,
      height: 1600,
    })
    settle()

    expect(useDesignStore.getState().past.length).toBeGreaterThan(before)
  })

  it('records removing the blueprint entirely', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    const before = useDesignStore.getState().past.length

    useDesignStore.getState().setBlueprint(null)
    settle()

    expect(useDesignStore.getState().past.length).toBeGreaterThan(before)
  })

  it('still does not record an opacity change', () => {
    useDesignStore.getState().setBlueprint(blueprintNamed('first.png', 'blob:test/first'))
    settle()
    const before = useDesignStore.getState().past.length

    useDesignStore.getState().updateBlueprint({ opacity: 0.9 })
    settle()
    useDesignStore.getState().updateBlueprint({ opacity: 0.2 })
    settle()

    // Opacity is how you are looking at the drawing, not part of the design.
    expect(useDesignStore.getState().past.length).toBe(before)
  })
})

describe('undo covers the rest of the design as before', () => {
  it('steps back a wall edit', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    settle()
    const before = useDesignStore.getState().walls

    useDesignStore.getState().addWall({ x: 0, z: 0 }, { x: 1, z: 0 })
    settle()

    useDesignStore.getState().undo()
    expect(useDesignStore.getState().walls).toBe(before)
  })

  it('redoes what it undid', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    settle()
    useDesignStore.getState().addWall({ x: 0, z: 0 }, { x: 1, z: 0 })
    settle()
    const after = useDesignStore.getState().walls

    useDesignStore.getState().undo()
    useDesignStore.getState().redo()
    expect(useDesignStore.getState().walls).toBe(after)
  })
})
