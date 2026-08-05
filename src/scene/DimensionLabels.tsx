import { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Opening } from '../store/useDesignStore'
import { useDesignStore } from '../store/useDesignStore'
import { formatLengthCompact } from '../units/length'
import { SLAB } from './config'
import { openingCenter, pointAlongWall, wallAxis } from './wallGeometry'

/** Walls shorter than this (metres) are slivers not worth measuring in 3D. */
const MIN_WALL_LENGTH = 0.4

/** A chip is hidden when another already sits within this box of it, in px. */
const DECLUTTER_X = 72
const DECLUTTER_Y = 30

const CHIP =
  'whitespace-nowrap rounded-md bg-white/90 px-1.5 py-0.5 text-center ' +
  'text-[10px] leading-tight shadow-sm ring-1 ring-slate-900/10 select-none'

/**
 * Every measurement on the model, floating in 3D: each wall's length, height
 * and thickness at its mid-point, and each door and window's height and width
 * over its opening. The companion to the 2D plan's dimension lines — the plan
 * shows lengths and widths from above, this adds the heights the plan cannot.
 *
 * Drawn only when the Dimensions switch is on, and never during a walkthrough:
 * from inside the building every far measurement would float through the walls.
 * Built the same way as <RoomLabels> — positioned drei <Html> chips with a
 * per-frame declutter — so the two overlays read as one system and neither
 * needs a runtime font fetch.
 */
export function DimensionLabels() {
  const walls = useDesignStore((s) => s.walls)
  const units = useDesignStore((s) => s.units)
  const walkMode = useDesignStore((s) => s.walkMode)
  const showDimensions = useDesignStore((s) => s.showDimensions)

  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const chips = useRef<(HTMLDivElement | null)[]>([])
  const probe = useMemo(() => new Vector3(), [])

  // One chip per wall and one per opening. Openings carry a high priority so
  // that when a door's chip and its wall's chip collide, the door's size — the
  // thing the user turned this on to read — is the one that survives.
  const chipsData = useMemo(() => {
    const out: DimChip[] = []
    for (const wall of walls) {
      const { length } = wallAxis(wall)
      if (length >= MIN_WALL_LENGTH) {
        const mid = pointAlongWall(wall, length / 2)
        // The plan already dimensions every wall's length from above; repeating
        // it here as a bare floating number was the confusing part. In 3D a wall
        // chip carries only what the plan cannot show — how tall and how thick it
        // is — under a "Wall" headline so the number is never read out of
        // context.
        out.push({
          key: `wall-${wall.id}`,
          at: { x: mid.x, y: SLAB.top + wall.height / 2, z: mid.z },
          primary: 'Wall',
          secondary: `H ${formatLengthCompact(wall.height, units)} · ${formatLengthCompact(
            wall.thickness,
            units,
          )} thk`,
          priority: length,
        })
      }

      for (const opening of wall.openings) {
        const c = openingCenter(wall, opening)
        out.push({
          key: `open-${opening.id}`,
          at: { x: c.x, y: c.y, z: c.z },
          primary: openingName(opening),
          secondary: `H ${formatLengthCompact(opening.height, units)} · W ${formatLengthCompact(
            opening.width,
            units,
          )}`,
          priority: 1e6,
        })
      }
    }
    return out
  }, [walls, units])

  // Highest priority first, so the winner of a collision is decided the same
  // way <RoomLabels> decides it: the more important chip keeps its place.
  const order = useMemo(
    () =>
      chipsData
        .map((_, i) => i)
        .sort((a, b) => chipsData[b].priority - chipsData[a].priority),
    [chipsData],
  )

  useFrame(() => {
    const placed: { x: number; y: number }[] = []
    for (const i of order) {
      const el = chips.current[i]
      if (!el) continue

      const c = chipsData[i]
      probe.set(c.at.x, c.at.y, c.at.z)
      probe.project(camera)
      // z > 1 is behind the camera — a meaningless projected point, so hide it.
      const behind = probe.z > 1
      const sx = (probe.x * 0.5 + 0.5) * size.width
      const sy = (-probe.y * 0.5 + 0.5) * size.height

      const clash =
        behind ||
        placed.some(
          (q) =>
            Math.abs(q.x - sx) < DECLUTTER_X && Math.abs(q.y - sy) < DECLUTTER_Y,
        )

      el.style.visibility = clash ? 'hidden' : 'visible'
      if (!clash) placed.push({ x: sx, y: sy })
    }
  })

  if (!showDimensions || walkMode) return null

  return (
    <group>
      {chipsData.map((chip, index) => (
        <Html
          key={chip.key}
          position={[chip.at.x, chip.at.y, chip.at.z]}
          center
          // Must never swallow a click meant for the wall or opening behind it.
          // Set twice: drei honours the prop only in transform mode and the
          // style only in the plain mode used here.
          pointerEvents="none"
          style={{ pointerEvents: 'none' }}
        >
          <div
            ref={(el) => {
              chips.current[index] = el
            }}
            className={CHIP}
          >
            <span className="font-semibold text-slate-900">{chip.primary}</span>
            <span className="block text-slate-500">{chip.secondary}</span>
          </div>
        </Html>
      ))}
    </group>
  )
}

const openingName = (opening: Opening): string =>
  opening.type === 'door' ? 'Door' : 'Window'

/** A single floating measurement chip: a headline and a smaller detail line. */
type DimChip = {
  key: string
  /** World point the chip floats over — includes its height off the floor. */
  at: { x: number; y: number; z: number }
  /** The headline: a wall's length, or "Door" / "Window". */
  primary: string
  /** The detail line: heights and widths. */
  secondary: string
  /** Declutter rank; higher wins a collision. */
  priority: number
}
