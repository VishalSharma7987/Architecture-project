import { Environment, Lightformer } from '@react-three/drei'

/**
 * Studio lighting rig.
 *
 * The environment map is built from in-scene `Lightformer` planes rather than a
 * preset HDR: drei's presets fetch several MB from a CDN, which would make the
 * app depend on the network and stall the first render. Rendering our own to a
 * small cubemap once (`frames={1}`) gives real image-based reflections —
 * especially on polished floors — with nothing to download.
 *
 * Intensities are tuned to sum to ~π on an up-facing surface: three.js applies
 * the Lambert BRDF's 1/π factor to every light, so that sum renders a surface
 * at its true albedo. Tone mapping is off (see SceneCanvas), so this matters —
 * these values were set against a rendered frame, not derived.
 */
export function Lighting() {
  return (
    <>
      {/* Shadows are the renderer's own PCF soft map (Canvas `shadows`). drei's
          <SoftShadows> PCSS patch is not compatible with three 0.185 — it
          injects GLSL calling `unpackRGBAToDepth`, which no longer compiles in
          the shadow shader, so every material's program failed to link and the
          console filled with shader errors. The built-in map is softer-edged
          but renders cleanly. */}

      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#ffffff', '#c2c6cf', 0.5]} />

      {/* Key light — slightly warm, and the only shadow caster. A second
          casting light would produce crossing shadows that read as a
          rendering fault rather than as sunlight. */}
      <directionalLight
        position={[14, 18, 9]}
        intensity={1.55}
        color="#fff6ea"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        // Pushes the shadow sample along the surface normal, which clears the
        // acne that thin geometry (door reveals, table tops) otherwise shows.
        shadow-normalBias={0.02}
        shadow-camera-left={-32}
        shadow-camera-right={32}
        shadow-camera-top={32}
        shadow-camera-bottom={-32}
        shadow-camera-near={0.5}
        shadow-camera-far={90}
      />

      {/* Cool fill from the opposite side keeps shadowed faces readable. */}
      <directionalLight position={[-12, 9, -14]} intensity={0.4} color="#dce6f5" />
      {/* Low rim light to separate wall edges from the background. */}
      <directionalLight position={[0, 4, -18]} intensity={0.22} color="#ffffff" />

      <Environment resolution={256} frames={1}>
        {/* Broad overhead source — the dominant reflection on floors. */}
        <Lightformer
          intensity={1.6}
          form="rect"
          scale={[30, 30, 1]}
          position={[0, 14, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          color="#ffffff"
        />
        {/* Warm and cool side panels give reflections some variation instead
            of a flat grey sheen. */}
        <Lightformer
          intensity={0.9}
          form="rect"
          scale={[16, 10, 1]}
          position={[14, 6, 6]}
          rotation={[0, -Math.PI / 2, 0]}
          color="#ffe9d2"
        />
        <Lightformer
          intensity={0.7}
          form="rect"
          scale={[16, 10, 1]}
          position={[-14, 6, -6]}
          rotation={[0, Math.PI / 2, 0]}
          color="#d6e4f7"
        />
      </Environment>
    </>
  )
}
