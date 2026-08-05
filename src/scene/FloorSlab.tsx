import { useEffect, useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { MeshStandardMaterial } from 'three'
import { useDesignStore, type Wall } from '../store/useDesignStore'
import {
  DEFAULT_FLOOR_MATERIAL,
  getMaterial,
  tiledTexture,
} from '../materials/palette'
import { SELECTION } from './config'
import { SLAB } from './config'
import { planBounds } from './wallGeometry'

/**
 * A slab seen face-on covers far more of the frame than a wall does, so it
 * fades further back than `Walls` does to keep the storey below legible.
 */
const GHOST_OPACITY = 0.16

type FloorSlabProps = {
  /**
   * The walls whose extents the slab is sized to. Defaults to the open
   * floor's, so a plain `<FloorSlab />` means what it always meant.
   */
  walls?: Wall[]
  /** Draw as a storey the user is not editing — see `Walls`. */
  ghost?: boolean
}

/**
 * A solid floor under a storey's layout, sized to the plan's extents plus a
 * margin. Renders nothing until there are walls — with no layout there is no
 * footprint to slab, and the infinite reference grid already reads as ground.
 */
export function FloorSlab({ walls, ghost = false }: FloorSlabProps) {
  const openWalls = useDesignStore((s) => s.walls)
  const floorMaterial = useDesignStore((s) => s.floorMaterial)
  const floorSelected = useDesignStore((s) => s.selection?.kind === 'floor')

  const drawn = walls ?? openWalls
  const selected = floorSelected && !ghost

  const bounds = useMemo(() => planBounds(drawn), [drawn])

  const width = bounds ? bounds.width + SLAB.margin * 2 : 0
  const depth = bounds ? bounds.depth + SLAB.margin * 2 : 0

  const material = useMemo(() => {
    const def = getMaterial(floorMaterial, DEFAULT_FLOOR_MATERIAL)
    if (ghost) {
      return new MeshStandardMaterial({
        color: SLAB.color,
        roughness: def.roughness,
        metalness: 0,
        transparent: true,
        opacity: GHOST_OPACITY,
        // Without this the slab above hides whatever of this storey's ghost
        // walls happens to be drawn after it.
        depthWrite: false,
      })
    }
    return new MeshStandardMaterial({
      color: selected ? SELECTION.color3d : def.color,
      emissive: selected ? SELECTION.emissive : '#000000',
      emissiveIntensity: selected ? 0.25 : 0,
      roughness: def.roughness,
      metalness: def.metalness,
      // Tiled against the slab's real dimensions so planks stay plank-sized
      // no matter how large the building is.
      map: selected ? null : tiledTexture(def, width, depth),
    })
  }, [ghost, floorMaterial, selected, width, depth])

  useEffect(
    () => () => {
      material.map?.dispose()
      material.dispose()
    },
    [material],
  )

  if (!bounds) return null

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const { readOnly, select } = useDesignStore.getState()
    if (readOnly) return
    select({ kind: 'floor' })
  }

  return (
    <mesh
      position={[
        bounds.center.x,
        // Box is centred on its origin, so drop it half its thickness to put
        // the top face exactly at SLAB.top — the height walls stand on.
        SLAB.top - SLAB.thickness / 2,
        bounds.center.z,
      ]}
      material={material}
      // The floor material is a property of the whole design, so only the
      // storey being edited answers a click on it — picking one off a ghost
      // would look like editing a floor that is not open.
      onClick={ghost ? undefined : handleClick}
      receiveShadow={!ghost}
    >
      <boxGeometry args={[width, SLAB.thickness, depth]} />
    </mesh>
  )
}
