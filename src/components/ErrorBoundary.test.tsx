import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'
import {
  AUTOSAVE_KEY,
  bootCompleted,
  bootStarted,
  lastBootFailed,
  writeAutosave,
} from '../persistence/storage'
import { serializeDesign } from '../persistence/schema'
import { rectangleWalls, resetStore } from '../test/fixtures'
import { useDesignStore } from '../store/useDesignStore'

/**
 * The app had no error boundary at all — the only one in the codebase guards
 * the walkthrough figure. A throw during render in any panel therefore
 * unmounted the whole tree to a white screen, with no message and no way to
 * get the user's work out. Autosave had already persisted the document that
 * caused it, and the restore path loads it again on boot, so a document that
 * crashed a render crashed every subsequent one: a permanent boot loop.
 */

function Boom(): never {
  throw new Error('render exploded')
}

/** React logs caught errors to console.error; that is expected here. */
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  resetStore()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  // Explicit: this suite renders, and without it the previous case's recovery
  // screen is still in the document when the next one queries by test id.
  cleanup()
  consoleError.mockRestore()
  vi.restoreAllMocks()
  localStorage.clear()
  resetStore()
})

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>the app</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('the app')).toBeDefined()
    expect(screen.queryByTestId('crash-recovery')).toBeNull()
  })

  it('★ shows a recovery screen instead of a blank page when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('crash-recovery')).toBeDefined()
  })

  it('★ offers to export the work that was open', () => {
    useDesignStore.setState({ walls: rectangleWalls() })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    screen.getByTestId('crash-export').click()

    expect(click, 'the user must be able to get their design out').toHaveBeenCalled()
  })

  it('★ discarding the draft clears it, so the next boot cannot reload the crash', () => {
    writeAutosave({
      name: 'Villa',
      doc: serializeDesign({ name: 'Villa', viewMode: '2d', walls: rectangleWalls() }),
    })
    expect(localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull()

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    screen.getByTestId('crash-discard').click()

    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull()
  })

  it('names the failure rather than hiding it', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('crash-detail').textContent).toContain('render exploded')
  })
})

/**
 * ★ The boot guard is what turns "one bad render" back into "one bad session".
 *
 * A flag is raised before a draft is restored and lowered only once the app has
 * mounted. React runs effects only after the whole tree commits, so a throw
 * during render leaves it raised — and the next boot can see that the last one
 * never finished.
 */
describe('★ boot guard', () => {
  it('reports a boot that never completed', () => {
    bootStarted()
    expect(lastBootFailed()).toBe(true)
  })

  it('reports nothing after a boot that completed', () => {
    bootStarted()
    bootCompleted()
    expect(lastBootFailed()).toBe(false)
  })

  it('is clear on a first run', () => {
    expect(lastBootFailed()).toBe(false)
  })

  it('survives the reload it exists to catch', () => {
    bootStarted()
    // A reload is a fresh module in the same origin: only storage carries over.
    expect(lastBootFailed()).toBe(true)
    // And the next boot, having declined to restore, clears it so a genuine
    // one-off crash does not lock the draft out forever.
    bootCompleted()
    expect(lastBootFailed()).toBe(false)
  })
})
