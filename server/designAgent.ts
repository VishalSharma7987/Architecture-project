import Anthropic from '@anthropic-ai/sdk'

/**
 * Floor-plan generation against the Claude API.
 *
 * This module is server-only — it is imported by the Vite dev server, never by
 * anything under `src/`. Keeping it out of the client bundle is what keeps the
 * API key off the wire.
 */

const MODEL = 'claude-opus-4-8'
const MAX_TOKENS = 16000

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

async function requestDesign(
  client: Anthropic,
  userContent: string,
): Promise<DesignResult> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    // Laying out a plan is a spatial reasoning problem — the model needs room
    // to work out room sizes and wall coordinates before committing to them.
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: DESIGN_SCHEMA },
    },
    messages: [{ role: 'user', content: userContent }],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined this request.')
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'The plan was too large to finish. Try a smaller or simpler brief.',
    )
  }

  const text = response.content.find((block) => block.type === 'text')
  if (!text || text.type !== 'text') {
    throw new Error('The model returned no design.')
  }

  // Structured outputs guarantee schema-conformant JSON, but this still runs
  // through the client's validator before it reaches the store.
  return JSON.parse(text.text) as DesignResult
}

export function generateDesign(client: Anthropic, brief: string) {
  return requestDesign(
    client,
    `Design a floor plan for this brief:\n\n${brief}`,
  )
}

export function editDesign(
  client: Anthropic,
  design: unknown,
  instruction: string,
) {
  return requestDesign(
    client,
    `Here is the current floor plan:

${JSON.stringify(design, null, 2)}

Apply this change:

${instruction}

Return the COMPLETE updated plan, including every wall you are keeping unchanged. Preserve the existing geometry wherever the instruction does not require altering it — do not redraw the building from scratch.`,
  )
}
