/**
 * Central tuning values for the 3D workspace.
 *
 * One metre in the design = one three.js unit. Keeping that ratio fixed here
 * means every later feature (walls, furniture, measurements) can size itself in
 * real-world metres without conversion.
 */

export const CAMERA = {
  /** ~33° above the floor: a three-quarter view that reads as a room, not a map. */
  position: [11, 10, 11] as const,
  fov: 45,
  near: 0.1,
  far: 500,
}

export const CONTROLS = {
  /**
   * How far the camera can tilt toward level. ~4.5° short of the horizon: low
   * enough to look at a wall almost face-on and read a facade, but not so low
   * that a drag can swing fully edge-on to the floor and collapse the scene
   * into an empty horizon. Azimuth is unrestricted, so this plus a drag reaches
   * every side of the building.
   */
  maxPolarAngle: Math.PI / 2 - 0.08,
  minDistance: 2,
  maxDistance: 60,
  dampingFactor: 0.08,
}

export const GRID = {
  /** Fine grid: one line every 0.5 m. */
  cellSize: 0.5,
  cellThickness: 0.7,
  cellColor: '#b4bccb',
  /** Bold grid: one line every 5 m. */
  sectionSize: 5,
  sectionThickness: 1.4,
  sectionColor: '#7a8698',
  fadeDistance: 55,
  fadeStrength: 1.2,
}

export const GROUND = {
  /** Far larger than `CONTROLS.maxDistance`, so the edge is never in frame. */
  size: 400,
  color: '#eef0f4',
  /** Lifts the grid off the plane to avoid depth-buffer flicker (z-fighting). */
  gridOffsetY: 0.002,
}

export const WALL = {
  color: '#d9dde4',
  roughness: 0.85,
  metalness: 0,
}

export const SELECTION = {
  /** Plan view. */
  color2d: '#2563eb',
  /** 3D view — lighter, since it is lit rather than drawn flat. */
  color3d: '#93b8f5',
  emissive: '#1d4ed8',
}

export const SLAB = {
  /**
   * Top face of the slab, in metres. Sits above `GROUND.gridOffsetY` so the
   * slab cleanly covers the reference grid inside the building footprint
   * instead of z-fighting with it. Walls stand on this height.
   */
  top: 0.006,
  thickness: 0.15,
  /** Extra metres of slab beyond the wall extents, so walls aren't flush. */
  margin: 0.5,
  color: '#e6e9ee',
}

export const WALK = {
  /** Roughly eye level for an average adult, in metres. */
  eyeHeight: 1.7,
  speed: 3.4,
  runSpeed: 6.2,
  /** Higher = snappier starts and stops. */
  damping: 12,
  fov: 72,
}

/**
 * The human figure walked through the design in third-person.
 *
 * Sized to a 1.75 m adult so rooms, doorways and worktops are judged against a
 * body rather than a floating camera — the whole point of putting a figure in
 * the scene.
 */
export const AVATAR = {
  height: 1.75,
  /** Collision radius: half the shoulder width, plus clothing slack. */
  radius: 0.26,
  /** Camera distance behind the figure, in metres. */
  cameraDistance: 3.4,
  /** Height the camera orbits at, and the height it looks toward. */
  cameraHeight: 1.95,
  lookHeight: 1.35,
  /** How fast the body turns to face its heading, in radians per second. */
  turnSpeed: 11,
  /** Full stride cycles per second at walking speed; scaled by actual speed. */
  strideRate: 0.95,
  /** Peak swing of an arm or leg, in radians. */
  swing: 0.62,
  skin: '#f3c3a0',
  /** Blonde bob. */
  hair: '#d7a244',
  /** Open white cardigan — the outer layer and the sleeves. */
  cardigan: '#eceef1',
  /** Green top, showing at the neckline under the cardigan. */
  top: '#2e9e5b',
  trousers: '#3f4557',
  /** Navy sneakers on a white sole. */
  shoes: '#2b3350',
  sole: '#f2f3f5',
  /** Dot eyes, a soft smile and rosy cheeks — friendly, not cartoonish. */
  eye: '#3a3436',
  cheek: '#f0a39c',
  mouth: '#c56b63',
}

/** Door leaves that swing open as the figure approaches. */
export const DOOR = {
  /** Fully open angle. Not quite 90° so the leaf reads as a door, not a wall. */
  openAngle: Math.PI * 0.46,
  /** The figure opens a door from this far away, in metres. */
  triggerRadius: 1.9,
  /** Swing rate, in radians per second. */
  swingSpeed: 3.4,
  leafThickness: 0.045,
  color: '#c8a06a',
  handle: '#8a8f98',
}

export const BLUEPRINT = {
  /** Metres per pixel is meaningless until the user calibrates; this is a hint. */
  calibrationHint: 'Click two points a known distance apart, then type it.',
  minMetresPerPixel: 1e-5,
  maxMetresPerPixel: 1,
}
