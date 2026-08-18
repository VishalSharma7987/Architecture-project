/**
 * Render `drawPlan` to PNG so the canvas can actually be LOOKED at. DEV ONLY.
 *
 *   npm run plan:look -- <out-dir>
 *
 * ── Why this exists ──
 * B26 changed how every wall on the editing canvas is drawn, and there was no
 * way to see the result. jsdom implements no canvas, the project takes no
 * canvas dependency, and the environment has no browser — so the whole test
 * suite could be green over a canvas that rendered as a black rectangle.
 * B26's brief made looking part of the definition of done; this is what makes
 * that repeatable rather than a one-off.
 *
 * ── What it is, and what it is NOT ──
 * It drives the REAL `drawPlan` with the real scene. What differs is only the
 * 2D context: a stub that records paths, applies the transform stack by hand,
 * and hands the result to a small scanline rasteriser below.
 *
 * It is NOT a browser screenshot. The rasteriser box-filters 3x supersampling
 * where a browser antialiases analytically, it has no font (text is drawn as a
 * pale bar marking where the label lands), and it approximates arcs as
 * polylines. Judge geometry with it — do corners close, do walls read as
 * walls — not typography or hairline crispness.
 */
import { writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { drawPlan } from '../src/plan/draw'
import { resolveRoomsUncached } from '../src/rooms/resolve'
import type { Point, RoomLabel, Wall } from '../src/store/useDesignStore'
import { moveWallEndpointIn } from '../src/store/useDesignStore'
import { SNAP_RADIUS_PX, findSnap, resolveWallPoint } from '../src/plan/snap'
import { snapToGrid } from '../src/plan/viewport'
import { findLooseJoints, probeTypedMiss } from '../src/plan/repairJoints'
import {
  deviationFrom,
  describeDeviation,
  extentOf,
  formatExtent,
} from '../src/plan/extent'
import {
  entryLength,
  keyToAction,
  typedEndpoint,
  type NumericEntry,
} from '../src/plan/numericEntry'
import { GRID_STEP } from '../src/units/length'

type M = [number, number, number, number, number, number]
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: M, x: number, y: number) => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
})


/* ── a very small software rasteriser, so there is something to LOOK at ── */

const SS = 3 // supersample factor, box-filtered down at the end

