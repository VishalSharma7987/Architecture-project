import type { ThreeEvent } from '@react-three/fiber'
import {
  FURNITURE_COLORS,
  furnitureSize,
  getFurniture,
  type FurnitureType,
} from '../furniture/catalog'
import { useDesignStore, type FurnitureItem } from '../store/useDesignStore'
import { SELECTION } from './config'
import { SLAB } from './config'

/**
 * Furniture as simple box compositions.
 *
 * Deliberately primitive geometry rather than loaded models: no asset files to
 * fetch, no licences to track, and the pieces read clearly at plan scale. They
 * exist to give the walkthrough a sense of scale, not to be catalogue-accurate.
 */
export function FurnitureModels() {
  const furniture = useDesignStore((s) => s.furniture)
  const selection = useDesignStore((s) => s.selection)
  const readOnly = useDesignStore((s) => s.readOnly)

  return (
    <group>
      {furniture.map((item) => (
        <Piece
          key={item.id}
          item={item}
          selected={
            selection?.kind === 'furniture' && selection.furnitureId === item.id
          }
          interactive={!readOnly}
        />
      ))}
    </group>
  )
}

type PieceProps = {
  item: FurnitureItem
  selected: boolean
  interactive: boolean
}

function Piece({ item, selected, interactive }: PieceProps) {
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!interactive) return
    event.stopPropagation()
    useDesignStore
      .getState()
      .select({ kind: 'furniture', furnitureId: item.id })
  }

  const size = furnitureSize(item)

  return (
    <group
      position={[item.position.x, SLAB.top, item.position.z]}
      rotation-y={item.rotation}
      onClick={handleClick}
    >
      <Model
        type={item.type}
        width={size.width}
        depth={size.depth}
        selected={selected}
      />
    </group>
  )
}

/** Shared box helper — every piece is built from these. */
function Box({
  size,
  position,
  color,
  selected,
  roughness = 0.7,
}: {
  size: [number, number, number]
  position: [number, number, number]
  color: string
  selected: boolean
  roughness?: number
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={selected ? SELECTION.color3d : color}
        emissive={selected ? SELECTION.emissive : '#000000'}
        emissiveIntensity={selected ? 0.3 : 0}
        roughness={roughness}
        metalness={0}
      />
    </mesh>
  )
}

