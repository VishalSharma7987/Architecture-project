import { Component, Suspense, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { Component, Suspense, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useFBX, useGLTF } from '@react-three/drei'
import { AnimationClip, Box3, Group, Object3D, Quaternion, Vector3 } from 'three'
import { SkeletonUtils } from 'three-stdlib'
import { avatarState } from './avatarState'
import { AVATAR, SLAB } from './config'

/**
 * The figure's mesh and its animations ship as separate files, all served from
 * public/ (the app's own origin — no CDN):
 *
 *  - the GLB carries the skinned construction-worker mesh and its skeleton. Its
 *    own embedded "clip" is a degenerate two-frame T-pose, so it is ignored;
 *  - the walk and idle come from Mixamo FBX clips. Because both the FBX clips
 *    and the GLB rig are the same Mixamo skeleton, the clips' tracks (keyed by
 *    bone name, e.g. `mixamorigHips`) bind straight onto the GLB skeleton with
 *    no retargeting.
 */
const CHARACTER_URL = '/character.glb'
const WALK_URL = '/animations/Walking.fbx'
const IDLE_URL = '/animations/Idle.fbx'
useGLTF.preload(CHARACTER_URL)

/**
 * Extra yaw so the model's forward matches the walk heading.
 *
 * The heading turns the group so local +Z points where the figure walks. This
 * rig faces the viewer at rest, so no correction is needed. If the character
 * ever walks backwards, flip this to `Math.PI`.
 */
const BASE_YAW = 0

/** Below this ground speed the figure blends back to a standing idle. */
const STILL_SPEED = 0.05

/** The rig's Hips bone, whose bind rotation carries the up-axis correction. */
function findHips(root: Object3D): Object3D | null {
  let hips: Object3D | null = null
  root.traverse((o) => {
    if (!hips && /hips/i.test(o.name)) hips = o
  })
  return hips
}

/**
 * A copy of a Mixamo clip made to drive the GLB rig upright and in place.
 *
 *  - only the bone-ROTATION tracks are kept. The root-position track is dropped
 *    so the walk steps in place (the controls move the group, so root
 *    translation would double as drift) and so the FBX's centimetres never
 *    fight the GLB's metres — rotations are unit-free;
 *  - the Hips track is pre-multiplied by the rig's Hips bind rotation. The GLB
 *    cancels a +90°X armature (its Blender Z-up→Y-up conversion) inside the Hips
 *    bind (−90°X); the Mixamo clip is authored in raw Y-up and would overwrite
 *    that, tipping the body flat. Re-applying the bind restores the correction,
 *    so the walk plays standing up. Child bones are parent-relative and need no
 *    change.
 */
function retargetClip(
  source: AnimationClip,
  name: string,
  hipsBind: Quaternion,
): AnimationClip {
  const clip = source.clone()
  clip.tracks = clip.tracks.filter((track) => track.name.endsWith('.quaternion'))
  const q = new Quaternion()
  for (const track of clip.tracks) {
    if (!/Hips\.quaternion$/i.test(track.name)) continue
    const v = track.values
    for (let i = 0; i < v.length; i += 4) {
      q.set(v[i], v[i + 1], v[i + 2], v[i + 3]).premultiply(hipsBind)
      v[i] = q.x
      v[i + 1] = q.y
      v[i + 2] = q.z
      v[i + 3] = q.w
    }
  }
  clip.name = name
  clip.resetDuration()
  return clip
}

/**
 * The walkthrough figure, an animated glTF character driven by Mixamo clips.
 *
 * It reads the same `avatarState` the controls drive, so movement, heading and
 * collisions are unchanged — only the body and its animation come from the
 * model. The mesh is CLONED with `SkeletonUtils` so the mixer binds to this
 * instance's own skeleton, and it is auto-scaled to `AVATAR.height` and seated
 * on the slab.
 */
function CharacterModel() {
  const group = useRef<Group>(null)
  const { scene } = useGLTF(CHARACTER_URL)
  const walkFbx = useFBX(WALK_URL)
  const idleFbx = useFBX(IDLE_URL)

  // A fresh clone per mount: useGLTF caches one scene, and binding an animation
  // to a shared skinned mesh leaves every other user of it in a T-pose. The
  // Hips bind rotation is captured here, from the untouched clone, before any
  // clip overwrites it — the clips need it to play upright (see retargetClip).
  const { model, hipsBind } = useMemo(() => {
    const clone = SkeletonUtils.clone(scene)
    clone.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
      // A skinned mesh culls against its bind-pose bounds and can vanish at some
      // angles; keeping it always drawn is cheaper than fixing the bounds.
      o.frustumCulled = false
    })
    const hips = findHips(clone)
    return { model: clone, hipsBind: (hips?.quaternion ?? new Quaternion()).clone() }
  }, [scene])

  const scale = useMemo(() => {
    const size = new Vector3()
    new Box3().setFromObject(model).getSize(size)
    // A skinned Mixamo mesh measures in its REST pose, which for this export
    // lies flat: the height lands on the longest axis (Z ≈ 0.99), while size.y
    // is only the body's thin front-to-back depth (~0.23). Dividing by size.y
    // would blow the figure up to ~7.6 m. For an upright human, height ≈
    // arm-span, so the largest extent is the standing height to within a
    // centimetre or two — a safe divisor whatever the rest orientation is.
    const tallest = Math.max(size.x, size.y, size.z) || 1
    return AVATAR.height / tallest
  }, [model])

  const clips = useMemo(
    () => [
      retargetClip(walkFbx.animations[0], 'walk', hipsBind),
      retargetClip(idleFbx.animations[0], 'idle', hipsBind),
    ],
    [walkFbx, idleFbx, hipsBind],
  )

  const { actions } = useAnimations(clips, model)

  // Fraction of the walk in the current blend: 0 = standing idle, 1 = walking.
  const walkBlend = useRef(0)

  useEffect(() => {
    const walk = actions.walk
    const idle = actions.idle
    // Both clips run at once; their weights cross-fade so the figure eases
    // between standing and walking rather than snapping between poses.
    idle?.reset().play().setEffectiveWeight(1)
    walk?.reset().play().setEffectiveWeight(0)
    return () => {
      walk?.stop()
      idle?.stop()
    }
  }, [actions])

  useFrame((_, delta) => {
    const walk = actions.walk
    const idle = actions.idle

    // Ease the blend toward walking or standing. delta-scaled so the fade takes
    // about the same wall-clock time regardless of frame rate.
    const target = avatarState.speed > STILL_SPEED ? 1 : 0
    walkBlend.current += (target - walkBlend.current) * Math.min(1, delta * 8)

    if (walk) {
      walk.setEffectiveWeight(walkBlend.current)
      // Brisker stride as they move faster; the idle plays at its own pace.
      walk.setEffectiveTimeScale(Math.min(1.6, 0.85 + avatarState.speed * 0.45))
    }
    if (idle) idle.setEffectiveWeight(1 - walkBlend.current)

    const g = group.current
    if (!g) return
    // Mixamo rigs stand with the root at the feet on the ground plane, so the
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
    <group ref={group} scale={scale}>
      <primitive object={model} />
    </group>
  )
}

/** Swallows a load/decode failure so the scene keeps working without a figure. */
/** Swallows a load/decode failure so the scene keeps working without a figure. */
class Boundary extends Component<
  { children: ReactNode },
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
    return this.state.failed ? null : this.props.children
  }
}

/**
 * The walkthrough figure. Nothing renders while the model loads or if it fails,
 * so a missing or broken file degrades to an empty follow-camera rather than
 * breaking the scene.
 * The walkthrough figure. Nothing renders while the model loads or if it fails,
 * so a missing or broken file degrades to an empty follow-camera rather than
 * breaking the scene.
 */
export function CharacterAvatar() {
  return (
    <Boundary>
      <Suspense fallback={null}>
    <Boundary>
      <Suspense fallback={null}>
        <CharacterModel />
      </Suspense>
    </Boundary>
  )
}