function surface(width: number, height: number) {
  const W = width * SS, H = height * SS
  const buf = new Float64Array(W * H * 3).fill(255)

  const parse = (c: string): [number, number, number, number] => {
    const s = String(c).trim()
    let m = /^#([0-9a-f]{6})$/i.exec(s)
    if (m) { const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 1] }
    m = /^#([0-9a-f]{3})$/i.exec(s)
    if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 1] }
    m = /^rgba?\(([^)]+)\)$/i.exec(s)
    if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3] ?? 1] }
    return [0, 0, 0, 1]
  }

  const blend = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return
    const i = (y * W + x) * 3
    buf[i] += (r - buf[i]) * a
    buf[i + 1] += (g - buf[i + 1]) * a
    buf[i + 2] += (b - buf[i + 2]) * a
  }

  /** Nonzero-winding scanline fill over a set of subpaths, in device units. */
  const fillPath = (subs: { x: number; y: number }[][], color: string, alpha: number) => {
    const [r, g, b, ca] = parse(color)
    const a = ca * alpha
    if (a <= 0) return
    const pts = subs.filter((p) => p.length > 2)
    if (!pts.length) return
    let lo = Infinity, hi = -Infinity
    for (const p of pts) for (const q of p) { lo = Math.min(lo, q.y); hi = Math.max(hi, q.y) }
    lo = Math.max(0, Math.floor(lo * SS)); hi = Math.min(H - 1, Math.ceil(hi * SS))

    for (let y = lo; y <= hi; y++) {
      const sy = (y + 0.5) / SS
      const xs: { x: number; w: number }[] = []
      for (const p of pts) {
        for (let i = 0; i < p.length; i++) {
          const A = p[i], B = p[(i + 1) % p.length]
          if (A.y === B.y) continue
          if (sy >= Math.min(A.y, B.y) && sy < Math.max(A.y, B.y)) {
            xs.push({ x: A.x + ((sy - A.y) / (B.y - A.y)) * (B.x - A.x), w: B.y > A.y ? 1 : -1 })
          }
        }
      }
      xs.sort((u, v) => u.x - v.x)
      let wind = 0
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i].w
        if (wind === 0) continue
        const x0 = Math.max(0, Math.ceil(xs[i].x * SS)), x1 = Math.min(W - 1, Math.floor(xs[i + 1].x * SS))
        for (let x = x0; x <= x1; x++) blend(x, y, r, g, b, a)
      }
    }
  }

  /** Each segment as a quad, so a stroke is just a fill. */
  const strokePath = (subs: { x: number; y: number }[][], color: string, alpha: number, lw: number, dash: number[]) => {
    const h = Math.max(0.35, lw / 2)
    for (const p of subs) {
      for (let i = 0; i < p.length - 1; i++) {
        const A = p[i], B = p[i + 1]
        const dx = B.x - A.x, dy = B.y - A.y
        const len = Math.hypot(dx, dy) || 1
        // Dashes: walk the segment and skip the gaps.
        const runs: [number, number][] = []
        if (dash.length >= 2) {
          let t = 0, on = true, k = 0
          while (t < len) {
            const step = Math.min(dash[k % dash.length], len - t)
            if (on) runs.push([t, t + step])
            t += step; on = !on; k++
          }
        } else runs.push([0, len])
        for (const [t0, t1] of runs) {
          const a0 = { x: A.x + (dx / len) * t0, y: A.y + (dy / len) * t0 }
          const a1 = { x: A.x + (dx / len) * t1, y: A.y + (dy / len) * t1 }
          const nx = (-(a1.y - a0.y) / (Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1)) * h
          const ny = ((a1.x - a0.x) / (Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1)) * h
          fillPath([[
            { x: a0.x + nx, y: a0.y + ny }, { x: a1.x + nx, y: a1.y + ny },
            { x: a1.x - nx, y: a1.y - ny }, { x: a0.x - nx, y: a0.y - ny },
          ]], color, alpha)
        }
      }
    }
  }

  const toPNG = () => {
    const png = new PNG({ width, height })
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0
        for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
          const k = ((y * SS + j) * W + (x * SS + i)) * 3
          r += buf[k]; g += buf[k + 1]; b += buf[k + 2]
        }
        const n = SS * SS, o = (y * width + x) * 4
        png.data[o] = r / n; png.data[o + 1] = g / n; png.data[o + 2] = b / n; png.data[o + 3] = 255
      }
    }
    return PNG.sync.write(png)
  }

  return { fillPath, strokePath, toPNG }
}

