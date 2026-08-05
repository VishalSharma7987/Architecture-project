import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useDesignStore, allFloors } from '../store/useDesignStore'
import { planBounds } from './wallGeometry'

/**
 * Points the camera at the whole building whenever the design is replaced.
 *
 * Without this the camera sits at a fixed spot and orbits the world origin, so a
 * large imported plan lands half out of frame and rotating it feels like the
 * building is pinned in place — you are circling a point that is not its centre.
 * Fitting on `viewEpoch` (bumped on every load, import and floor switch) frames
 * the building and sets the orbit pivot to its middle, so a drag turns the
 * whole thing in view.
 */
export function FrameBuilding() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const viewEpoch = useDesignStore((s) => s.viewEpoch)

  useEffect(() => {
    // Measure every storey, not just the open one, so a two-floor building is
    // framed by its full extent.
    const floors = allFloors(useDesignStore.getState())
    const walls = floors.flatMap((floor) => floor.walls)
    const bounds = planBounds(walls)
    if (!bounds || !controls) return

    const span = Math.max(bounds.width, bounds.depth, 4)
    // Back off proportional to the building's size and drop the eye to a
    // three-quarter height, which reads as a room rather than a map.
    const distance = span * 1.15 + 6
    const center = bounds.center

    controls.target.set(center.x, 0, center.z)
    camera.position.set(
      center.x + distance * 0.8,
      distance * 0.75,
      center.z + distance * 0.8,
    )
    // A big plan can exceed the default zoom-out limit; let the camera sit far
    // enough back to hold the whole thing.
    controls.maxDistance = Math.max(controls.maxDistance, distance * 2)
    controls.update()
  }, [viewEpoch, camera, controls])

  return null
}