function Model({
  type,
  width,
  depth,
  selected,
}: {
  type: FurnitureType
  width: number
  depth: number
  selected: boolean
}) {
  // Height stays the catalogue's; only the footprint (width × depth) is
  // resizable, so a stretched sofa keeps a sofa's height.
  const def = { ...getFurniture(type), width, depth }
  const c = FURNITURE_COLORS

  switch (type) {
    case 'table':
    case 'desk': {
      const legInset = 0.08
      const topThickness = 0.05
      const legHeight = def.height - topThickness
      const legs: [number, number][] = [
        [def.width / 2 - legInset, def.depth / 2 - legInset],
        [-(def.width / 2 - legInset), def.depth / 2 - legInset],
        [def.width / 2 - legInset, -(def.depth / 2 - legInset)],
        [-(def.width / 2 - legInset), -(def.depth / 2 - legInset)],
      ]
      return (
        <group>
          <Box
            size={[def.width, topThickness, def.depth]}
            position={[0, legHeight + topThickness / 2, 0]}
            color={c.wood}
            selected={selected}
            roughness={0.55}
          />
          {legs.map(([x, z], i) => (
            <Box
              key={i}
              size={[0.06, legHeight, 0.06]}
              position={[x, legHeight / 2, z]}
              color={c.darkWood}
              selected={selected}
            />
          ))}
        </group>
      )
    }

    case 'chair': {
      const seatH = 0.45
      const seatT = 0.06
      const legs: [number, number][] = [
        [0.2, 0.2],
        [-0.2, 0.2],
        [0.2, -0.2],
        [-0.2, -0.2],
      ]
      return (
        <group>
          <Box
            size={[def.width, seatT, def.depth]}
            position={[0, seatH, 0]}
            color={c.fabric}
            selected={selected}
            roughness={0.85}
          />
          {/* Backrest sits at -z, so a chair at rotation 0 faces +z. */}
          <Box
            size={[def.width, def.height - seatH, 0.06]}
            position={[0, seatH + (def.height - seatH) / 2, -def.depth / 2 + 0.03]}
            color={c.fabric}
            selected={selected}
            roughness={0.85}
          />
          {legs.map(([x, z], i) => (
            <Box
              key={i}
              size={[0.045, seatH, 0.045]}
              position={[x, seatH / 2, z]}
              color={c.metal}
              selected={selected}
              roughness={0.4}
            />
          ))}
        </group>
      )
    }

    case 'sofa': {
      const seatH = 0.4
      const armW = 0.22
      return (
        <group>
          <Box
            size={[def.width, seatH, def.depth]}
            position={[0, seatH / 2, 0]}
            color={c.fabric}
            selected={selected}
            roughness={0.9}
          />
          <Box
            size={[def.width, def.height - seatH, 0.22]}
            position={[0, seatH + (def.height - seatH) / 2, -def.depth / 2 + 0.11]}
            color={c.fabric}
            selected={selected}
            roughness={0.9}
          />
          {[-1, 1].map((side) => (
            <Box
              key={side}
              size={[armW, def.height - seatH + 0.1, def.depth]}
              position={[side * (def.width / 2 - armW / 2), seatH + (def.height - seatH - 0.1) / 2, 0]}
              color={c.lightFabric}
              selected={selected}
              roughness={0.9}
            />
          ))}
        </group>
      )
    }

    case 'kitchen-counter': {
      // Local +x runs the length, +z is the depth; the back (-z) meets the
      // wall, matching the bed's headboard convention and where `fitToRoom`
      // aims a seated piece.
      const topT = 0.04
      const bodyH = def.height - topT
      return (
        <group>
          {/* Cabinet carcass. */}
          <Box
            size={[def.width, bodyH, def.depth - 0.03]}
            position={[0, bodyH / 2, 0]}
            color={c.cabinet}
            selected={selected}
            roughness={0.7}
          />
          {/* Worktop, overhanging the carcass a touch. */}
          <Box
            size={[def.width, topT, def.depth]}
            position={[0, def.height - topT / 2, 0]}
            color={c.stone}
            selected={selected}
            roughness={0.35}
          />
          {/* Splashback up the wall side (-z). */}
          <Box
            size={[def.width, 0.18, 0.02]}
            position={[0, def.height + 0.09, -def.depth / 2 + 0.01]}
            color={c.stone}
            selected={selected}
            roughness={0.4}
          />
          {/* Sink basin let into the top near the left end. */}
          <Box
            size={[0.5, 0.08, 0.4]}
            position={[-def.width / 2 + 0.55, def.height - 0.05, 0.02]}
            color={c.appliance}
            selected={selected}
            roughness={0.5}
          />
          {/* Tap behind the basin, against the wall. */}
          <Box
            size={[0.03, 0.22, 0.03]}
            position={[-def.width / 2 + 0.55, def.height + 0.11, -def.depth / 2 + 0.09]}
            color={c.metal}
            selected={selected}
            roughness={0.3}
          />
          {/* Hob — a dark panel let into the top, right of centre. */}
          <Box
            size={[0.5, 0.03, 0.46]}
            position={[def.width * 0.16, def.height, 0]}
            color={c.appliance}
            selected={selected}
            roughness={0.4}
          />
        </group>
      )
    }

    case 'toilet': {
      // Local -z is the back, so the cistern meets the wall and the bowl faces
      // into the room. Rounded bowl and seat from cylinders; the raw meshes
      // repeat the selection tint that `Box` applies.
      const tint = selected ? SELECTION.color3d : c.porcelain
      const emissive = selected ? SELECTION.emissive : '#000000'
      const emissiveIntensity = selected ? 0.3 : 0
      return (
        <group>
          {/* Cistern against the wall. */}
          <Box
            size={[0.36, 0.34, 0.16]}
            position={[0, 0.6, -def.depth / 2 + 0.1]}
            color={c.porcelain}
            selected={selected}
            roughness={0.4}
          />
          {/* Pedestal / bowl, elongated front-to-back. */}
          <mesh position={[0, 0.2, 0.04]} scale={[1, 1, 1.3]} castShadow receiveShadow>
            <cylinderGeometry args={[0.17, 0.12, 0.4, 20]} />
            <meshStandardMaterial
              color={tint}
              emissive={emissive}
              emissiveIntensity={emissiveIntensity}
              roughness={0.4}
            />
          </mesh>
          {/* Seat, a flattened ring sitting on the bowl. */}
          <mesh position={[0, 0.41, 0.05]} scale={[1, 1, 1.3]} castShadow receiveShadow>
            <cylinderGeometry args={[0.19, 0.19, 0.05, 20]} />
            <meshStandardMaterial
              color={tint}
              emissive={emissive}
              emissiveIntensity={emissiveIntensity}
              roughness={0.4}
            />
          </mesh>
        </group>
      )
    }

    case 'bed': {
      const baseH = 0.3
      return (
        <group>
          <Box
            size={[def.width, baseH, def.depth]}
            position={[0, baseH / 2, 0]}
            color={c.darkWood}
            selected={selected}
          />
          <Box
            size={[def.width - 0.08, 0.18, def.depth - 0.1]}
            position={[0, baseH + 0.09, 0.02]}
            color={c.lightFabric}
            selected={selected}
            roughness={0.95}
          />
          {/* Headboard at -z, matching the chair's facing convention. */}
          <Box
            size={[def.width, 0.7, 0.08]}
            position={[0, 0.35, -def.depth / 2 + 0.04]}
            color={c.darkWood}
            selected={selected}
          />
        </group>
      )
    }
  }
}