function planContext(width: number, height: number) {
  const surf = surface(width, height)
  let m: M = [1, 0, 0, 1, 0, 0]
  const stack: { m: M; s: Record<string, unknown> }[] = []
  let sub: { x: number; y: number }[][] = []
  let cur: { x: number; y: number }[] = []
  const state: Record<string, unknown> = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    lineDash: [] as number[], font: '12px sans-serif', textAlign: 'start',
  }
  const flush = () => { if (cur.length) { sub.push(cur); cur = [] } }

  const ctx = {
    canvas: { width, height },
    get fillStyle() { return state.fillStyle } , set fillStyle(v) { state.fillStyle = v },
    get strokeStyle() { return state.strokeStyle }, set strokeStyle(v) { state.strokeStyle = v },
    get lineWidth() { return state.lineWidth }, set lineWidth(v) { state.lineWidth = v },
    get globalAlpha() { return state.globalAlpha }, set globalAlpha(v) { state.globalAlpha = v },
    get font() { return state.font }, set font(v) { state.font = v },
    get textAlign() { return state.textAlign }, set textAlign(v) { state.textAlign = v },
    set textBaseline(_v: unknown) {}, set lineCap(_v: unknown) {}, set lineJoin(_v: unknown) {},
    set shadowBlur(_v: unknown) {}, set shadowColor(_v: unknown) {},

    save() { stack.push({ m: [...m] as M, s: { ...state } }) },
    restore() { const p = stack.pop(); if (p) { m = p.m; Object.assign(state, p.s) } },
    translate(x: number, y: number) { m = mul(m, [1, 0, 0, 1, x, y]) },
    rotate(r: number) { m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]) },
    scale(x: number, y: number) { m = mul(m, [x, 0, 0, y, 0, 0]) },
    setLineDash(v: number[]) { state.lineDash = v },

    beginPath() { sub = []; cur = [] },
    closePath() { if (cur.length > 2) cur.push(cur[0]); flush() },
    moveTo(x: number, y: number) { flush(); cur = [apply(m, x, y)] },
    lineTo(x: number, y: number) { cur.push(apply(m, x, y)) },
    rect(x: number, y: number, w: number, h: number) {
      flush()
      cur = [apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)]
      cur.push(cur[0]); flush()
    },
    arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false) {
      flush()
      let s = a0, e = a1
      if (!ccw && e < s) e += Math.PI * 2
      if (ccw && e > s) e -= Math.PI * 2
      const steps = Math.max(8, Math.ceil(Math.abs(e - s) / 0.12))
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= steps; i++) {
        const t = s + ((e - s) * i) / steps
        pts.push(apply(m, cx + Math.cos(t) * r, cy + Math.sin(t) * r))
      }
      sub.push(pts)
    },
    ellipse(cx: number, cy: number, rx: number, ry: number) {
      flush()
      const pts: { x: number; y: number }[] = []
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * Math.PI * 2
        pts.push(apply(m, cx + Math.cos(t) * rx, cy + Math.sin(t) * ry))
      }
      sub.push(pts)
    },
    fill() {
      flush()
      surf.fillPath(sub, String(state.fillStyle), Number(state.globalAlpha))
    },
    stroke() {
      flush()
      surf.strokePath(sub, String(state.strokeStyle), Number(state.globalAlpha), Number(state.lineWidth), state.lineDash as number[])
    },
    fillRect(x: number, y: number, w: number, h: number) {
      const p = [apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)]
      surf.fillPath([p], String(state.fillStyle), 1)
    },
    strokeRect() {},
    clip() {},
    // Text is drawn as a light bar of the right extent. This rasteriser has no
    // font; what is being looked at is wall geometry, and a legible label would
    // only be a distraction from it. The bar marks WHERE text lands so it can
    // be seen colliding with something if it does.
    fillText(t: string, x: number, y: number) {
      const p = apply(m, x, y)
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 12)
      const w = t.length * size * 0.5
      const x0 = state.textAlign === 'center' ? p.x - w / 2 : state.textAlign === 'right' ? p.x - w : p.x
      surf.fillPath([[
        { x: x0, y: p.y - size * 0.72 }, { x: x0 + w, y: p.y - size * 0.72 },
        { x: x0 + w, y: p.y }, { x: x0, y: p.y },
      ]], String(state.fillStyle), 0.25 * Number(state.globalAlpha))
    },
    strokeText() {},
    measureText(t: string) { return { width: t.length * 6 } },
    drawImage() {},
    setTransform() { m = [1, 0, 0, 1, 0, 0] },
    quadraticCurveTo(_a: number, _b: number, x: number, y: number) { cur.push(apply(m, x, y)) },
    bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number) { cur.push(apply(m, x, y)) },
    arcTo(_a: number, _b: number, x: number, y: number) { cur.push(apply(m, x, y)) },
    createLinearGradient() { return { addColorStop() {} } },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, png: () => surf.toPNG() }
}

/* ── the plan: four exterior walls, two partitions, a door, two windows ── */

const OUT = process.argv[2] ?? '.'

const T = 0.23
const P = 0.115
const w = (id: string, ax: number, az: number, bx: number, bz: number, t: number, openings: Wall['openings'] = []): Wall => ({
  id, start: { x: ax, z: az }, end: { x: bx, z: bz },
  height: 3, thickness: t, openings, material: 'white-paint', type: 'shell',
})

