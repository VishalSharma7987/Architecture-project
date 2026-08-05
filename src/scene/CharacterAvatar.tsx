import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useFrame } from '@react-three/fiber'
import { useFBX } from '@react-three/drei'
import {
  AnimationMixer,
  Box3,
  LoopRepeat,
  Object3D,
  Vector3,
  type AnimationClip,
} from 'three'
import { avatarState } from './avatarState'
import { Avatar } from './Avatar'
import { AVATAR, SLAB } from './config'

/** Served from public/, so it loads from the app's own origin — no CDN. */
const CHARACTER_URL = '/character.fbx'
useFBX.preload(CHARACTER_URL)

/**
 * Extra yaw so the model's forward matches the walk heading. The Mixamo rig
 * faces +Z, the same way the primitive figure does; flip to Math.PI if the
 * character ever walks backwards.
 */
const BASE_YAW = 0

/** Below this ground speed the walk cycle eases to a stand. */
const STILL_SPEED = 0.05

/** The longest clip — a walk is longer than any static take the file carries. */
function pickClip(clips: AnimationClip[]): AnimationClip | null {
  if (clips.length === 0) return null
  return clips.reduce((best, c) => (c.duration > best.duration ? c : best))
}

/** The hip bone, so its forward drift can be pinned and the walk stays in place. */
function findHips(root: Object3D): Object3D | null {
  let hips: Object3D | null = null
  root.traverse((o) => {
    if (!hips && /hips/i.test(o.name)) hips = o
  })
  return hips
}

/**
 * The walkthrough figure, loaded from an FBX character rather than built from
 * primitives. It reads the same `avatarState` the controls drive, so movement,
 * heading and collisions are unchanged — only the body and its walk animation
 * come from the model.
 *
 * Three things make an arbitrary Mixamo export behave here:
 *  - the mixer is bound straight to the loaded object, not a wrapper, so the
 *    animation actually reaches the skinned mesh (a wrapper root left it in its
 *    T-pose);
 *  - the hip's horizontal drift is pinned every frame, so a "with-motion" clip
 *    walks on the spot instead of sliding out of the body the group is moving;
 *  - it is auto-scaled to a real height and seated on the floor, so it neither
 *    floats nor sinks whatever units the file used.
 */
function CharacterModel() {
  const fbx = useFBX(CHARACTER_URL)
  const wrap = useRef<Object3D>(null)

  const { scale, groundY, hips, hipRest } = useMemo(() => {
    const box = new Box3().setFromObject(fbx)
    const size = new Vector3()
    box.getSize(size)
    const s = AVATAR.height / (size.y || 1)

    fbx.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
      // A skinned mesh culls against its bind-pose bounds and can vanish at some
      // angles; keeping it always drawn is cheaper than fixing the bounds.
      o.frustumCulled = false
    })

    const hipBone = findHips(fbx)
    return {
      scale: s,
      // Lift the model's lowest point onto the floor surface (SLAB.top).
      groundY: SLAB.top - box.min.y * s,
      hips: hipBone,
      hipRest: hipBone ? hipBone.position.clone() : null,
    }
  }, [fbx])

  const mixer = useMemo(() => new AnimationMixer(fbx), [fbx])

  useEffect(() => {
    const clip = pickClip(fbx.animations)
    if (!clip) return
    const action = mixer.clipAction(clip)
    action.reset().setLoop(LoopRepeat, Infinity).play()
    return () => {
      mixer.stopAllAction()
    }
  }, [fbx, mixer])

  useFrame((_, delta) => {
    // Pace the animation by speed: brisker as they move, frozen when they stop.
    const rate =
      avatarState.speed > STILL_SPEED
        ? Math.min(1.5, 0.8 + avatarState.speed * 0.5)
        : 0
    mixer.update(delta * rate)

    // Strip the walk's forward drift so it stays in the body the group carries;
    // keep the vertical bob.
    if (hips && hipRest) {
      hips.position.x = hipRest.x
      hips.position.z = hipRest.z
    }

    const g = wrap.current
    if (!g) return
    g.position.set(avatarState.x, groundY, avatarState.z)
    g.rotation.y = avatarState.heading + BASE_YAW
  })

  return (
    <object3D ref={wrap} scale={scale}>
      <primitive object={fbx} />
    </object3D>
  )
}

/** Falls back to the primitive figure if the model fails to load or decode. */
class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * The walkthrough figure: the loaded character, with the built-in primitive
 * figure shown while it loads and kept permanently if it cannot be loaded — so
 * a missing or broken file degrades to the old avatar rather than breaking the
 * scene.
 */
export function CharacterAvatar() {
  return (
    <Boundary fallback={<Avatar />}>
      <Suspense fallback={<Avatar />}>
        <CharacterModel />
      </Suspense>
    </Boundary>
  )
}
