import { useEffect, useState } from 'react'
import { useDesignStore } from '../store/useDesignStore'

/**
 * The only chrome present mode shows: the design's name, and an exit
 * affordance that appears on mouse movement.
 *
 * Movement and look-around instructions are deliberately NOT repeated here —
 * the walk overlay in SceneCanvas already shows them, and two overlays saying
 * the same thing is worse than one. This adds only what that one lacks: what
 * you are looking at, and the way out.
 */
export function PresentOverlay() {
  const setPresentMode = useDesignStore((s) => s.setPresentMode)
  const projectName = useDesignStore((s) => s.projectName)

  const [showExit, setShowExit] = useState(true)

  // Reveal the exit button whenever the pointer moves, then hide it again.
  useEffect(() => {
    let timer: number | undefined
    const onMove = () => {
      setShowExit(true)
      clearTimeout(timer)
      timer = window.setTimeout(() => setShowExit(false), 2500)
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      clearTimeout(timer)
    }
  }, [])

  // Escape releases pointer lock; a second press leaves present mode.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.pointerLockElement) {
        setPresentMode(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setPresentMode])

  return (
    <>
      <button
        type="button"
        onClick={() => setPresentMode(false)}
        data-testid="exit-present"
        className={`absolute right-5 top-5 z-20 rounded-lg bg-white/85 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur transition-opacity hover:bg-white ${
          showExit ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Exit presentation
      </button>

      {projectName && (
        <div
          className={`pointer-events-none absolute left-5 top-5 z-20 rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur transition-opacity ${
            showExit ? 'opacity-100' : 'opacity-0'
          }`}
          data-testid="present-title"
        >
          {projectName}
        </div>
      )}
    </>
  )
}