const WALLS: Wall[] = [
  w('n', -4, -3, 4, -3, T, [
    { id: 'win1', type: 'window', position: 2, width: 1.2, height: 1.4, sill: 0.9 },
    { id: 'win2', type: 'window', position: 6, width: 1.2, height: 1.4, sill: 0.9 },
  ]),
  w('e', 4, -3, 4, 3, T),
  w('s', 4, 3, -4, 3, T, [
    { id: 'door1', type: 'door', position: 4, width: 0.9, height: 2.1, sill: 0, swing: { hand: 'start', side: 'left' } },
  ]),
  w('wst', -4, 3, -4, -3, T),
  w('p1', 0, -3, 0, 1, P, [
    { id: 'door2', type: 'door', position: 2.4, width: 0.8, height: 2.1, sill: 0, swing: { hand: 'end', side: 'right' } },
  ]),
  w('p2', 0, 1, 4, 1, P),
  // A stem stopping at the through-wall's visible FACE rather than its
  // centreline — what a user clicking the edge produces, and the case
  // Session 2's `pullBack` fixture modelled. z = -3 + T/2 = -2.885.
  w('p3', 2.5, -2.885, 2.5, -1.5, P),
]

const LABELS: RoomLabel[] = []
const rooms = resolveRoomsUncached(WALLS, LABELS)
console.log(`rooms detected: ${rooms.length}`)

const VIEWS = [
  ['050', 22, 0, 0], ['100', 44, 0, 0], ['400', 176, 0, 0],
  // T-junctions: p1 meets the north wall mid-span at (0,-3), p2 meets the east
  // wall mid-span at (4,1). Neither shares a vertex, so neither gets a pad.
  ['tee-north', 260, 0, -3], ['tee-east', 260, 4, 1],
  // A corner, for comparison: (4,-3) IS a shared endpoint.
  ['corner-ne', 260, 4, -3],
  ['tee-at-face', 260, 2.5, -2.885],
] as const

for (const [name, scale, cx, cz] of VIEWS) {
  const { ctx, png } = planContext(900, 700)
  drawPlan(ctx, {
    width: 900, height: 700,
    viewport: { center: { x: cx, z: cz }, scale },
    walls: WALLS, furniture: [], rooms,
    selection: null, units: 'm', anchor: null, cursor: null, showCursor: false,
  })
  writeFileSync(`${OUT}/plan-${name}.png`, png())
  console.log(`wrote plan-${name}.png at ${scale} px/m`)
}

/* ── B28: draw a closed room by hand, and look at what the user sees ── */

/**
 * Simulates the editor's drawing loop with the REAL `resolveWallPoint`, the
 * real grid step and the real snap radius, then renders each interesting frame.
 *
 * This is as close to "open the app and draw a room" as an environment with no
 * browser gets: every decision below is production code, and only the pointer
 * positions are scripted. What it cannot show is feel — whether the snap grabs
 * when you did not want it — which is why the frames are looked at rather than
 * asserted.
 */
const SNAP_SCALE = 44
const CELL = GRID_STEP.ftin.cell
const snapRadius = SNAP_RADIUS_PX / SNAP_SCALE

/** A hand aiming at a point and missing by a few centimetres. */
const hand = (x: number, z: number, jx = 0.03, jz = -0.02) => ({ x: x + jx, z: z + jz })

const frames: { name: string; walls: Wall[]; anchor: Point | null; cursor: Point; snap: ReturnType<typeof resolveWallPoint>['target'] }[] = []
const drawn: Wall[] = []
let anchor: Point | null = null
let n = 0

const step = (name: string, world: Point, suppressed = false, commit = true) => {
  const r = resolveWallPoint({
    walls: drawn, world, grid: snapToGrid(world, CELL), radius: snapRadius, suppressed,
  })
  frames.push({ name, walls: [...drawn], anchor, cursor: r.point, snap: r.target })
  if (!commit) return
  if (anchor) {
    drawn.push({
      id: `d${n++}`, start: anchor, end: r.point,
      height: 3, thickness: 0.23, openings: [], material: 'white-paint', type: 'shell',
    })
  }
  anchor = r.point
}

step('01-first-click', hand(0, 0))
step('02-second', hand(5, 0))
step('03-third', hand(5, 4))
step('04-fourth', hand(0, 4))
// Returning to the start: this is the frame that matters.
step('05-closing-hover', hand(0, 0, 0.035, 0.025), false, false)
step('06-closed', hand(0, 0, 0.035, 0.025))
// A partition drawn to the middle of the south wall, and to a point along it.
step('07-midpoint-hover', hand(2.5, 4, 0.02, 0.02), false, false)
step('08-centreline-hover', hand(3.8, 4, 0.01, 0.015), false, false)
// The same aim with Alt held.
step('09-alt-suppressed', hand(0, 0, 0.035, 0.025), true, false)

