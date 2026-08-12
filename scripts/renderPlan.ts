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
import type { RoomLabel, Wall } from '../src/store/useDesignStore'

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
  height: 3, thickness: t, openings, material: 'white-paint',
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
