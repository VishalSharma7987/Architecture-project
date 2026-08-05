/**
 * The figure's live pose, shared between the controls that drive it, the mesh
 * that draws it, and the door leaves that react to it.
 *
 * This is a module singleton rather than store state on purpose. It changes
 * every frame, and every consumer reads it inside `useFrame` — putting it in
 * zustand would re-render the whole 3D tree 60 times a second to produce
 * exactly the same React output, since the meshes are mutated imperatively
 * anyway. The plan editor already paints itself from refs for the same reason.
 *
 * One walkthrough runs at a time, so one slot is enough; `resetAvatarState`
 * is what a new walkthrough calls instead of constructing an instance.
 */
export const avatarState = {
  /** Position on the floor plane, in metres. */
  x: 0,
  z: 0,
  /** Y rotation the body faces, in radians. */
  heading: 0,
  /** Ground speed after collisions, in m/s — what the walk cycle is paced by. */
  speed: 0,
  /** Whether movement is being asked for this frame. */
  moving: false,
}

/** Drops the figure at a fresh spot, facing forward and at a standstill. */
export function resetAvatarState(x: number, z: number): void {
  avatarState.x = x
  avatarState.z = z
  avatarState.heading = 0
  avatarState.speed = 0
  avatarState.moving = false
}
