import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { useDesignStore } from '../store/useDesignStore'
import { advanceStride } from './avatarMotion'
import { avatarState, resetAvatarState } from './avatarState'
import { resolveCollisions, wallColliders } from './collision'
import { AVATAR, SLAB } from './config'
import { clampDelta } from './walkMotion'
import { planBounds } from './wallGeometry'

const H = AVATAR.height

/**
 * A friendly, stylised adult — natural proportions rather than the old chibi,
 * modelled on the reference the user picked: a blonde bob, an open white
 * cardigan over a green top, dark trousers and navy sneakers.
 *
 * Proportions are near-realistic (a head a touch over a seventh of height) so
 * the figure keeps doing its real job — showing whether a person fits through a
 * doorway — while a soft face and rounded forms keep it approachable. Everything
 * is a fraction of `H`, so the whole figure rescales intact.
 */
const HEAD_R = 0.079 * H
const HEAD_Y = H - HEAD_R

const SHOULDER_Y = 0.8 * H
const HIP_Y = 0.47 * H

const NECK_R = 0.05 * H
const NECK_Y = 0.82 * H

const TORSO_R = 0.115 * H
const TORSO_Y = HIP_Y + (SHOULDER_Y - HIP_Y) / 2
/** Cylinder part of the torso capsule; the rounded caps add the rest. */
const TORSO_CYL = SHOULDER_Y - HIP_Y - 2 * TORSO_R

const PELVIS_R = 0.115 * H

const LEG_R = 0.058 * H
/** Hip pivot to sole, so the feet rest exactly on the floor. */
const LEG_TOTAL = HIP_Y
const LEG_CYL = LEG_TOTAL - 2 * LEG_R
const HIP_X = 0.072 * H

const ARM_R = 0.052 * H
const ARM_TOTAL = 0.36 * H
const ARM_CYL = ARM_TOTAL - 2 * ARM_R
/** Tucked close to the torso so the arms rest against the body, not out wide. */
const ARM_X = TORSO_R + ARM_R * 0.2
const ARM_Y = SHOULDER_Y - ARM_R

const HAND_R = 0.055 * H

/** Ground speed below which the figure counts as standing, in m/s. */
const STILL_SPEED = 0.05

/** How fast the walk pose fades in and out, per second. */
const SETTLE_RATE = 9

/**
 * Limbs are modelled hanging down -Y and the figure faces its local +Z, so a
 * rotation about X carries a limb toward -Z. Forward swing is therefore the
 * negated angle — get this backwards and the figure walks in reverse.
 */
function swingLimb(limb: Group | null, angle: number) {
  if (limb) limb.rotation.x = -angle
}

/** One leg: a trouser capsule pivoting at the hip, ending in a navy sneaker. */
function Leg() {
  return (
    <>
      <mesh position={[0, -(LEG_R + LEG_CYL / 2), 0]} castShadow receiveShadow>
        <capsuleGeometry args={[LEG_R, LEG_CYL, 6, 14]} />
        <meshStandardMaterial color={AVATAR.trousers} roughness={0.85} />
      </mesh>
      {/* A low navy sneaker on a thin pale sole. Kept small — a shoe, not a
          platform — and only lightly toed forward along +Z. */}
      <mesh
        position={[0, -LEG_TOTAL + 0.05 * H, 0.02 * H]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[LEG_R * 1.9, 0.06 * H, 0.15 * H]} />
        <meshStandardMaterial color={AVATAR.shoes} roughness={0.55} />
      </mesh>
      <mesh
        position={[0, -LEG_TOTAL + 0.01 * H, 0.02 * H]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[LEG_R * 2, 0.02 * H, 0.16 * H]} />
        <meshStandardMaterial color={AVATAR.sole} roughness={0.5} />
      </mesh>
    </>
  )
}