console.log('')
for (const f of frames) {
  const { ctx, png } = planContext(760, 620)
  drawPlan(ctx, {
    width: 760, height: 620,
    viewport: { center: { x: 2.5, z: 2 }, scale: SNAP_SCALE },
    walls: f.walls, furniture: [], rooms: [],
    selection: null, units: 'ftin', anchor: f.anchor, cursor: f.cursor,
    showCursor: true, snap: f.snap,
  })
  writeFileSync(`${OUT}/snap-${f.name}.png`, png())
  console.log(`snap-${f.name}.png  cursor ${f.cursor.x.toFixed(4)},${f.cursor.z.toFixed(4)}  snap ${f.snap?.kind ?? '—'}`)
}
const closed = drawn.length === 4 && drawn[3].end.x === drawn[0].start.x && drawn[3].end.z === drawn[0].start.z
console.log(`\nwalls drawn: ${drawn.length}   chain closed bit-identically: ${closed}`)
console.log(`loose joints: ${findLooseJoints(drawn).length}`)

/* ── B29: type a length while drawing, and look at the field ── */

/**
 * The real `keyToAction` / `entryLength` / `typedEndpoint`, driven by a
 * scripted keystroke sequence. Only the keys and the pointer are scripted;
 * every decision is production code.
 */
const typedWalls: Wall[] = []
let tAnchor: Point | null = null
let tCursor: Point = { x: 0, z: 0 }
let entry: NumericEntry = null
let tn = 0
const tFrames: { name: string; typed: string | null; anchor: Point | null; cursor: Point; walls: Wall[] }[] = []

const shot = (name: string) =>
  tFrames.push({
    name, typed: entry?.text ?? null, anchor: tAnchor,
    cursor: { ...tCursor }, walls: [...typedWalls],
  })

/** A click: commits where it points and abandons anything half-typed. */
const tClick = (world: Point) => {
  const r = resolveWallPoint({
    walls: typedWalls, world, grid: snapToGrid(world, CELL), radius: snapRadius, suppressed: false,
  })
  entry = null
  if (tAnchor) {
    typedWalls.push({
      id: `t${tn++}`, start: tAnchor, end: r.point,
      height: 3, thickness: 0.23, openings: [], material: 'white-paint', type: 'shell',
    })
  }
  tAnchor = r.point
  tCursor = r.point
}

/** A keystroke through the real state machine. */
const tKey = (key: string) => {
  const action = keyToAction(entry, key)
  if (action.kind === 'update') entry = { text: action.text }
  else if (action.kind === 'cancel') entry = null
  else if (action.kind === 'commit') {
    const metres = tAnchor ? entryLength(action.text, 'ftin') : null
    const end = metres !== null && tAnchor ? typedEndpoint(tAnchor, tCursor, metres) : null
    if (end && tAnchor) {
      typedWalls.push({
        id: `t${tn++}`, start: tAnchor, end,
        height: 3, thickness: 0.23, openings: [], material: 'white-paint', type: 'shell',
      })
      tAnchor = end
      tCursor = end
    }
    entry = null
  }
}

tClick({ x: 0, z: 0 })
tCursor = { x: 2, z: 0 }            // point east
shot('t1-pointing')
for (const k of ['1', '3', "'", '-', '3', '"']) tKey(k)
shot('t2-typing')                    // 13'-3" — a length the grid cannot express
tKey('Enter')
tCursor = { x: tAnchor!.x, z: tAnchor!.z + 2 } // point south
shot('t3-committed')
for (const k of ['9', "'"]) tKey(k)
shot('t4-typing-again')
tKey('Enter')
tCursor = { x: tAnchor!.x - 2, z: tAnchor!.z }
for (const k of ['1', '2']) tKey(k)
shot('t5-before-escape')
tKey('Escape')
shot('t6-after-escape')

