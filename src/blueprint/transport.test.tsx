import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BlueprintPanel } from '../components/BlueprintPanel'
import { resetStore } from '../test/fixtures'
import {
  MAX_TRACKED_IMAGES,
  TRANSPORT_AXIS_TOLERANCE_PX,
  detectFixedAxisTransport,
  rememberImage,
  transportMessage,
  type ImageObservation,
} from './transport'
import { persistedFingerprint, useDesignStore } from '../store/useDesignStore'

const img = (fileName: string, width: number, height: number): ImageObservation => ({
  fileName,
  width,
  height,
})

/**
 * Corpus batch 3, verbatim. Four real CAD drawings, four aspect ratios, all
 * within one pixel of the same width — `docs/testing/corpus-manifest.md`.
 */
const BATCH_3 = [
  img('image(10).png', 474, 693),
  img('image(11).png', 474, 842),
  img('image(12).png', 473, 496),
  img('image(13).png', 473, 494),
]

describe('the transport signature', () => {
  it('fires on corpus batch 3 and names the width', () => {
    const signature = detectFixedAxisTransport(BATCH_3)

    expect(signature).not.toBeNull()
    expect(signature!.axis).toBe('width')
    expect(signature!.low).toBe(473)
    expect(signature!.high).toBe(474)
    expect(transportMessage(signature!)).toBe(
      "All four drawings you've added are 473–474 px wide — they've been " +
        'resized by whatever you sent them through. The originals will work.',
    )
  })

  it('says nothing about one image, however suspicious its size', () => {
    expect(detectFixedAxisTransport([BATCH_3[0]])).toBeNull()
    expect(detectFixedAxisTransport([])).toBeNull()
  })

  /**
   * The half of the rule that stops it firing on ordinary work.
   *
   * Three sheets exported at 800x600 have perfectly agreeing widths. They are
   * one export setting, not a pipeline reshaping different drawings to a common
   * width — and the giveaway is that their HEIGHTS agree too. Without this the
   * check would fire on the tidiest possible input.
   */
  it('does not fire when the other axis agrees as well', () => {
    expect(
      detectFixedAxisTransport([
        img('a.png', 800, 600),
        img('b.png', 800, 600),
        img('c.png', 800, 601),
      ]),
    ).toBeNull()
  })

  it('catches a fixed-HEIGHT pipeline the same way', () => {
    const signature = detectFixedAxisTransport([
      img('a.png', 900, 512),
      img('b.png', 1400, 512),
    ])

    expect(signature!.axis).toBe('height')
    expect(transportMessage(signature!)).toContain('512 px tall')
  })

  it('holds the tolerance at both sides of the boundary', () => {
    const spread = (delta: number) =>
      detectFixedAxisTransport([img('a.png', 500, 400), img('b.png', 500 + delta, 900)])

    expect(spread(TRANSPORT_AXIS_TOLERANCE_PX)).not.toBeNull()
    expect(spread(TRANSPORT_AXIS_TOLERANCE_PX + 1)).toBeNull()
  })

  it('counts two as "Both" and many by number', () => {
    const two = detectFixedAxisTransport(BATCH_3.slice(0, 2))!
    expect(transportMessage(two).startsWith("Both drawings you've added are 474 px wide")).toBe(true)

    const many = detectFixedAxisTransport(
      Array.from({ length: 7 }, (_, i) => img(`f${i}.png`, 474, 400 + i * 50)),
    )!
    expect(transportMessage(many).startsWith("All 7 drawings you've added are")).toBe(true)
  })
})

describe('the session record', () => {
  /**
   * Re-picking the same file to restore its pixels after a reload is ONE image
   * seen twice. Counting it twice would give a two-observation set whose width
   * agrees with itself — and while the height would agree too and save us here,
   * relying on that would make the rule depend on an accident.
   */
  it('counts a re-picked file once', () => {
    let seen: ImageObservation[] = []
    seen = rememberImage(seen, img('plan.png', 474, 693))
    seen = rememberImage(seen, img('plan.png', 474, 693))

    expect(seen).toHaveLength(1)
  })

  it('keeps the newest when a file is supplied again at a different size', () => {
    let seen: ImageObservation[] = []
    seen = rememberImage(seen, img('plan.png', 474, 693))
    seen = rememberImage(seen, img('plan.png', 1600, 2340))

    expect(seen).toEqual([img('plan.png', 1600, 2340)])
  })

  it('caps the record and keeps the newest', () => {
    let seen: ImageObservation[] = []
    for (let i = 0; i < MAX_TRACKED_IMAGES + 5; i++) {
      seen = rememberImage(seen, img(`f${i}.png`, 400 + i, 300))
    }

    expect(seen).toHaveLength(MAX_TRACKED_IMAGES)
    expect(seen[seen.length - 1].fileName).toBe(`f${MAX_TRACKED_IMAGES + 4}.png`)
  })
})

