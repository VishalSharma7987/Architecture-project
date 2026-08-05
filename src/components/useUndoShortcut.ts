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
 * Undo/redo on the usual shortcuts: ⌘Z / Ctrl+Z to undo, ⇧⌘Z or Ctrl+Y to redo.
 *
 * Ignored while typing, so ⌘Z inside a dimension field is the browser's own
 * text undo, not a step back through the whole design. Ignored in read-only
 * (shared) mode, where there is nothing of the viewer's to undo.
 */
export function useUndoShortcut() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'z' && e.key !== 'Z' && e.key !== 'y' && e.key !== 'Y') return
      if (!(e.metaKey || e.ctrlKey)) return
      if (isTextEntry(e.target)) return

      const { undo, redo, readOnly } = useDesignStore.getState()
      if (readOnly) return

      const wantsRedo =
        e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))

      e.preventDefault()
      if (wantsRedo) redo()
      else undo()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