console.log('')
for (const f of tFrames) {
  const { ctx, png } = planContext(760, 560)
  drawPlan(ctx, {
    width: 760, height: 560,
    viewport: { center: { x: 2, z: 1.6 }, scale: 66 },
    walls: f.walls, furniture: [], rooms: [],
    selection: null, units: 'ftin', anchor: f.anchor, cursor: f.cursor,
    showCursor: true, snap: null, typed: f.typed,
  })
  writeFileSync(`${OUT}/typed-${f.name}.png`, png())
  console.log(`typed-${f.name}.png  entry ${f.typed === null ? '—' : `"${f.typed}"`}`)
}
console.log('')
for (const built of typedWalls) {
  const m = Math.hypot(built.end.x - built.start.x, built.end.z - built.start.z)
  console.log(`  wall ${built.id}: ${m.toFixed(6)} m  = ${(m / 0.3048).toFixed(4)} ft`)
}

/* ── B30: drag an endpoint, and look at the handles ── */

/**
 * The real `moveWallEndpointIn` and the real `findSnap`, driven by a scripted
 * pointer. Only the pointer positions are scripted; the preview rendered at
 * each step is the exact wall array the drop would commit.
 */
const dragBase: Wall[] = [
  w('n', 0, 0, 5, 0, 0.23),
  w('e', 5, 0, 5, 4, 0.23),
  w('far', 6.4, 1.2, 9, 1.2, 0.23), // something to snap onto
]
const junction: Wall[] = [...dragBase, w('x', 5, 0, 8, -2.4, 0.23)]

const dragFrames: {
  name: string
  walls: Wall[]
  handles: { wallId: string; blocked: number; which: 'start' | 'end' }
  snap: ReturnType<typeof findSnap>
}[] = []

const dragTo = (base: Wall[], wallId: string, which: 'start' | 'end', p: Point, name: string) => {
  const probe = moveWallEndpointIn(base, wallId, which, base.find((x) => x.id === wallId)![which])
  const blocked = probe.ok ? 0 : probe.attached
  const target = blocked
    ? null
    : findSnap(base, p, SNAP_RADIUS_PX / 66, new Set([wallId]))
  const to = target ? target.point : snapToGrid(p, CELL)
  const result = blocked ? null : moveWallEndpointIn(base, wallId, which, to)
  dragFrames.push({
    name,
    walls: result && result.ok ? result.walls : base,
    handles: { wallId, blocked, which },
    snap: target,
  })
}

dragTo(dragBase, 'n', 'end', { x: 5, z: 0 }, 'd1-grabbed')
dragTo(dragBase, 'n', 'end', { x: 6.1, z: 0.9 }, 'd2-dragging')
dragTo(dragBase, 'n', 'end', { x: 6.37, z: 1.18 }, 'd3-snapped')
dragTo(junction, 'n', 'end', { x: 6.1, z: 0.9 }, 'd4-refused')

console.log('')
for (const f of dragFrames) {
  const { ctx, png } = planContext(760, 560)
  drawPlan(ctx, {
    width: 760, height: 560,
    viewport: { center: { x: 4, z: 0.8 }, scale: 66 },
    walls: f.walls, furniture: [], rooms: [],
    selection: { kind: 'wall', wallId: f.handles.wallId },
    units: 'm', anchor: null, cursor: null, showCursor: false,
    handles: f.handles, snap: f.snap,
  })
  writeFileSync(`${OUT}/drag-${f.name}.png`, png())
  const nw = f.walls.find((x) => x.id === 'n')!
  const ew = f.walls.find((x) => x.id === 'e')!
  const shut = nw.end.x === ew.start.x && nw.end.z === ew.start.z
  console.log(
    `drag-${f.name}.png  blocked ${f.handles.blocked}  snap ${f.snap?.kind ?? '—'}  corner shut ${shut}`,
  )
}

/* ── B31: the reference plan at its real size, with size captions ── */

/**
 * The reference — 9.00 x 11.00 m, three bedrooms — drawn at reference size
 * and at the 3x that produced this session, so the caption stack and the
 * draft hint can be LOOKED at rather than asserted.
 */
const refWall = (id: string, ax: number, az: number, bx: number, bz: number, t: number): Wall =>
  ({ id, start: { x: ax, z: az }, end: { x: bx, z: bz }, height: 3, thickness: t, openings: [], material: 'white-paint', type: t > 0.17 ? 'shell' : 'partition' })

