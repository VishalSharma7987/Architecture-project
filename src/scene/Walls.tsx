import { useEffect, useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { BoxGeometry, MeshStandardMaterial } from 'three'
import { useDesignStore, type Wall } from '../store/useDesignStore'
import {
  DEFAULT_WALL_MATERIAL,
  getMaterial,
  tiledTexture,
} from '../materials/palette'
import { SELECTION, WALL } from './config'
import {
  openingBoxes,
  projectOntoWall,
  wallPieces,
  type WallPiece,
} from './wallGeometry'

/**
 * How far back a storey other than the open one fades. Low enough to see the
 * floor being edited through the one above it, high enough that the storey
 * still reads as an enclosure rather than a haze.
 */
const GHOST_OPACITY = 0.22

type WallsProps = {
  /**
   * The walls to draw. Defaults to the open floor's, so a plain `<Walls />`
   * keeps meaning exactly what it meant before there were storeys.
   */
  walls?: Wall[]
  /**
   * Draw as a storey the user is not editing: pale, see-through, unselectable
   * and out of the shadow pass.
   */
  ghost?: boolean
}

/**
 * Renders a set of walls, each sliced into the solid pieces left around its
 * openings. All pieces share one unit-cube geometry and are sized by per-mesh
 * scale, so a wall costs draw calls rather than geometry allocations.
 */
export function Walls({ walls, ghost = false }: WallsProps) {
  const openWalls = useDesignStore((s) => s.walls)
  const selection = useDesignStore((s) => s.selection)
  const drawn = walls ?? openWalls

  const unitBox = useMemo(() => new BoxGeometry(1, 1, 1), [])
  useEffect(() => () => unitBox.dispose(), [unitBox])

  /**
   * Ghost storeys share one flat material. Their textures would be invisible at
   * this opacity and would cost a canvas per piece to build, and `depthWrite:
   * false` stops the pieces of one storey cutting holes in each other where
   * they meet at corners.
   */
  const ghostMaterial = useMemo(
    () =>
      ghost
        ? new MeshStandardMaterial({
            color: WALL.color,
            roughness: WALL.roughness,
            metalness: WALL.metalness,
            transparent: true,
            opacity: GHOST_OPACITY,
            depthWrite: false,
          })
        : null,
    [ghost],
  )
  useEffect(() => () => ghostMaterial?.dispose(), [ghostMaterial])

  return (
    <group>
      {drawn.map((wall) => (
        <WallMesh
          key={wall.id}
          wall={wall}
          geometry={unitBox}
          ghost={ghostMaterial}
          // Only the wall itself lights up for a wall selection. When an opening
          // is selected, its own pick box highlights instead — lighting the
          // whole wall would read as the wall being selected, not the door.
          selected={
            !ghost && selection?.kind === 'wall' && selection.wallId === wall.id
          }
          // The opening on this wall that is currently selected, if any, so its
          // pick box can highlight. Never on a ghost storey.
          selectedOpeningId={
            !ghost &&
            selection?.kind === 'opening' &&
            selection.wallId === wall.id
              ? selection.openingId
              : undefined
          }
        />
      ))}
    </group>
  )
}

type WallMeshProps = {
  wall: Wall
  geometry: BoxGeometry
  /** Non-null on a receding storey, and then the only material used. */
  ghost: MeshStandardMaterial | null
  selected: boolean
  /** Id of this wall's selected opening, when one is selected. */
  selectedOpeningId?: string
}

function WallMesh({
  wall,
  geometry,
  ghost,
  selected,
  selectedOpeningId,
}: WallMeshProps) {
  const pieces = useMemo(() => wallPieces(wall), [wall])
  const openings = useMemo(() => openingBoxes(wall), [wall])

  /**
   * One material per piece, with the texture tiled to that piece's real size.
   * Cloned textures share the underlying canvas, so this is cheap — and it is
   * what stops a 6 m wall from stretching the same brick image as a 1 m one.
   */
  const materials = useMemo(() => {
    // A receding storey never shows them, and a texture it cannot show is a
    // canvas allocated per piece for nothing.
    if (ghost) return []
    const def = getMaterial(wall.material, DEFAULT_WALL_MATERIAL)
    return pieces.map((piece: WallPiece) => {
      const map = tiledTexture(def, piece.scale[0], piece.scale[1])
      return new MeshStandardMaterial({
        color: def.color,
        roughness: def.roughness,
        metalness: def.metalness,
        map,
      })
    })
  }, [ghost, pieces, wall.material])

  useEffect(
    () => () =>
      materials.forEach((material) => {
        material.map?.dispose()
        material.dispose()
      }),
    [materials],
  )

  // Highlighting swaps the material rather than tinting it, so the selected
  // colour is not multiplied by whatever texture the wall happens to carry.
  const highlight = useMemo(
    () =>
      new MeshStandardMaterial({
        color: SELECTION.color3d,
        emissive: SELECTION.emissive,
        emissiveIntensity: 0.35,
        roughness: 0.8,
      }),
    [],
  )
  useEffect(() => () => highlight.dispose(), [highlight])

  /**
   * The pick box for an opening, in its two states.
   *
   * `pick` is fully transparent and writes no depth — invisible, and it does
   * not occlude the view through the doorway — but a visible mesh still
   * raycasts, so it is a click target sitting in the gap. `openingHighlight`
   * is the same box shown as a translucent panel once selected, so you can see
   * which door or window you picked.
   */
  const [pick, openingHighlight] = useMemo(
    () => [
      new MeshStandardMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
      // Emissive-heavy and fairly opaque: an opening is a see-through gap, so a
      // faint tint washes out against the interior behind it. This reads as a
      // lit blue panel filling the doorway — clearly "this one is selected".
      new MeshStandardMaterial({
        color: SELECTION.color3d,
        emissive: SELECTION.emissive,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    ],
    [],
  )
  useEffect(
    () => () => {
      pick.dispose()
      openingHighlight.dispose()
    },
    [pick, openingHighlight],
  )

  const selectOpening =
    (openingId: string) => (event: ThreeEvent<MouseEvent>) => {
      // Stop the click reaching the wall group behind, which would select the
      // wall instead of the opening in it.
      event.stopPropagation()
      const { select, readOnly } = useDesignStore.getState()
      if (readOnly) return
      select({ kind: 'opening', wallId: wall.id, openingId })
    }

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    // Without this the click also reaches walls behind this one.
    event.stopPropagation()

    const { tool, select, addOpening, setTool, readOnly } =
      useDesignStore.getState()
    if (readOnly) return

    if (tool === 'door' || tool === 'window') {
      // Place the opening where the click actually landed on the wall.
      const { t } = projectOntoWall(wall, {
        x: event.point.x,
        z: event.point.z,
      })
      const openingId = addOpening(wall.id, tool, t)
      if (openingId) {
        select({ kind: 'opening', wallId: wall.id, openingId })
        // Back to Select, so the next click edits this opening rather than
        // dropping another one on the same wall — matching the plan view.
        setTool('select')
      } else {
        select({ kind: 'wall', wallId: wall.id })
      }
      return
    }

    select({ kind: 'wall', wallId: wall.id })
  }

  return (
    // A ghost storey takes no clicks: its wall ids belong to a floor that is
    // not checked out, so selecting one would name something nothing can edit.
    <group onClick={ghost ? undefined : handleClick}>
      {pieces.map((piece, index) => (
        <mesh
          key={piece.key}
          geometry={geometry}
          material={ghost ?? (selected ? highlight : materials[index])}
          position={piece.position}
          rotation-y={piece.rotationY}
          scale={piece.scale}
          // Out of the shadow pass entirely when ghosted: the shadow map has no
          // notion of opacity, so a see-through storey would otherwise throw a
          // solid shadow across the floor being edited.
          castShadow={!ghost}
          receiveShadow={!ghost}
        />
      ))}

      {/* Click targets for the openings — a ghost storey's are not editable,
          so it gets none. */}
      {!ghost &&
        openings.map((box) => (
          <mesh
            key={box.openingId}
            geometry={geometry}
            material={box.openingId === selectedOpeningId ? openingHighlight : pick}
            position={box.position}
            rotation-y={box.rotationY}
            scale={box.scale}
            onClick={selectOpening(box.openingId)}
          />
        ))}
    </group>
  )
}
