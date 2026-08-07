/**
 * Reads a floor-plan image: its real-world scale, its doors and windows, and
 * the rooms and furniture drawn on it.
 *
 * Server-only, like the rest of this folder: the keys stay in the Node process.
 *
 * Detection runs on OpenRouter with a FREE, non-Claude vision model — this
 * project deliberately does not use Claude/Anthropic, and a free model also
 * sidesteps OpenRouter's out-of-credit 402. A plain fetch in the OpenAI
 * chat-completions format is all it needs.
 *
 * Free models are rate-limited upstream, so the read is tried across SEVERAL
 * OpenRouter keys in turn: when one account is throttled, the next answers.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * The vision model. Free (`:free`) so it never touches account credit. If this
 * id 404s it has been renamed — pick another from https://openrouter.ai/models
 * filtered to free + image input; it MUST accept images, as this reads one.
 */
const MODEL = 'google/gemma-4-26b-a4b-it:free'

/** Output cap — just large enough for the compact JSON below. */
const MAX_TOKENS = 1200

/**
 * How many times each key is asked before giving up.
 *
 * Two, not more: the model is sampled, so a blank read is often just an unlucky
 * roll and a second ask usually lands — but a plan this model genuinely cannot
 * read will not become legible on the fifth attempt, and every retry is another
 * request against a free tier that rate-limits.
 */
const ATTEMPTS_PER_KEY = 2

/*
 * The reply uses short keys and array tuples, not readable objects, purely to
 * spend as few output tokens as possible — the binding constraint here is the
 * token budget, not legibility. The parser also accepts the old verbose shape,
 * so a model that ignores the compactness instruction still parses.
 */
const PROMPT = `This is an architectural floor plan image. Report it as compact JSON.

1. SCALE. Read the overall dimension labels on the drawing — the figures like "40'" along one side and "30'" along another that give the building's size. Report the building's real width and depth in feet as numbers "w" (horizontal, left-to-right) and "d" (vertical). If a dimension is not legible, use null for it — do not guess.

2. BUILDING BOX. Give the bounding box of the building's outer walls as "box": [x0, y0, x1, y1], each a number 0..1, where (0,0) is the top-left of the image. This is the rectangle "w" and "d" measure across.

3. OPENINGS. Find EVERY door and every window. Be thorough: include interior doors between rooms and closets, and a window on each exterior wall. A door is a gap in a wall, usually with a thin quarter-circle swing arc; a window is a gap marked with thin parallel lines. Report openings as "o": a list of [t, x, y, width] tuples, where t is "d" for a door or "w" for a window, x and y are the opening's CENTRE normalized 0..1, and width is a fraction of the image width (a single door is around 0.03 to 0.08).

4. ROOMS. For every labelled room, read its printed name. Report "r": a list of [name, x, y] tuples, where name is the room's label in lowercase (e.g. "kitchen", "master bedroom", "bedroom", "living", "dining", "bathroom", "toilet", "study", "store", "balcony", "pooja"), and x, y are the CENTRE of that room normalized 0..1 — the spot its label text sits.

5. FURNITURE. Find the furniture drawn inside the rooms — beds, sofas, dining and coffee tables, chairs, desks. Ignore plumbing fixtures and kitchen appliances. Report "f": a list of [kind, x, y] tuples, where kind is one of "bed", "sofa", "table", "chair", "desk", and x, y are the CENTRE of that piece normalized 0..1.

To save space use ONLY these short keys and tuple form. Return ONLY this JSON object and nothing else — no prose, no code fence:
{"w":40,"d":30,"box":[0.1,0.1,0.9,0.8],"o":[["d",0.5,0.3,0.05],["w",0.2,0.1,0.06]],"r":[["kitchen",0.7,0.3],["bedroom",0.25,0.3]],"f":[["bed",0.25,0.25],["sofa",0.6,0.7]]}`

export type RawOpening = {
  type: 'door' | 'window'
  x: number
  y: number
  width: number
}

export type PlanBox = { x0: number; y0: number; x1: number; y1: number }

/**
 * A named thing at a normalized point — a room's label or a furniture piece.
 * The raw name is passed through as read; the client maps it to its own room
 * and furniture vocabularies (which are disjoint, so one list can hold both on
 * the salvage path and the client sorts them).
 */
export type RawLabel = { name: string; x: number; y: number }

export type PlanAnalysis = {
  /** Real building width in feet, or null when no dimension was legible. */
  widthFeet: number | null
  /** Real building depth in feet, or null. */
  depthFeet: number | null
  /** Normalized bounding box of the outer walls, or null. */
  box: PlanBox | null
  openings: RawOpening[]
  rooms: RawLabel[]
  furniture: RawLabel[]
}

/**
 * Strips what a model wraps around its JSON: a reasoning model's
 * `<think>…</think>` block (closed or cut off), then a ```json code fence.
 */
