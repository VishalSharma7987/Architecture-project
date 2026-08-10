import { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { roomDisplayName } from '../rooms/catalog'
import {
  resolveRooms,
  roomSize,
  selectedRoomOf,
  type ResolvedRoom,
} from '../rooms/resolve'
import type { Point, RoomId } from '../store/useDesignStore'
import { useDesignStore } from '../store/useDesignStore'
import {
  formatArea,
  formatLength,
  SQUARE_METRES_PER_SQUARE_FOOT,
} from '../units/length'
import { SLAB } from './config'

/**
 * Metres above the slab. Enough that the caption reads as sitting on the
 * floor rather than sunk into it, low enough that it still belongs to the
 * floor of its room instead of hovering in the middle of the air.
 */
const LABEL_HEIGHT = SLAB.top + 0.05

/**
 * Unnamed spaces below this floor area get no caption.
 *
 * Wall detection and punched openings leave slivers a metre or two across
 * between rooms; captioning each one buries the real rooms under a pile of
 * overlapping "27 sq ft" chips. A space the user has actually named is always
 * shown, however small — that is a room they care about, not noise.
 */
const MIN_UNNAMED_LABEL_AREA = 30 * SQUARE_METRES_PER_SQUARE_FOOT

/** A label is hidden when another sits within this box of it, in screen px. */
const DECLUTTER_X = 84
const DECLUTTER_Y = 24

const CHIP =
  'whitespace-nowrap rounded-md bg-white/85 px-2 py-0.5 text-[11px] ' +
  'leading-tight shadow-sm ring-1 ring-slate-900/10 select-none'

/** The same chip, lit to match the row picked in the schedule panel. */
const CHIP_SELECTED =
  'whitespace-nowrap rounded-md bg-blue-50 px-2 py-0.5 text-[11px] ' +
  'leading-tight shadow-md ring-2 ring-blue-500 select-none'


/**
 * The name and floor area of every enclosed space, floating over its centroid
 * in the 3D view — `Bedroom — 120 sq ft`.
 *
 * Drawn with drei's <Html>, not <Text>: <Text> renders through troika, which
 * fetches a font file at runtime. That would break offline and under a strict
 * CSP, and it would render blank until the fetch landed. A positioned DOM node
 * costs nothing, stays crisp at any zoom and speaks the same Tailwind
 * vocabulary as the rest of the chrome.
 *
 * Screen-space captions are not hidden by the walls between them and the
 * camera, so a multi-room building would stack every far room's label onto the
 * near ones. A per-frame declutter (see `useFrame` below) hides any label that
 * lands on top of a larger one, which keeps the view legible when orbiting
 * without the all-or-nothing behaviour of raycast occlusion.
 */
export function RoomLabels() {
  const walls = useDesignStore((s) => s.walls)
  const roomLabels = useDesignStore((s) => s.roomLabels)
  const units = useDesignStore((s) => s.units)
  const walkMode = useDesignStore((s) => s.walkMode)
  const selection = useDesignStore((s) => s.selection)
  const showDimensions = useDesignStore((s) => s.showDimensions)

  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const chips = useRef<(HTMLDivElement | null)[]>([])
  const probe = useMemo(() => new Vector3(), [])

  // resolveRooms re-detects every space from the walls on each call, so it is
  // pinned to the only two inputs that can change the answer. Slivers are
  // filtered here so they cost nothing downstream.
  const rooms = useMemo(
    () =>
      resolveRooms(walls, roomLabels).filter(
        (room) => room.label !== null || room.area >= MIN_UNNAMED_LABEL_AREA,
      ),
    [walls, roomLabels],
  )

  // One chip per NAME, not per room: an open-plan space carries several names
  // in one enclosure, and each floats over its own anchor. The primary name
  // keeps the room's area beside it; the zone names that share the enclosure
  // show the name alone, since the area belongs to the whole space.
  const captions = useMemo(() => {
    const out: Caption[] = []
    rooms.forEach((room, index) => {
      out.push({
        key: room.label?.id ?? `space-${index}`,
        at: room.centroid,
        // The label this chip stands for, so it can tell when it is the one
        // picked. Null means an unnamed space, which is selected as a `space`
        // rather than by id — see `selectedIndex`.
        labelId: room.label?.id ?? null,
        room,
        name: room.label ? roomDisplayName(room.label) : null,
        area: room.area,
        // Overall length × width, carried on the primary chip only; the whole
        // enclosure shares one footprint, so the open-plan zones don't repeat it.
        size: roomSize(room.polygon),
        priority: room.area,
      })
      for (const extra of room.extraLabels) {
        out.push({
          key: extra.id,
          at: extra.anchor,
          labelId: extra.id,
          room,
          name: roomDisplayName(extra),
          area: null,
          size: null,
          priority: room.area,
        })
      }
    })
    return out
  }, [rooms])

  // Which chip, if any, matches the current room selection. A named zone
  // matches by id; a bare `space` matches the unnamed chip of the enclosure it
  // landed in, since there is no id to compare.
  const selectedIndex = useMemo(() => {
    if (selection?.kind !== 'room' && selection?.kind !== 'space') return -1
    const selected = selectedRoomOf(rooms, selection)
    return captions.findIndex((c) =>
      selection.kind === 'room'
        ? c.labelId === selection.roomId
        : c.labelId === null && c.room === selected,
    )
  }, [captions, rooms, selection])

  // Largest room first, so when two chips collide the bigger space keeps its
  // caption and the smaller one yields — the same rule a person would apply by
  // hand. Names sharing one enclosure fall back to source order between them.
  const order = useMemo(
    () =>
      captions
        .map((_, i) => i)
        // The selected chip is placed first, so it claims its spot and the
        // declutter never hides the one the user just picked.
        .sort((a, b) => {
          if (a === selectedIndex) return -1
          if (b === selectedIndex) return 1
          return captions[b].priority - captions[a].priority
        }),
    [captions, selectedIndex],
  )

  useFrame(() => {
    const placed: { x: number; y: number }[] = []
    for (const i of order) {
      const el = chips.current[i]
      if (!el) continue

      probe.set(captions[i].at.x, LABEL_HEIGHT, captions[i].at.z)
      probe.project(camera)
      // z > 1 is behind the camera; such a point projects to a meaningless
      // spot, so its label must be hidden rather than pinned to an edge.
      const behind = probe.z > 1
      const sx = (probe.x * 0.5 + 0.5) * size.width
      const sy = (-probe.y * 0.5 + 0.5) * size.height

      // The selected chip is never hidden by an overlap (it is drawn first, so
      // this only lets it win a tie), but a chip behind the camera still goes,
      // since projecting it would pin it to a meaningless spot.
      const forced = i === selectedIndex
      const clash =
        behind ||
        (!forced &&
          placed.some(
            (q) =>
              Math.abs(q.x - sx) < DECLUTTER_X &&
              Math.abs(q.y - sy) < DECLUTTER_Y,
          ))

      el.style.visibility = clash ? 'hidden' : 'visible'
      if (!clash) placed.push({ x: sx, y: sy })
    }
  })

  // Hidden during a walkthrough. From inside the building every other room's
  // name would float through the walls; a walk is for judging how the space
  // feels, and the names are one keypress away in the plan and the schedule.
  if (walkMode) return null

  return (
    <group>
      {captions.map((caption, index) => (
        <Html
          key={caption.key}
          position={[caption.at.x, LABEL_HEIGHT, caption.at.z]}
          center
          // A caption must never swallow a click meant for the wall or the
          // floor behind it, nor block a furniture drop. Set twice on
          // purpose: drei only honours the `pointerEvents` prop in
          // `transform` mode, and only `style` in the plain mode used here.
          pointerEvents="none"
          style={{ pointerEvents: 'none' }}
        >
          <div
            ref={(el) => {
              chips.current[index] = el
            }}
            className={index === selectedIndex ? CHIP_SELECTED : CHIP}
          >
            {caption.name !== null && (
              <span className="font-semibold text-slate-900">{caption.name}</span>
            )}
            {caption.name !== null && caption.area !== null && (
              <span className="text-slate-300"> — </span>
            )}
            {caption.area !== null && (
              <span
                className={caption.name === null ? 'text-slate-400' : 'text-slate-500'}
              >
                {formatArea(caption.area, units)}
              </span>
            )}
            {/* Overall length × width, shown under the name when the Dimensions
                switch is on — the plain size of the room, no mental arithmetic. */}
            {showDimensions && caption.size && (
              <span className="block text-slate-400">
                {formatLength(caption.size.width, units)} ×{' '}
                {formatLength(caption.size.length, units)}
              </span>
            )}
          </div>
        </Html>
      ))}
    </group>
  )
}

/**
 * A single floating chip: a name, an area, or "name — area". A zone that shares
 * an open-plan enclosure carries a name with no area; a detected-but-unnamed
 * space carries an area with no name.
 */
type Caption = {
  key: string
  /** Floor-plane point the chip floats over. */
  at: Point
  /** The label this caption stands for; null for an unnamed space. */
  labelId: RoomId | null
  /** The enclosure it belongs to, for matching a bare `space` selection. */
  room: ResolvedRoom
  /** Overall footprint for the size line; only the primary caption carries it. */
  size: { width: number; length: number } | null
  name: string | null
  area: number | null
  /** Declutter rank — the enclosing room's area, larger wins. */
  priority: number
}
