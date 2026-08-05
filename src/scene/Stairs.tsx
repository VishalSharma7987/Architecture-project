import type { ThreeEvent } from '@react-three/fiber'
import {
  FLOOR_HEIGHT,
  STAIR_DEFAULTS,
  useDesignStore,
  type Stair,
} from '../store/useDesignStore'
import { SELECTION, SLAB } from './config'

/** Concrete-ish, so a flight reads as structure rather than as furniture. */
const TREAD_COLOR = '#c9ced7'

/**
 * Steps that carry one storey, in metres.
 *
 * The riser count is not a choice: a flight has to arrive exactly on the floor
 * above, so take the nearest whole number of risers at the preferred rise and
 * then divide the storey height by that count. `STAIR_DEFAULTS.riserHeight` is
 * therefore a target, and the rise actually built is a little under or over it.
 *
 * The last riser steps onto the floor above, whose slab is the top landing, so
 * the flight itself draws one tread fewer than it has risers — and those treads
 * share out the whole `run`, which is what keeps the 3D footprint identical to
 * the run x width rectangle the plan symbol draws, tread lines included.
 */
function flightSteps(run: number) {
  const risers = Math.max(
    2,
    Math.round(FLOOR_HEIGHT / STAIR_DEFAULTS.riserHeight),
  )
  const treads = risers - 1
  return { risers, treads, rise: FLOOR_HEIGHT / risers, going: run / treads }
}

/**
 * Every staircase on the open floor, as a real flight of treads rising from
 * this floor's level to the next one's.
 *
 * Drawn for the open floor only. A flight already spans two storeys, so drawing
 * every floor's would put a second flight inside the shaft of the first one
 * wherever a plan repeats — and the store deliberately does not copy stairs up
 * for the same reason.
 */
export function Stairs() {
  const stairs = useDesignStore((s) => s.stairs)
  const selection = useDesignStore((s) => s.selection)
  const readOnly = useDesignStore((s) => s.readOnly)

  return (
    <group>
      {stairs.map((stair) => (
        <Flight
          key={stair.id}
          stair={stair}
          selected={
            selection?.kind === 'stair' && selection.stairId === stair.id
          }
          interactive={!readOnly}
        />
      ))}
    </group>
  )
}

type FlightProps = {
  stair: Stair
  selected: boolean
  interactive: boolean
}

function Flight({ stair, selected, interactive }: FlightProps) {
  const { treads, rise, going } = flightSteps(stair.run)

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!interactive) return
    event.stopPropagation()
    useDesignStore.getState().select({ kind: 'stair', stairId: stair.id })
  }

  return (
    // Local +Z is the foot of the flight and -Z its head, so an unrotated
    // stair ascends toward -z — the convention `Stair.rotation` documents.
    // Positioned on SLAB.top like furniture, inside whichever storey group
    // the caller has raised to this floor's elevation.
    <group
      position={[stair.position.x, SLAB.top, stair.position.z]}
      rotation-y={stair.rotation}
      onClick={handleClick}
    >
      {Array.from({ length: treads }, (_, index) => {
        const step = index + 1
        const height = step * rise
        return (
          <mesh
            key={step}
            // Solid from the floor up rather than a floating slab: a closed
            // flight needs no separate risers or stringers to read right, and
            // it gives the shadow pass something honest to work with.
            position={[0, height / 2, stair.run / 2 - (step - 0.5) * going]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[stair.width, height, going]} />
            <meshStandardMaterial
              color={selected ? SELECTION.color3d : TREAD_COLOR}
              emissive={selected ? SELECTION.emissive : '#000000'}
              emissiveIntensity={selected ? 0.3 : 0}
              roughness={0.8}
              metalness={0}
            />
          </mesh>
        )
      })}
    </group>
  )
}
