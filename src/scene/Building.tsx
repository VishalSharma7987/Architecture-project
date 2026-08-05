import { useMemo } from 'react'
import {
  allFloors,
  floorElevation,
  useDesignStore,
} from '../store/useDesignStore'
import { DoorLeaves } from './DoorLeaves'
import { FloorSlab } from './FloorSlab'
import { FurnitureModels } from './FurnitureModels'
import { RoomLabels } from './RoomLabels'
import { DimensionLabels } from './DimensionLabels'
import { Stairs } from './Stairs'
import { Walls } from './Walls'

/**
 * The whole building: every storey stacked at its own elevation.
 *
 * What is drawn for every floor and what follows the open one is a deliberate
 * split. Walls and slabs are drawn for all of them, because a first floor
 * hanging over nothing does not read as a building. Everything else — furniture,
 * door leaves, room captions and the stairs — is drawn for the open floor only:
 * three storeys of captions overlap into noise, and a scene showing every
 * floor's furniture cannot be read from outside at all. Storeys other than the
 * open one are ghosted, so the one being edited is the one you see.
 *
 * The open floor's content sits in the same raised group as its walls, so
 * editing the first floor puts its furniture on the first floor rather than
 * leaving it on the ground.
 */
export function Building() {
  const floors = useDesignStore((s) => s.floors)
  const activeFloor = useDesignStore((s) => s.activeFloor)
  const walls = useDesignStore((s) => s.walls)
  const furniture = useDesignStore((s) => s.furniture)
  const roomLabels = useDesignStore((s) => s.roomLabels)
  const stairs = useDesignStore((s) => s.stairs)

  // `allFloors` builds a fresh array each call, so it cannot be a selector:
  // zustand compares snapshots by reference and would re-render every frame it
  // is asked for one. Subscribing to the parts and folding them here is the
  // same answer, computed once per real change.
  const storeys = useMemo(
    () =>
      allFloors({ floors, activeFloor, walls, furniture, roomLabels, stairs }),
    [floors, activeFloor, walls, furniture, roomLabels, stairs],
  )

  return (
    <>
      {storeys.map((floor, index) => {
        const open = index === activeFloor
        return (
          <group key={floor.id} position={[0, floorElevation(index), 0]}>
            <FloorSlab walls={floor.walls} ghost={!open} />
            <Walls walls={floor.walls} ghost={!open} />

            {open && (
              <>
                <FurnitureModels />
                <Stairs />

                {/* Captions are DOM nodes portalled out of the canvas, but drei
                    needs them declared inside the R3F tree to know where to put
                    them — including which storey they belong to. */}
                <RoomLabels />

                {/* Every wall, door and window measurement, behind the
                    Dimensions switch. Sits beside RoomLabels for the same
                    reason — the chips are portalled DOM but must be declared in
                    the tree so drei knows which storey they belong to. */}
                <DimensionLabels />

                {/* Door leaves belong to the building, not to the walkthrough:
                    a 3D view whose doorways are bare holes reads as an
                    unfinished shell. */}
                <DoorLeaves />
              </>
            )}
          </group>
        )
      })}
    </>
  )
}
