// Generates sample 2D floor-plan blueprints as SVG.
// Usage: node gen-blueprint.mjs <variant> > out.svg     variant = simple | detailed | dark

const variant = process.argv[2] ?? 'simple'
const detailed = variant === 'detailed' || variant === 'dark'
const dark = variant === 'dark'

const W = 1600
const H = 1200

const ink = dark ? '#ffffff' : '#111111'
const paper = dark ? '#0b3a63' : '#ffffff'
const faint = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'

// --- geometry ------------------------------------------------------------
// 100 px = 1.00 m. Outer shell is 12.0 m x 9.0 m.
const PX_PER_M = 100

const walls = [
  // exterior shell, clockwise
  { a: [200, 150], b: [1400, 150], t: 16, openings: [
    { type: 'window', at: 180, w: 160 },
    { type: 'window', at: 760, w: 160 },
  ] },
  { a: [1400, 150], b: [1400, 1050], t: 16, openings: [
    { type: 'window', at: 200, w: 180 },
    { type: 'window', at: 600, w: 180 },
  ] },
  { a: [1400, 1050], b: [200, 1050], t: 16, openings: [
    { type: 'window', at: 240, w: 170 },
    { type: 'door', at: 700, w: 100, swing: 1 },
  ] },
  { a: [200, 1050], b: [200, 150], t: 16, openings: [
    { type: 'window', at: 320, w: 170 },
  ] },

  // interior partitions
  { a: [800, 150], b: [800, 650], t: 12, openings: [
    { type: 'door', at: 300, w: 90, swing: 1 },
  ] },
  { a: [200, 650], b: [1400, 650], t: 12, openings: [
    { type: 'door', at: 150, w: 90, swing: -1 },
    { type: 'door', at: 700, w: 90, swing: -1 },
  ] },
  { a: [500, 650], b: [500, 1050], t: 12, openings: [
    { type: 'door', at: 250, w: 85, swing: 1 },
  ] },
]

const rooms = [
  { label: 'LIVING ROOM', size: '6.00 × 5.00 m', c: [500, 400] },
  { label: 'KITCHEN', size: '6.00 × 5.00 m', c: [1100, 400] },
  { label: 'BATH', size: '3.00 × 4.00 m', c: [350, 850] },
  { label: 'BEDROOM', size: '9.00 × 4.00 m', c: [950, 850] },
]

// --- helpers -------------------------------------------------------------
const out = []
const push = (s) => out.push(s)

function seg(a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  return { ux: dx / len, uy: dy / len, len }
}

const at = (a, u, d) => [a[0] + u.ux * d, a[1] + u.uy * d]

/** Wall body, drawn as solid runs between its openings. */
function drawWall(wall) {
  const u = seg(wall.a, wall.b)
  const cuts = [...wall.openings].sort((p, q) => p.at - q.at)

  let cursor = 0
  for (const o of cuts) {
    const s = o.at - o.w / 2
    if (s > cursor) run(wall.a, u, cursor, s, wall.t)
    cursor = o.at + o.w / 2
  }
  if (cursor < u.len) run(wall.a, u, cursor, u.len, wall.t)

  for (const o of cuts) drawOpening(wall, u, o)
}

function run(origin, u, d0, d1, t) {
  const p = at(origin, u, d0)
  const q = at(origin, u, d1)
  push(
    `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" ` +
      `stroke="${ink}" stroke-width="${t}" stroke-linecap="butt"/>`,
  )
}

function drawOpening(wall, u, o) {
  const s = at(wall.a, u, o.at - o.w / 2)
  const e = at(wall.a, u, o.at + o.w / 2)
  // wall-normal, pointing "into" the swing side
  const n = [-u.uy, u.ux]

  if (o.type === 'window') {
    const h = wall.t / 2
    const pts = [
      [s[0] + n[0] * h, s[1] + n[1] * h],
      [e[0] + n[0] * h, e[1] + n[1] * h],
      [e[0] - n[0] * h, e[1] - n[1] * h],
      [s[0] - n[0] * h, s[1] - n[1] * h],
    ]
    push(
      `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" ` +
        `fill="${paper}" stroke="${ink}" stroke-width="3"/>`,
    )
    push(
      `<line x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" ` +
        `stroke="${ink}" stroke-width="3"/>`,
    )
    return
  }

  // door: leaf + quarter-circle swing arc
  const sw = o.swing ?? 1
  const hinge = s
  const leafEnd = [hinge[0] + n[0] * o.w * sw, hinge[1] + n[1] * o.w * sw]
  push(
    `<path d="M ${e[0]} ${e[1]} A ${o.w} ${o.w} 0 0 ${sw > 0 ? 1 : 0} ${leafEnd[0]} ${leafEnd[1]}" ` +
      `fill="none" stroke="${ink}" stroke-width="2.5"/>`,
  )
  push(
    `<line x1="${hinge[0]}" y1="${hinge[1]}" x2="${leafEnd[0]}" y2="${leafEnd[1]}" ` +
      `stroke="${ink}" stroke-width="5"/>`,
  )
}