function refPlan(k: number): Wall[] {
  const p = (v: number) => v * k
  const SHELL_T = 0.23
  return [
    refWall('n', p(0), p(0), p(9), p(0), SHELL_T),
    refWall('e', p(9), p(0), p(9), p(11), SHELL_T),
    refWall('s', p(9), p(11), p(0), p(11), SHELL_T),
    refWall('w', p(0), p(11), p(0), p(0), SHELL_T),
    refWall('b1', p(0), p(3.5), p(9), p(3.5), 0.115),
    refWall('b2', p(3), p(0), p(3), p(3.5), 0.115),
    refWall('b3', p(6), p(0), p(6), p(3.5), 0.115),
    refWall('b4', p(0), p(8), p(9), p(8), 0.115),
    refWall('b5', p(3), p(8), p(3), p(11), 0.115),
    refWall('b6', p(6), p(8), p(6), p(11), 0.115),
  ]
}

const pv = (source: string) => ({ source, createdAt: '2026-08-12T00:00:00.000Z', confidence: 1 }) as RoomLabel['provenance']
const refLabels = (k: number): RoomLabel[] => [
  { id: 'l1', type: 'bedroom', anchor: { x: 1.5 * k, z: 1.75 * k }, provenance: pv('manual') },
  { id: 'l2', type: 'bedroom', anchor: { x: 4.5 * k, z: 1.75 * k }, provenance: pv('manual') },
  { id: 'l3', type: 'bedroom', anchor: { x: 7.5 * k, z: 1.75 * k }, provenance: pv('manual') },
  { id: 'l4', type: 'living', anchor: { x: 4.5 * k, z: 5.75 * k }, provenance: pv('manual') },
  { id: 'l5', type: 'kitchen', anchor: { x: 1.5 * k, z: 9.5 * k }, provenance: pv('manual') },
  { id: 'l6', type: 'toilet', anchor: { x: 4.5 * k, z: 9.5 * k }, provenance: pv('manual') },
  { id: 'l7', type: 'bedroom', anchor: { x: 7.5 * k, z: 9.5 * k }, provenance: pv('manual') },
]

/* ── B34: the face target and the typed near-miss, at the failing zoom ── */

/**
 * Finding 53's two mechanisms, drawn. Frame 1: aiming at a 230 mm shell's
 * FACE at 130 px/m — pre-B34 this fell to grid one cell short; the diamond
 * indicator now sits on the centreline the click will land on, and the
 * committed stem joins. Frame 2: a live `7'6` entry whose commit would strand
 * the end 152 mm short — the ring and the "reaches" hint, with the commit
 * untouched (L2).
 */
{
  const b34shell = w('shell', 0, 0, 9.144, 0, 0.23)
  const scale = 130
  const aim = { x: 3.048, z: 0.115 } // exactly on the visible face
  const r = resolveWallPoint({
    walls: [b34shell], world: aim, grid: snapToGrid(aim, CELL),
    radius: SNAP_RADIUS_PX / scale, suppressed: false,
  })
  {
    const { ctx, png } = planContext(760, 560)
    drawPlan(ctx, {
      width: 760, height: 560,
      viewport: { center: { x: 3.2, z: 0.9 }, scale },
      walls: [b34shell], furniture: [], rooms: [],
      selection: null, units: 'ftin',
      anchor: { x: 3.048, z: 2.4384 }, cursor: r.point,
      showCursor: true, snap: r.target,
    })
    writeFileSync(`${OUT}/b34-face-snap.png`, png())
    console.log(`\nb34-face-snap.png  kind ${r.target?.kind}  lands z=${r.point.z}`)
  }
  {
    const missAnchor = { x: 3.048, z: 2.4384 }
    const metres = entryLength("7'6", 'ftin')!
    const end = typedEndpoint(missAnchor, { x: 3.048, z: 0 }, metres)!
    const miss = probeTypedMiss([b34shell], missAnchor, end)
    const { ctx, png } = planContext(760, 560)
    drawPlan(ctx, {
      width: 760, height: 560,
      viewport: { center: { x: 3.2, z: 1.2 }, scale: 90 },
      walls: [b34shell], furniture: [], rooms: [],
      selection: null, units: 'ftin',
      anchor: missAnchor, cursor: { x: 3.048, z: 0 },
      showCursor: true, typed: "7'6", typedMiss: miss,
    })
    writeFileSync(`${OUT}/b34-typed-miss.png`, png())
    console.log(`b34-typed-miss.png  gap ${miss ? (miss.gap * 1000).toFixed(0) : '—'}mm  reaches ${miss?.reaches.toFixed(4)}m`)
  }
}

