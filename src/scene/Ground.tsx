import { Grid } from '@react-three/drei'
import { GRID, GROUND } from './config'

/**
 * The floor of the workspace: a solid plane that catches shadows, with an
 * infinite reference grid floating just above it.
 *
 * The plane sits at y = 0, so anything placed later can rest at y = 0 too.
 */
export function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[GROUND.size, GROUND.size]} />
        <meshStandardMaterial color={GROUND.color} roughness={1} metalness={0} />
      </mesh>

      <Grid
        position={[0, GROUND.gridOffsetY, 0]}
        infiniteGrid
        cellSize={GRID.cellSize}
        cellThickness={GRID.cellThickness}
        cellColor={GRID.cellColor}
        sectionSize={GRID.sectionSize}
        sectionThickness={GRID.sectionThickness}
        sectionColor={GRID.sectionColor}
        fadeDistance={GRID.fadeDistance}
        fadeStrength={GRID.fadeStrength}
      />
    </group>
  )
}