/** Dimension line with ticks and a metre reading. */
function dim(a, b, offset, text) {
  const u = seg(a, b)
  const n = [-u.uy, u.ux]
  const p = [a[0] + n[0] * offset, a[1] + n[1] * offset]
  const q = [b[0] + n[0] * offset, b[1] + n[1] * offset]
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  const vertical = Math.abs(u.uy) > 0.5

  push(`<g stroke="${faint}" stroke-width="1.5" fill="none">`)
  push(`<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`)
  for (const [pt, base] of [[p, a], [q, b]]) {
    push(`<line x1="${base[0]}" y1="${base[1]}" x2="${pt[0]}" y2="${pt[1]}"/>`)
    push(
      `<line x1="${pt[0] - u.ux * 8 - n[0] * 8}" y1="${pt[1] - u.uy * 8 - n[1] * 8}" ` +
        `x2="${pt[0] + u.ux * 8 + n[0] * 8}" y2="${pt[1] + u.uy * 8 + n[1] * 8}" stroke-width="2"/>`,
    )
  }
  push('</g>')
  const rot = vertical ? ` transform="rotate(-90 ${mid[0]} ${mid[1] - 8})"` : ''
  push(
    `<text x="${mid[0]}" y="${mid[1] - 8}" text-anchor="middle"${rot} ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="22" fill="${ink}">${text}</text>`,
  )
}

// --- compose -------------------------------------------------------------
push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
push(`<rect width="${W}" height="${H}" fill="${paper}"/>`)

if (detailed) {
  // faint construction grid, 0.5 m
  push(`<g stroke="${faint}" stroke-width="0.6" opacity="0.45">`)
  for (let x = 0; x <= W; x += PX_PER_M / 2) push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`)
  for (let y = 0; y <= H; y += PX_PER_M / 2) push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`)
  push('</g>')
}

for (const w of walls) drawWall(w)

for (const r of rooms) {
  push(
    `<text x="${r.c[0]}" y="${r.c[1]}" text-anchor="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="bold" ` +
      `letter-spacing="2" fill="${ink}">${r.label}</text>`,
  )
  if (detailed) {
    push(
      `<text x="${r.c[0]}" y="${r.c[1] + 30}" text-anchor="middle" ` +
        `font-family="Helvetica, Arial, sans-serif" font-size="20" fill="${faint}">${r.size}</text>`,
    )
  }
}

if (detailed) {
  dim([200, 150], [800, 150], -45, '6.00')
  dim([800, 150], [1400, 150], -45, '6.00')
  dim([1400, 150], [1400, 1050], -60, '9.00')
  dim([200, 1050], [200, 150], -60, '9.00')
  dim([200, 1050], [1400, 1050], 62, '12.00 m')

  // scale bar
  const bx = 200
  const by = 1150
  push(`<g font-family="Helvetica, Arial, sans-serif" font-size="18" fill="${ink}">`)
  for (let i = 0; i < 4; i++) {
    push(
      `<rect x="${bx + i * 50}" y="${by}" width="50" height="12" ` +
        `fill="${i % 2 ? paper : ink}" stroke="${ink}" stroke-width="1.5"/>`,
    )
  }
  push(`<text x="${bx}" y="${by - 8}">0</text>`)
  push(`<text x="${bx + 200}" y="${by - 8}" text-anchor="middle">2 m</text>`)
  push('</g>')

  // north arrow
  push(
    `<g transform="translate(1470,1120)" fill="${ink}" stroke="${ink}">` +
      `<path d="M 0 -40 L 14 14 L 0 4 L -14 14 Z" stroke-width="2"/>` +
      `<text x="0" y="38" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" ` +
      `font-size="20" stroke="none">N</text></g>`,
  )

  push(
    `<text x="200" y="52" font-family="Helvetica, Arial, sans-serif" font-size="30" ` +
      `font-weight="bold" letter-spacing="3" fill="${ink}">GROUND FLOOR PLAN — SCALE 1:100</text>`,
  )
}

push('</svg>')
process.stdout.write(out.join('\n'))
