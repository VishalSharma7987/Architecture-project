import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { useDesignStore, type Opening, type Wall } from '../store/useDesignStore'
import { avatarState } from './avatarState'
import { DOOR, SLAB } from './config'
import { doorSwing, pointAlongWall, wallAxis } from './wallGeometry'
import { clampDelta } from './walkMotion'

/** Handle position on the leaf: this far along it, at this height in metres. */
const HANDLE_ALONG = 0.9
const HANDLE_Y = 1.02
const HANDLE_LEN = 0.11
const HANDLE_T = 0.028

/**
 * Swinging door leaves, one per `door` opening in the plan.
 *
 * These are pure decoration: `wallColliders` deliberately treats a doorway as a
 * hole you can walk through, and nothing here feeds back into it. A leaf that
 * blocked movement would trap the figure the moment it half-closed behind them.
 */
export function DoorLeaves() {
  const walls = useDesignStore((s) => s.walls)
  // A figure parked for scale is not walking anywhere, and a door standing
  // permanently open because someone happens to be stood near it just reads
  // as a door that will not shut.
  const live = useDesignStore((s) => s.walkMode)

  return (
    <group>
      {walls.flatMap((wall) =>
        wall.openings
          .filter((opening) => opening.type === 'door')
          .map((opening) => (
            <DoorLeaf
              key={opening.id}
              wall={wall}
              opening={opening}
              live={live}
            />
          )),
      )}
    </group>
  )
}

type DoorLeafProps = {
  wall: Wall
  opening: Opening
  /** Whether the figure is under the user's control and worth reacting to. */
  live: boolean
}

function DoorLeaf({ wall, opening, live }: DoorLeafProps) {
  const pivot = useRef<Group>(null)
  const angle = useRef(0)

  const leaf = useMemo(() => {
    const { length } = wallAxis(wall)
    const t0 = Math.max(0, opening.position - opening.width / 2)
    const t1 = Math.min(length, opening.position + opening.width / 2)
    // Hinge, leaf axis and swing direction all come from the model. This used
    // to hinge at t0 unconditionally and pick the DIRECTION at runtime from the
    // avatar's position — so the same saved plan rendered with the door
    // swinging either way depending on which side you approached from. See
    // `doorSwing`, and B21 in STATE.md.
    const swing = doorSwing(wall, opening)

    return {
      width: t1 - t0,
      height: Math.min(opening.height, wall.height - opening.sill),
      hinge: swing.hinge,
      centre: pointAlongWall(wall, (t0 + t1) / 2),
      /** Puts the group's local +X on the leaf axis, hinge → free jamb. */
      rotationY: swing.rotationY,
      /**
       * A positive Y rotation carries local +X toward local -Z, which is the
       * `sweep: +1` direction — so the model's sweep IS the sign of the angle.
       */
      sweep: swing.sweep,
    }
  }, [wall, opening])

  useFrame((_, rawDelta) => {
    const hinged = pivot.current
    if (!hinged) return

    const delta = clampDelta(rawDelta)
    const dx = avatarState.x - leaf.centre.x
    const dz = avatarState.z - leaf.centre.z
    // The figure still decides WHETHER the door opens. It no longer decides
    // WHICH WAY — that is an architectural fact and it lives in the document.
    const near = live && Math.hypot(dx, dz) < DOOR.triggerRadius

    const target = near ? DOOR.openAngle * leaf.sweep : 0
    const remaining = target - angle.current
    const step = DOOR.swingSpeed * delta
    angle.current =
      Math.abs(remaining) <= step
        ? target
        : angle.current + Math.sign(remaining) * step

    hinged.rotation.y = angle.current
  })

  if (leaf.width <= 0 || leaf.height <= 0) return null

  return (
    <group
      position={[leaf.hinge.x, SLAB.top + opening.sill, leaf.hinge.z]}
      rotation-y={leaf.rotationY}
    >
      {/* The outer group puts the origin on the hinge and aligns local +X with
          the wall, so the leaf at rest exactly fills the opening and rotating
          this inner group sweeps it into the room. */}
      <group ref={pivot}>
        <mesh
          position={[leaf.width / 2, leaf.height / 2, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[leaf.width, leaf.height, DOOR.leafThickness]} />
          <meshStandardMaterial
            color={DOOR.color}
            roughness={0.6}
            metalness={0}
          />
        </mesh>
        <mesh
          position={[
            leaf.width * HANDLE_ALONG,
            Math.min(HANDLE_Y, leaf.height * 0.55),
            0,
          ]}
          castShadow
        >
          {/* Runs through the leaf, so there is a handle on both faces. */}
          <boxGeometry
            args={[HANDLE_LEN, HANDLE_T, DOOR.leafThickness + HANDLE_T * 3]}
          />
          <meshStandardMaterial
            color={DOOR.handle}
            roughness={0.35}
            metalness={0.6}
          />
        </mesh>
      </group>
    </group>
  )
}
