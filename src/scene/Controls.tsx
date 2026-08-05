import { OrbitControls } from '@react-three/drei'
import { CONTROLS } from './config'

type ControlsProps = {
  /** Fires when the user begins a rotate/pan drag — a real interaction. */
  onStart?: () => void
}

/**
 * Mouse navigation for the workspace.
 *
 *   left drag  — orbit
 *   right drag — pan
 *   wheel      — zoom
 *
 * Damping is on, so the camera glides to a stop instead of snapping.
 */
export function Controls({ onStart }: ControlsProps) {
  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={CONTROLS.dampingFactor}
      maxPolarAngle={CONTROLS.maxPolarAngle}
      minDistance={CONTROLS.minDistance}
      maxDistance={CONTROLS.maxDistance}
      // Pan across the floor rather than across the camera plane — this is what
      // makes dragging feel like sliding the room around, not the camera.
      screenSpacePanning={false}
      onStart={onStart}
    />
  )
}
