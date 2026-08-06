import { Component, Suspense, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import { Box3, Group, Object3D, Vector3 } from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { avatarState } from './avatarState'
import { AVATAR, SLAB } from './config'

/** Served from public/, so it loads from the app's own origin — no CDN. */
const CHARACTER_URL = '/character.glb'
useGLTF.preload(CHARACTER_URL)

/**
 * Extra yaw so the model's forward matches the walk heading.
 *
 * The heading turns the group so local +Z points where the figure walks. This
 * glTF's rig faces the viewer (+Z toward camera) at rest, so no correction is
 * needed. If the character ever walks backwards, flip this to `Math.PI`.
 */
const BASE_YAW = 0

/** Below this ground speed the walk cycle eases to a stand. */
const STILL_SPEED = 0.05

/** The hip bone, so its forward drift can be pinned and the walk stays in place. */
function findHips(root: Object3D): Object3D | null {
  let hips: Object3D | null = null
  root.traverse((o) => {
    if (!hips && /hips/i.test(o.name)) hips = o
  })
  return hips
}

/**
 * The walkthrough figure, an animated glTF character.
 *
 * It reads the same `avatarState` the controls drive, so movement, heading and
 * collisions are unchanged — only the body and its walk animation come from the
 * model. Three things make an arbitrary Mixamo export behave here:
 *
 *  - it is CLONED with `SkeletonUtils`, so the animation binds to this
 *    instance's own skeleton rather than the shared cached one (which would
 *    leave the mesh in its bind T-pose);
 *  - the clip is driven through drei's `useAnimations`, which owns the mixer
 *    and advances it each frame — its speed is scaled by how fast the figure
 *    actually moves, so the legs freeze when a wall stops it instead of
 *    moonwalking on the spot;
 *  - the hip's horizontal drift is pinned every frame, so a clip carrying root
 *    motion walks in place inside the group the controls are moving.
 *
 * It is auto-scaled to `AVATAR.height` and seated on the floor, so it neither
 * floats nor sinks whatever units the file used.
 */
function CharacterModel() {
  const group = useRef<Group>(null)
  const { scene, animations } = useGLTF(CHARACTER_URL)

  // A fresh clone per mount: useGLTF caches one scene, and binding an animation
  // to a shared skinned mesh leaves every other user of it in a T-pose.
  const model = useMemo(() => {
    const clone = SkeletonUtils.clone(scene)
    clone.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
      // A skinned mesh culls against its bind-pose bounds and can vanish at some
      // angles; keeping it always drawn is cheaper than fixing the bounds.
      o.frustumCulled = false
    })
    return clone
  }, [scene])

  const { scale, hips, hipRest } = useMemo(() => {
    const box = new Box3().setFromObject(model)
    const size = new Vector3()
    box.getSize(size)
    // A skinned Mixamo mesh measures in its REST pose, which for this export
    // lies flat: the height lands on the longest axis (here Z ≈ 0.99), while
    // size.y is only the body's thin front-to-back depth (~0.23). Dividing by
    // size.y would blow the figure up to ~7.6 m. For an upright human, height ≈
    // arm-span, so the largest extent is the standing height to within a
    // centimetre or two — a safe divisor whatever the rest orientation is.
    const tallest = Math.max(size.x, size.y, size.z) || 1
    const hipBone = findHips(model)
    return {
      scale: AVATAR.height / tallest,
      hips: hipBone,
      hipRest: hipBone ? hipBone.position.clone() : null,
    }
  }, [model])

  const { actions, names } = useAnimations(animations, model)

  useEffect(() => {
    const action = names[0] ? actions[names[0]] : null
    if (!action) return
    action.reset().play()
    // Frame 0 of this Mixamo export is the T-pose; the walk proper starts just
    // after. A standing figure holds whatever frame the action last showed, so
    // if it never advanced it would sit in that T-pose (which is what a user who
    // has entered walk mode but not yet moved would see). Start a fifth of the
    // way into the clip so the held pose is a natural mid-stride, never the T.
    action.time = action.getClip().duration * 0.2
    return () => {
      action.stop()
    }
  }, [actions, names])

  useFrame(() => {
    // Pace the animation by speed: brisker as they move, still when they stop.
    // A time-scale of 0 freezes the action at its current frame; because it was
    // primed a fifth into the clip (see the effect above), that held frame is a
    // natural mid-stride, never the T-pose at frame 0.
    const action = names[0] ? actions[names[0]] : null
    if (action) {
      action.timeScale =
        avatarState.speed > STILL_SPEED
          ? Math.min(1.6, 0.85 + avatarState.speed * 0.45)
          : 0
    }

    // Strip the walk's forward drift so the body stays inside the moving group.
    if (hips && hipRest) {
      hips.position.x = hipRest.x
      hips.position.z = hipRest.z
    }

    const g = group.current
    if (!g) return
    // Mixamo exports stand with the root at the feet on the ground plane, so the
    // figure seats on the slab with no vertical offset. SLAB.top is in the
    // floor's own space (the parent group carries each storey's elevation), so
    // this stays correct on upper floors too.
    g.position.set(avatarState.x, SLAB.top, avatarState.z)
    g.rotation.y = avatarState.heading + BASE_YAW
  })

  return (
    <group ref={group} scale={scale}>
      <primitive object={model} />
    </group>
  )
}

/** Swallows a load/decode failure so the scene keeps working without a figure. */
class Boundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * The walkthrough figure. Nothing renders while the model loads or if it fails,
 * so a missing or broken file degrades to an empty follow-camera rather than
 * breaking the scene.
 */
export function CharacterAvatar() {
  return (
    <Boundary>
      <Suspense fallback={null}>
        <CharacterModel />
      </Suspense>
    </Boundary>
  )
}
