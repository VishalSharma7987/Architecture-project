/**
 * Floor-plan generation against the Claude API.
 *
 * This module is server-only — it is imported by the Vite dev server, never by
 * anything under `src/`. Keeping it out of the client bundle is what keeps the
 * API key off the wire.
 */

// OpenRouter model id. This app's key is an OpenRouter key, so — like the
// vision detector — the request goes to OpenRouter's OpenAI-format endpoint,
// NOT the Anthropic SDK (whose native output_config/thinking OpenRouter does
// not accept, and whose default endpoint rejects an OpenRouter key outright).
const MODEL = 'anthropic/claude-sonnet-4.5'
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_TOKENS = 6000

const POINT_SCHEMA = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    z: { type: 'number' },
  },
  required: ['x', 'z'],
  additionalProperties: false,
}

const OPENING_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['door', 'window'] },
    position: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    sill: { type: 'number' },
  },
  required: ['type', 'position', 'width', 'height', 'sill'],
  additionalProperties: false,
}

/**
 * Mirrors the app's `Wall` shape minus `id` — ids are assigned by the client's
 * validator, so the model never has to invent unique strings.
 */
const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    notes: { type: 'string' },
    walls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: POINT_SCHEMA,
          end: POINT_SCHEMA,
          height: { type: 'number' },
          thickness: { type: 'number' },
          openings: { type: 'array', items: OPENING_SCHEMA },
        },
        required: ['start', 'end', 'height', 'thickness', 'openings'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'notes', 'walls'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `You design architectural floor plans as structured data for a 3D space-planning app.

COORDINATE SYSTEM
- Units are metres on a horizontal plane. A point is {x, z}.
- +x runs right (east), +z runs down the page (south) in plan view. Height is a separate field, not a coordinate.
- Keep the building roughly centred on the origin. A 20m x 14m building should span about x -10..10 and z -7..7.
- Snap every coordinate to a 0.5 m grid. The editor snaps to 0.5 m, so off-grid points look wrong next to hand-drawn walls.

WALLS
- A wall is a straight segment from "start" to "end". There are no curves and no arcs.
- Rooms are enclosed by walls whose endpoints match EXACTLY. To close a rectangle, the 4th wall's end must equal the 1st wall's start, digit for digit. Near-misses leave visible gaps in 3D.
- Interior partitions must land exactly on the exterior wall they meet, so corners join cleanly.
- Do not stack two walls along the same line, and do not cross one wall through another mid-span. Split a wall into two segments at the junction instead.
- Defaults: height 3. Thickness 0.3 for exterior walls, 0.15 for interior partitions.

OPENINGS
- "position" is the distance in metres from that wall's OWN start point to the opening's centre — not a coordinate.
- An opening must fit entirely on its wall: position must be at least width/2, and at most (wall length - width/2). A 0.9 m door on a 4 m wall is valid anywhere from 0.45 to 3.55.
- Doors: sill 0, height 2.1, width 0.9 (1.6 for double doors on a main entrance).
- Windows: sill 0.9, height 1.4, width 1.2 to 2.4.
- Never put an opening within 0.4 m of either end of a wall — it would cut through the corner.

MAKING PLANS THAT WORK
- Every enclosed room needs a door. A room with four solid walls is unusable; check each one before finishing.
- The building needs at least one entrance door on an exterior wall.
- Put windows on exterior walls only. Interior partitions get doors, and glazing only if the brief asks.
- Rooms connect through a circulation space (corridor, lobby, or the open-plan floor) rather than only through each other.

SPACE STANDARDS (use these to size rooms, do not quote them back)
- Open-plan desk: 6-8 m² per person including circulation.
- Meeting room: 2 m² per seat, minimum 9 m². A 6-person room is about 3.5 x 4 m.
- Reception / waiting: 12-20 m².
- Corridors: 1.2 m wide minimum, 1.5 m for a main route.
- Bedroom: 9-14 m². Bathroom: 4-6 m². Kitchen: 8-12 m².

Set "name" to a short title for the design. Set "notes" to one or two sentences on the layout and how you sized it — this is shown to the user, so write it for a person, not as a data dump.`

export type DesignResult = {
  name: string
  notes: string
  walls: unknown[]
}

/**
 * Tries each OpenRouter key in turn, returning the first that answers.
 *
 * A key that is out of credit (402), rejected (401) or erroring hands off to
 * the next — so a second funded key covers for a spent one without the user
 * doing anything. Only when every key has failed does the combined error
 * surface, so the message says what went wrong with each rather than just the
 * last.
 */
async function requestDesign(
  keys: string[],
  userContent: string,
): Promise<DesignResult> {
  const available = keys.filter((k) => k && k.trim())
  if (available.length === 0) {
    throw new Error('No OpenRouter API key is configured.')
  }

  const failures: string[] = []
  for (let i = 0; i < available.length; i++) {
    try {
      return await callOnce(available[i], userContent)
    } catch (error) {
      failures.push(
        `key ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Every key failed. If they all ran out of credit, say that plainly rather
  // than dumping the raw list.
  if (failures.every((f) => f.includes('out of credit'))) {
    throw new Error(
      'Every AI key is out of credit. Top one up at openrouter.ai to generate plans.',
    )
  }
  throw new Error(`Could not generate a plan. ${failures.join(' | ')}`)
}

/** One OpenRouter attempt with a single key. Throws on any failure. */
async function callOnce(
  apiKey: string,
  userContent: string,
): Promise<DesignResult> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // The schema lives in the system prompt; json_object is the widest
      // response-format constraint every provider on OpenRouter honours.
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            SYSTEM_PROMPT +
            '\n\nReturn a JSON object matching this JSON Schema exactly:\n' +
            JSON.stringify(DESIGN_SCHEMA),
        },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new Error('The AI key was rejected. Check the key in .env.')
    }
    if (response.status === 402) {
      throw new Error(
        'The AI account is out of credit. Top it up at openrouter.ai to generate plans.',
      )
    }
    throw new Error(`The AI service returned ${response.status}. ${detail.slice(0, 200)}`)
  }

  const payload = (await response.json()) as {
    error?: { message?: string }
    choices?: { message?: { content?: string }; finish_reason?: string }[]
  }
  if (payload.error) throw new Error(payload.error.message ?? 'The AI request failed.')

  const choice = payload.choices?.[0]
  if (choice?.finish_reason === 'length') {
    throw new Error('The plan was too large to finish. Try a smaller or simpler brief.')
  }
  const text = choice?.message?.content
  if (!text) throw new Error('The model returned no design.')

  // The schema is instructed, not enforced, so strip any code fence and parse.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  try {
    return JSON.parse((fenced ? fenced[1] : text).trim()) as DesignResult
  } catch {
    throw new Error('The model did not return a readable plan.')
  }
}

export function generateDesign(keys: string[], brief: string) {
  return requestDesign(
    keys,
    `Design a floor plan for this brief:\n\n${brief}`,
  )
}

export function editDesign(
  keys: string[],
  design: unknown,
  instruction: string,
) {
  return requestDesign(
    keys,
    `Here is the current floor plan:

${JSON.stringify(design, null, 2)}

Apply this change:

${instruction}

Return the COMPLETE updated plan, including every wall you are keeping unchanged. Preserve the existing geometry wherever the instruction does not require altering it — do not redraw the building from scratch.`,
  )
}