function unfence(text: string): string {
  // Drop a closed think block, or an unclosed one that ran to the end.
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  if (out.includes('<think>')) out = out.slice(0, out.indexOf('<think>'))
  const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (fenced ? fenced[1] : out).trim()
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null

/** In-frame with a little slop, so a wall snap can absorb the coordinate error. */
const inFrame = (o: RawOpening) =>
  o.x > -0.1 && o.x < 1.1 && o.y > -0.1 && o.y < 1.1

const asType = (v: unknown): 'door' | 'window' | null =>
  v === 'd' || v === 'door' ? 'door' : v === 'w' || v === 'window' ? 'window' : null

/** One opening from either the compact `[t,x,y,w]` tuple or the old object. */
function parseOpening(v: unknown): RawOpening | null {
  if (Array.isArray(v)) {
    const [t, x, y, width] = v
    const type = asType(t)
    if (!type || ![x, y, width].every((n) => typeof n === 'number')) return null
    const opening = { type, x, y, width } as RawOpening
    return inFrame(opening) ? opening : null
  }
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    const type = asType(o.type)
    if (!type || !['x', 'y', 'width'].every((k) => typeof o[k] === 'number')) {
      return null
    }
    const opening = { type, x: o.x, y: o.y, width: o.width } as RawOpening
    return inFrame(opening) ? opening : null
  }
  return null
}

/** One labelled point from a `[name,x,y]` tuple or a `{name/type,x,y}` object. */
function parseLabel(v: unknown): RawLabel | null {
  let name: unknown
  let x: unknown
  let y: unknown
  if (Array.isArray(v)) {
    ;[name, x, y] = v
  } else if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    name = o.name ?? o.type ?? o.label
    x = o.x
    y = o.y
  } else {
    return null
  }
  if (typeof name !== 'string' || !name.trim()) return null
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) return null
  return { name: name.trim().toLowerCase(), x, y }
}

const parseLabels = (v: unknown): RawLabel[] =>
  Array.isArray(v)
    ? v.map(parseLabel).filter((l): l is RawLabel => l !== null)
    : []

/** Accepts the compact `[x0,y0,x1,y1]` array or the old `{x0,y0,x1,y1}` object. */
function parseBox(v: unknown): PlanBox | null {
  let box: PlanBox | null = null
  if (Array.isArray(v) && v.length >= 4 && v.every((n) => typeof n === 'number')) {
    box = { x0: v[0], y0: v[1], x1: v[2], y1: v[3] }
  } else if (typeof v === 'object' && v !== null) {
    const b = v as Record<string, unknown>
    const keys = ['x0', 'y0', 'x1', 'y1'] as const
    if (keys.every((k) => typeof b[k] === 'number')) {
      box = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } as PlanBox
    }
  }
  // A degenerate box carries no scale, so reject it rather than divide by zero.
  return box && box.x1 > box.x0 && box.y1 > box.y0 ? box : null
}

/**
 * Pulls complete `["d",x,y,w]` / `["w",x,y,w]` tuples out of raw text.
 *
 * The fallback for a reply the token budget cut off mid-array: `JSON.parse`
 * rejects truncated JSON whole, losing every opening including the ones that
 * did arrive. Matching the closed tuples directly keeps that prefix — partial
 * detection beats none on the shoestring budget this runs under.
 */
function salvageOpenings(text: string): RawOpening[] {
  const tuple = /\[\s*"([dw])"\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g
  const out: RawOpening[] = []
  for (const m of text.matchAll(tuple)) {
    const opening = parseOpening([m[1], Number(m[2]), Number(m[3]), Number(m[4])])
    if (opening) out.push(opening)
  }
  return out
}

/** Every complete `["name",x,y]` tuple in a slice of text. */
function matchLabels(text: string): RawLabel[] {
  const tuple = /\[\s*"([^"]+)"\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g
  const out: RawLabel[] = []
  for (const m of text.matchAll(tuple)) {
    const label = parseLabel([m[1], Number(m[2]), Number(m[3])])
    if (label) out.push(label)
  }
  return out
}

/**
 * Splits the salvaged `["name",x,y]` tuples into rooms and furniture — the room
 * and furniture recovery for a truncated reply.
 *
 * The format lists rooms (`"r"`) before furniture (`"f"`), so the `"f":` marker
 * cleanly divides them even when the tail is cut: tuples before it are rooms,
 * tuples after it are furniture. Keeping them apart here is what stops the
 * ambiguity that "bedroom" contains "bed" — a room and a furniture word never
 * meet in the same bucket. Three-field tuples cannot match a four-field
 * opening, so the openings section (before `"r"`) contributes nothing.
 */
function salvageLabels(text: string): { rooms: RawLabel[]; furniture: RawLabel[] } {
  const fIdx = text.search(/"f"\s*:/)
  const roomsText = fIdx >= 0 ? text.slice(0, fIdx) : text
  const furnText = fIdx >= 0 ? text.slice(fIdx) : ''
  return { rooms: matchLabels(roomsText), furniture: matchLabels(furnText) }
}