/* ── B33: the dimension chains, on the reference plan ── */

/**
 * The reference at its real size with a door swinging off the south wall, so
 * the four frames answer the brief's questions: do the chains read, is the
 * overall distinct from the stations, does the setout clear the swing, and
 * does 9.00 × 11.00 still read.
 */
{
  const walls = refPlan(1)
  const south = walls.find((x) => x.id === 's')!
  south.openings = [
    { id: 'main', type: 'door', position: 4.5, width: 1.0, height: 2.1, sill: 0, swing: { hand: 'start', side: 'left' } },
  ]
  const labels = refLabels(1)
  const { ctx, png } = planContext(880, 940)
  drawPlan(ctx, {
    width: 880, height: 940,
    viewport: { center: { x: 4.5, z: 5.5 }, scale: 56 },
    walls, furniture: [], rooms: resolveRoomsUncached(walls, labels),
    selection: null, units: 'm', anchor: null, cursor: null, showCursor: false,
  })
  writeFileSync(`${OUT}/b33-chains.png`, png())
  console.log('\nwrote b33-chains.png — reference plan, south door, chains + overalls')
}

/* ── B35: the declutter, at three zooms ── */

/**
 * The reference with suppression ON. What to look for: are the chains the
 * only dimensions (every wall is a bay or an overall here)? does anything
 * that SHOULD be labelled go missing? does the drawing still read as a
 * drawing at each zoom?
 */
console.log('')
for (const [name, scale] of [['b35-z30', 30], ['b35-z62', 62], ['b35-z120', 120]] as const) {
  const walls = refPlan(1)
  const labels = refLabels(1)
  const { ctx, png } = planContext(880, 940)
  drawPlan(ctx, {
    width: 880, height: 940,
    viewport: { center: { x: 4.5, z: 5.5 }, scale },
    walls, furniture: [], rooms: resolveRoomsUncached(walls, labels),
    selection: null, units: 'm', anchor: null, cursor: null, showCursor: false,
  })
  writeFileSync(`${OUT}/${name}.png`, png())
  console.log(`wrote ${name}.png at ${scale} px/m`)
}

console.log('')
for (const [name, k, scale] of [['ref-1x', 1, 62], ['ref-3x', 3, 21]] as const) {
  const walls = refPlan(k)
  const labels = refLabels(k)
  const { ctx, png } = planContext(880, 900)
  drawPlan(ctx, {
    width: 880, height: 900,
    viewport: { center: { x: 4.5 * k, z: 5.5 * k }, scale },
    walls,
    // Dimensions ON and furniture placed: the brief asks whether a caption
    // gaining a third line collides with either.
    showDimensions: true,
    furniture: [
      { id: 'f1', type: 'bed', position: { x: 1.5 * k, z: 1.2 * k }, rotation: 0, provenance: pv('manual') },
      { id: 'f2', type: 'sofa', position: { x: 3.2 * k, z: 5.2 * k }, rotation: 0, provenance: pv('manual') },
      { id: 'f3', type: 'table', position: { x: 6.2 * k, z: 5.8 * k }, rotation: 0, provenance: pv('manual') },
      { id: 'f4', type: 'kitchen-counter', position: { x: 1.5 * k, z: 8.6 * k }, rotation: 0, provenance: pv('manual') },
    ] as never,
    rooms: resolveRoomsUncached(walls, labels),
    selection: null, units: 'm',
    // A live draft, so the "type to set" hint is in frame too.
    anchor: { x: 0, z: 11 * k }, cursor: { x: 9 * k, z: 11 * k },
    showCursor: false,
  })
  writeFileSync(`${OUT}/b31-${name}.png`, png())
  const actual = extentOf(walls)!
  const dev = deviationFrom(actual, { width: 9, depth: 11 })!
  console.log(`b31-${name}.png  ${formatExtent(actual, 'm')}  ->  ${describeDeviation(dev)}  (shell 230 / partition 115)`)
}