describe('what the record must never leak into', () => {
  /**
   * Both exclusions are by OMISSION from an allow-list, which is exactly the
   * kind of decision that survives until someone adds a field to the list
   * without thinking. These fail the build if that happens.
   */
  it('stays out of the saved project', () => {
    const state = useDesignStore.getState()
    expect(Object.keys(persistedFingerprint(state))).not.toContain('imagesSeen')
  })

  it('stays out of the undo snapshot', () => {
    useDesignStore.setState({ imagesSeen: [] })
    useDesignStore.getState().setBlueprint({
      src: 'blob:one',
      fileName: 'first.png',
      width: 474,
      height: 693,
      metresPerPixel: 0.01,
      origin: { x: 0, z: 0 },
      opacity: 0.5,
      visible: true,
      calibration: {
        source: 'none',
        metresPerPixel: 0.01,
        lockedByUser: false,
        setAt: '2026-08-12T00:00:00.000Z',
      },
    })
    expect(useDesignStore.getState().imagesSeen).toHaveLength(1)

    useDesignStore.getState().undo()

    // Undo may restore any amount of design state; what it must not do is
    // un-observe a file the user really did supply.
    expect(useDesignStore.getState().imagesSeen).toHaveLength(1)
  })
})

describe('setBlueprint feeds the record', () => {
  const place = (fileName: string, width: number, height: number, src: string | null) =>
    useDesignStore.getState().setBlueprint({
      src,
      fileName,
      width,
      height,
      metresPerPixel: 0.01,
      origin: { x: 0, z: 0 },
      opacity: 0.5,
      visible: true,
      calibration: {
        source: 'none',
        metresPerPixel: 0.01,
        lockedByUser: false,
        setAt: '2026-08-12T00:00:00.000Z',
      },
    })

  it('records each supplied image, and detects batch 3 through the store', () => {
    useDesignStore.setState({ imagesSeen: [] })
    for (const [i, o] of BATCH_3.entries()) place(o.fileName, o.width, o.height, `blob:${i}`)

    const seen: ImageObservation[] = useDesignStore.getState().imagesSeen
    expect(seen).toHaveLength(4)
    expect(detectFixedAxisTransport(seen)!.axis).toBe('width')
  })

  /**
   * A placement restored from a saved project has no pixels. It is a memory of
   * an image, not an image the user just supplied, and counting it would let a
   * reopened project manufacture a second observation out of a first one.
   */
  it('ignores a pixel-less placement restored from a saved project', () => {
    useDesignStore.setState({ imagesSeen: [] })
    place('remembered.png', 474, 693, null)

    expect(useDesignStore.getState().imagesSeen).toHaveLength(0)
  })

  it('ignores clearing the underlay', () => {
    useDesignStore.setState({ imagesSeen: [] })
    place('one.png', 474, 693, 'blob:a')
    useDesignStore.getState().setBlueprint(null)

    expect(useDesignStore.getState().imagesSeen).toHaveLength(1)
  })
})

/* ─── the loop closed ────────────────────────────────────────────────── */

/**
 * Findings 32 and 33 are both the same defect: a carefully-reasoned, tested
 * mechanism that no production code calls. This suite would be the third if it
 * stopped at the module and the store, so it does not.
 *
 * What matters is not that `detectFixedAxisTransport` returns a signature. It
 * is that a user who has fed in four resized drawings SEES the sentence.
 */
describe('★ the note reaches the panel', () => {
  beforeEach(() => {
    resetStore()
    useDesignStore.setState({ imagesSeen: [], blueprintPanelOpen: true })
  })

  const place = (o: ImageObservation, src: string) =>
    useDesignStore.getState().setBlueprint({
      src,
      fileName: o.fileName,
      width: o.width,
      height: o.height,
      metresPerPixel: 0.01,
      origin: { x: 0, z: 0 },
      opacity: 0.5,
      visible: true,
      calibration: {
        source: 'none',
        metresPerPixel: 0.01,
        lockedByUser: false,
        setAt: '2026-08-12T00:00:00.000Z',
      },
    })

  it('★ shows batch 3 the sentence, naming the width', () => {
    for (const [i, o] of BATCH_3.entries()) place(o, `blob:${i}`)

    render(<BlueprintPanel />)

    const note = screen.getByTestId('blueprint-transport-note')
    expect(note.textContent).toContain('473–474 px wide')
    expect(note.textContent).toContain('The originals will work.')
  })

  /**
   * Asymmetric in: the second image's SHAPE. Same count, same first file, and
   * the only difference is whether the heights agree — which is the half of
   * the rule that keeps this off ordinary work. A fixture with one image could
   * not tell a working check from one wired to nothing.
   */
  it('★ stays silent when the images are simply the same size', () => {
    place(img('a.png', 800, 600), 'blob:a')
    place(img('b.png', 800, 600), 'blob:b')

    render(<BlueprintPanel />)

    expect(screen.queryByTestId('blueprint-transport-note')).toBeNull()
  })
})