/** One arm: a white cardigan sleeve with a skin hand. */
function Arm() {
  return (
    <>
      <mesh position={[0, -ARM_CYL / 2 - ARM_R, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[ARM_R, ARM_CYL, 6, 12]} />
        <meshStandardMaterial color={AVATAR.cardigan} roughness={0.9} />
      </mesh>
      <mesh position={[0, -ARM_TOTAL, 0]} castShadow receiveShadow>
        <sphereGeometry args={[HAND_R, 14, 10]} />
        <meshStandardMaterial color={AVATAR.skin} roughness={0.65} />
      </mesh>
    </>
  )
}

/** The blonde bob: a crown cap, a back mass and two side pieces framing the face. */
function Hair() {
  const mat = <meshStandardMaterial color={AVATAR.hair} roughness={0.8} />
  return (
    <group>
      {/* Crown, sitting over the top of the head and a little back. */}
      <mesh
        position={[0, HEAD_R * 0.32, -HEAD_R * 0.08]}
        scale={[1.12, 0.98, 1.14]}
        castShadow
      >
        <sphereGeometry args={[HEAD_R, 20, 16]} />
        {mat}
      </mesh>
      {/* Back of the bob. */}
      <mesh
        position={[0, -HEAD_R * 0.15, -HEAD_R * 0.5]}
        scale={[1, 1.1, 0.85]}
        castShadow
      >
        <sphereGeometry args={[HEAD_R * 0.85, 18, 14]} />
        {mat}
      </mesh>
      {/* Two lengths hanging beside the face. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * HEAD_R * 0.9, -HEAD_R * 0.2, -HEAD_R * 0.05]}
          scale={[0.6, 1.2, 0.95]}
          castShadow
        >
          <sphereGeometry args={[HEAD_R * 0.6, 14, 12]} />
          {mat}
        </mesh>
      ))}
    </group>
  )
}

/** The head — skin sphere with a soft face, under the bob, facing +Z. */
function Head() {
  return (
    <group position={[0, HEAD_Y, 0]}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[HEAD_R, 24, 18]} />
        <meshStandardMaterial color={AVATAR.skin} roughness={0.6} />
      </mesh>

      <Hair />

      {[-1, 1].map((side) => (
        <mesh
          key={`eye${side}`}
          position={[side * 0.34 * HEAD_R, 0.08 * HEAD_R, HEAD_R * 0.9]}
          castShadow
        >
          <sphereGeometry args={[0.12 * HEAD_R, 12, 10]} />
          <meshStandardMaterial color={AVATAR.eye} roughness={0.3} />
        </mesh>
      ))}

      {[-1, 1].map((side) => (
        <mesh
          key={`cheek${side}`}
          position={[side * 0.52 * HEAD_R, -0.18 * HEAD_R, HEAD_R * 0.82]}
          scale={[1.2, 0.85, 0.5]}
        >
          <sphereGeometry args={[0.16 * HEAD_R, 12, 10]} />
          <meshStandardMaterial color={AVATAR.cheek} roughness={0.75} />
        </mesh>
      ))}

      {/* A small smile. */}
      <mesh
        position={[0, -0.34 * HEAD_R, HEAD_R * 0.92]}
        scale={[1.7, 0.5, 0.5]}
      >
        <sphereGeometry args={[0.1 * HEAD_R, 12, 8]} />
        <meshStandardMaterial color={AVATAR.mouth} roughness={0.5} />
      </mesh>
    </group>
  )
}

/**
 * The figure walked through the design in third-person.
 *
 * Built from primitives — nothing to download or licence — and styled as a
 * friendly adult (see the proportion constants above) so it reads as an
 * approachable stand-in without slipping into an uncanny mannequin.
 *
 * Every frame is driven from the `avatarState` singleton through direct
 * mutation of the meshes. Routing a 60 Hz pose through React state would
 * re-render the tree once per frame to produce byte-identical output.
 */
export function Avatar() {
  const root = useRef<Group>(null)
  const leftLeg = useRef<Group>(null)
  const rightLeg = useRef<Group>(null)
  const leftArm = useRef<Group>(null)
  const rightArm = useRef<Group>(null)

  const phase = useRef(0)
  const blend = useRef(0)

  // The figure now only exists during a walk, but keep a sane starting spot in
  // case it mounts before the controls have placed it: the centre of the plan,
  // pushed clear of the walls.
  const walkMode = useDesignStore((s) => s.walkMode)
  const walls = useDesignStore((s) => s.walls)
  useEffect(() => {
    if (walkMode) return
    const bounds = planBounds(walls)
    const centre = bounds?.center ?? { x: 0, z: 0 }
    const clear = resolveCollisions(
      centre.x,
      centre.z,
      AVATAR.radius,
      wallColliders(walls),
    )
    resetAvatarState(clear.x, clear.z)
  }, [walkMode, walls])

  useFrame((_, rawDelta) => {
    const body = root.current
    if (!body) return

    const delta = clampDelta(rawDelta)
    const stride = advanceStride(phase.current, avatarState.speed, delta)
    phase.current = stride.phase

    // The stride is paced by distance, so it freezes rather than unwinding when
    // the body stops. Fading the whole pose out settles it upright, and
    // resetting the phase once it is invisible means the next step starts from
    // a neutral stance instead of snapping into mid-stride.
    const target = avatarState.speed > STILL_SPEED ? 1 : 0
    const eased =
      blend.current + (target - blend.current) * Math.min(1, SETTLE_RATE * delta)
    blend.current = eased
    if (target === 0 && eased < 0.01) phase.current = 0

    body.position.set(avatarState.x, SLAB.top + stride.bob * eased, avatarState.z)
    body.rotation.y = avatarState.heading

    swingLimb(leftLeg.current, stride.leftLeg * eased)
    swingLimb(rightLeg.current, stride.rightLeg * eased)
    swingLimb(leftArm.current, stride.leftArm * eased)
    swingLimb(rightArm.current, stride.rightArm * eased)
  })

  return (
    <group ref={root}>
      {/* Torso: the white cardigan is the whole shell (so the figure reads as
          clothed from behind too, which is what the follow camera sees). The
          green top shows only as a slim oval on the chest, sitting almost flush
          with the surface so it never bulges out. */}
      <mesh position={[0, TORSO_Y, 0]} castShadow receiveShadow>
        <capsuleGeometry args={[TORSO_R, TORSO_CYL, 8, 18]} />
        <meshStandardMaterial color={AVATAR.cardigan} roughness={0.9} />
      </mesh>
      <mesh
        position={[0, 0.66 * H, TORSO_R * 0.92]}
        scale={[1.2, 2.2, 0.28]}
      >
        <sphereGeometry args={[0.055 * H, 16, 12]} />
        <meshStandardMaterial color={AVATAR.top} roughness={0.85} />
      </mesh>

      {/* Pelvis, in trouser colour, bridging the top to the legs. */}
      <mesh position={[0, HIP_Y + 0.01 * H, 0]} castShadow receiveShadow>
        <sphereGeometry args={[PELVIS_R, 18, 14]} />
        <meshStandardMaterial color={AVATAR.trousers} roughness={0.85} />
      </mesh>

      {/* Neck. */}
      <mesh position={[0, NECK_Y, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[NECK_R, NECK_R, 0.06 * H, 12]} />
        <meshStandardMaterial color={AVATAR.skin} roughness={0.6} />
      </mesh>

      <Head />

      {/* Limbs live in their own groups so the pivot sits at the joint: a mesh
          rotated about its own centre would scissor through the torso. */}
      <group ref={leftLeg} position={[-HIP_X, HIP_Y, 0]}>
        <Leg />
      </group>
      <group ref={rightLeg} position={[HIP_X, HIP_Y, 0]}>
        <Leg />
      </group>
      {/* A slight inward tilt so the arms rest against the body rather than
          hanging straight and stick-like. swingLimb only writes rotation.x, so
          this z tilt persists through the walk cycle. */}
      <group ref={leftArm} position={[-ARM_X, ARM_Y, 0]} rotation-z={0.09}>
        <Arm />
      </group>
      <group ref={rightArm} position={[ARM_X, ARM_Y, 0]} rotation-z={-0.09}>
        <Arm />
      </group>
    </group>
  )
}