/**
 * Reads the plan in `image` (a base64 data URL), trying each OpenRouter key in
 * turn until one returns a usable read. A free model rate-limits per account, so
 * a second key roughly doubles the budget and covers the first being throttled.
 *
 * The scale figures let the caller size the building to its real dimensions;
 * the openings, rooms and furniture are in NORMALIZED coordinates, deliberately
 * approximate — the caller snaps or places each, which absorbs the model's
 * coordinate error.
 */
export async function analysePlan(
  keys: string[],
  imageDataUrl: string,
): Promise<PlanAnalysis> {
  const available = keys.filter((k) => k && k.trim())
  if (available.length === 0) {
    throw new Error('No OpenRouter API key is configured.')
  }

  const failures: string[] = []
  // The best result seen so far, kept in case every later attempt also comes
  // back thin — a partial read still beats reporting nothing at all.
  let bestEmpty: PlanAnalysis | null = null

  // Each key gets more than one go. The model is sampled, not deterministic:
  // the same plan can come back fully read on one call and empty on the next,
  // which is what makes detection feel like it "sometimes works". Asking again
  // costs one request and turns most of those misses into hits.
  for (let round = 0; round < ATTEMPTS_PER_KEY; round++) {
    for (let i = 0; i < available.length; i++) {
      try {
        const analysis = await callModel(available[i], imageDataUrl)
        if (!isEmptyAnalysis(analysis)) return analysis
        // Read nothing: keep it as a fallback and try again rather than
        // handing back a blank plan the user has to interpret.
        bestEmpty ??= analysis
      } catch (error) {
        // Record and try the next key. Only when everything has failed does the
        // combined message surface — usually every key rate-limited at once.
        failures.push(
          `key ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  // Every attempt either failed outright or read nothing. An empty-but-valid
  // read is still an answer; only a total failure is an error.
  if (bestEmpty) return bestEmpty
  throw new Error(`Detection failed. ${failures.join(' | ')}`)
}

/**
 * True when a read found nothing usable — no openings, rooms or furniture, and
 * no building box. Worth another attempt; a read with any of them is not.
 */
function isEmptyAnalysis(a: PlanAnalysis): boolean {
  return (
    a.openings.length === 0 &&
    a.rooms.length === 0 &&
    a.furniture.length === 0 &&
    a.box === null
  )
}

/** One request with a given key, then parse the completion into an analysis. */
async function callModel(
  apiKey: string,
  imageDataUrl: string,
): Promise<PlanAnalysis> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`returned ${response.status}. ${detail.slice(0, 200)}`)
  }

  const payload = (await response.json()) as {
    error?: { message?: string }
    choices?: { message?: { content?: string } }[]
  }
  if (payload.error) {
    throw new Error(payload.error.message ?? 'request failed')
  }

  const text = payload.choices?.[0]?.message?.content
  if (!text) throw new Error('the model returned no result')

  return parseCompletion(text)
}

/** Turns the model's reply text into an analysis — shared across providers. */
function parseCompletion(text: string): PlanAnalysis {
  const body = unfence(text)

  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(body) as Record<string, unknown>
  } catch {
    // Left null — handled below. A budget-truncated reply lands here, and the
    // scale/box are usually lost with it, but the openings can still be
    // salvaged, which is the part that matters most.
  }

  if (parsed) {
    // `w`/`d`/`box`/`o`/`r`/`f` are the compact keys; the `??` reach for the old
    // verbose keys so a model that ignored the format still parses.
    const rawOpenings = Array.isArray(parsed.o)
      ? parsed.o
      : Array.isArray(parsed.openings)
        ? parsed.openings
        : []
    return {
      widthFeet: num(parsed.w) ?? num(parsed.widthFeet),
      depthFeet: num(parsed.d) ?? num(parsed.depthFeet),
      box: parseBox(parsed.box),
      openings: rawOpenings
        .map(parseOpening)
        .filter((o): o is RawOpening => o !== null),
      rooms: parseLabels(parsed.r ?? parsed.rooms),
      furniture: parseLabels(parsed.f ?? parsed.furniture),
    }
  }

  // Truncated or otherwise unparseable: recover whatever complete tuples the
  // text still holds rather than fail the whole detection. Every salvaged label
  // is offered as both a room and a furniture candidate — the client keeps only
  // the ones its (disjoint) vocabularies recognise.
  const openings = salvageOpenings(body)
  const labels = salvageLabels(body)
  if (
    openings.length === 0 &&
    labels.rooms.length === 0 &&
    labels.furniture.length === 0
  ) {
    throw new Error('The model did not return readable JSON.')
  }
  return {
    widthFeet: null,
    depthFeet: null,
    box: null,
    openings,
    rooms: labels.rooms,
    furniture: labels.furniture,
  }
}
