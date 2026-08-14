import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomSchedulePanel } from './RoomSchedulePanel'
import { downloadAreaStatementPdf } from '../export/documents'
import { resetStore } from '../test/fixtures'
import {
  emptyFloor,
  useDesignStore,
  type Opening,
  type OpeningType,
  type Wall,
} from '../store/useDesignStore'

/**
 * B24 — the schedule as the user and the builder actually receive it.
 *
 * `schedule.test.ts` covers the grouping rule. This covers the two places it
 * has to arrive: the panel, and the PDF a joiner quotes from. Both matter
 * separately — a correct derivation that reaches neither is a feature nobody
 * has.
 */

let counter = 0
function opening(patch: Partial<Opening> & { type?: OpeningType } = {}): Opening {
  return {
    id: `o${++counter}`,
    type: 'door',
    position: 1,
    width: 0.9,
    height: 2.1,
    sill: 0,
    ...patch,
  }
}

function wallOf(...openings: Opening[]): Wall {
  return {
    id: 'w1',
    start: { x: 0, z: 0 },
    end: { x: 20, z: 0 },
    height: 3,
    thickness: 0.2,
    openings,
    material: 'white-paint',
    type: 'shell' as const,
  }
}

/** Opens the panel over one wall carrying these openings. */
function showPanel(...openings: Opening[]) {
  const wall = wallOf(...openings)
  useDesignStore.setState({
    walls: [wall],
    roomPanelOpen: true,
    floors: [{ ...emptyFloor(0), walls: [wall] }, emptyFloor(1), emptyFloor(2)],
    activeFloor: 0,
  })
  render(<RoomSchedulePanel />)
}

beforeEach(resetStore)
afterEach(() => {
  vi.restoreAllMocks()
  resetStore()
})

describe('★ B24 — the panel', () => {
  it('★ shows one row per mark, with its count', () => {
    showPanel(
      opening({ mark: 'D1', position: 2 }),
      opening({ mark: 'D1', position: 6 }),
      opening({ mark: 'MD', position: 10, width: 1.2 }),
    )

    expect(screen.getByTestId('schedule-D1').textContent).toContain('x2')
    expect(screen.getByTestId('schedule-MD').textContent).toContain('x1')
    // The section header counts OPENINGS, not rows — three openings, two marks.
    expect(screen.getByTestId('opening-schedule').textContent).toContain(
      'Doors & windows (3)',
    )
  })

  /**
   * ★ The conflict presentation, asserted as REACHED.
   *
   * The control is the second row in the SAME render: `D1` carries
   * `data-conflict="true"` and `W2` carries `"false"`. Asserting only that the
   * bad row is flagged would pass equally against a build that flagged every
   * row, and asserting only that a warning string appears would pass against
   * one that printed it unconditionally.
   */
  it('★ flags a conflicting mark, and leaves a clean one alone', () => {
    showPanel(
      opening({ mark: 'D1', position: 2, width: 0.9 }),
      opening({ mark: 'D1', position: 6, width: 1.05 }),
      opening({ mark: 'W2', position: 10, type: 'window', sill: 0.9, width: 1.2 }),
      opening({ mark: 'W2', position: 14, type: 'window', sill: 0.9, width: 1.2 }),
    )

    const conflicted = screen.getByTestId('schedule-D1')
    const clean = screen.getByTestId('schedule-W2')

    expect(conflicted.getAttribute('data-conflict')).toBe('true')
    expect(clean.getAttribute('data-conflict')).toBe('false')

    // Both sizes are on screen — you cannot fix a mark conflict without being
    // told what the values are. Neither collapsed nor split into two rows.
    expect(conflicted.textContent).toContain('not the same unit')
    expect(screen.queryAllByTestId('schedule-D1')).toHaveLength(1)
    // And the clean row says nothing of the sort.
    expect(clean.textContent).not.toContain('not the same unit')
  })

  it('accounts for unmarked openings rather than dropping them', () => {
    showPanel(opening({ mark: 'D1' }), opening({ position: 6 }))

    expect(screen.getByTestId('schedule-unmarked').textContent).toContain('x1')
    expect(screen.getByTestId('schedule-unmarked').textContent).toContain('No mark')
    // Never flagged: an unmarked opening claims nothing, so it cannot be wrong.
    expect(
      screen.getByTestId('schedule-unmarked').getAttribute('data-conflict'),
    ).toBe('false')
  })

  it('renders no schedule section when there are no openings', () => {
    showPanel()
    expect(screen.queryByTestId('opening-schedule')).toBeNull()
  })
})

describe('★ B24 — the PDF', () => {
  /**
   * ★ End to end through the real writer, not through the block builder.
   *
   * `scheduleBlocks` being correct proves nothing about whether anything calls
   * it — which is the failure mode SD14 exists for. So this drives
   * `downloadAreaStatementPdf`, captures the Blob it hands to
   * `URL.createObjectURL`, and reads the bytes the way `pdf.test.ts` does.
   *
   * Demonstrated red (SD5) by leaving `scheduleBlocks` in place but never
   * calling it: `expected '%PDF-1.4\n%âãÏÓ\n1 0 obj…' to contain 'Door &
   * Window Schedule'`. A correct block builder that nothing invokes is
   * precisely the failure SD14 was written about, and only an end-to-end
   * assertion catches it.
   */
  it('★ carries the schedule into the emitted bytes', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      blobs.push(blob as Blob)
      return 'blob:test'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const wall = wallOf(
      opening({ mark: 'MD', position: 2, width: 1.2 }),
      opening({ mark: 'MD', position: 6, width: 1.2 }),
      opening({ position: 10 }),
    )

    await downloadAreaStatementPdf({
      projectName: 'Plot 22',
      floors: [{ ...emptyFloor(0), walls: [wall] }],
      plot: null,
      northOffset: 0,
      plotFacing: 'N',
      constructionRate: 0,
      units: 'm',
      date: '2026-08-10T00:00:00.000Z',
    })

    expect(blobs).toHaveLength(1)
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    // Every byte the writer emits is a latin1 code unit — `pdf.test.ts`'s
    // own decoding.
    const text = new TextDecoder('latin1').decode(bytes)

    expect(text).toContain('Door & Window Schedule')
    // Not the whole heading: it contains an em dash, which `pdf.ts`
    // transliterates to WinAnsi 0x97 — a byte that decodes as a control
    // character, not as '-'. Asserting across it tests the transliteration
    // rather than the schedule.
    expect(text).toContain('doors & windows')
    expect(text).toContain('MD')
    // The count reached the table, so the grouping survived the trip.
    expect(text).toContain('unmarked')
  })
})
