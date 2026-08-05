import { useEffect } from 'react'
import { useDesignStore } from '../store/useDesignStore'

/** True when the key event came from somewhere the user is typing. */
function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )
}

/**
 * Deletes the current selection on Delete/Backspace.
 *
 * Ignored while typing — otherwise backspacing inside a height field would
 * delete the very wall being edited.
 */
export function useDeleteShortcut() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (isTextEntry(e.target)) return

      const {
        selection,
        removeWall,
        removeOpening,
        removeFurniture,
        removeStair,
        readOnly,
      } =
        useDesignStore.getState()
      if (!selection || readOnly) return
      // The floor is derived from the walls — there is nothing to delete.
      if (selection.kind === 'floor') return

      // A room is an enclosed space, not an object: deleting it would mean
      // deleting the walls that form it, which is never what Delete means here.
      // Clearing its name is done from the inspector.
      if (selection.kind === 'room') return

      e.preventDefault()
      if (selection.kind === 'stair') {
        removeStair(selection.stairId)
      } else if (selection.kind === 'opening') {
        removeOpening(selection.wallId, selection.openingId)
      } else if (selection.kind === 'furniture') {
        removeFurniture(selection.furnitureId)
      } else {
        removeWall(selection.wallId)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
