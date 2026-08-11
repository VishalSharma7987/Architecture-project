/**
 * The one distance below which two points are the same point.
 *
 * ── DO NOT RAISE THIS TO CLOSE A GAP YOU CAN SEE ──
 * This is a FLOAT-NOISE GUARD, not an interpretation layer. It exists so that
 * two walls drawn to the same corner weld despite the last bits of a double,
 * and for nothing else.
 *
 * The temptation is real and it has a measured shape. A diagnostic on a real
 * 30-wall plan found interior partitions ending **100–152 mm** from the wall
 * they were meant to meet, which collapsed room detection from 5 rooms to 1.
 * Raising this constant far enough to close those gaps would:
 *
 *   - exceed `LIMITS.wallThickness.min` (20 mm), so two legally distinct walls
 *     would fuse into one;
 *   - approach the ft-in drawing grid (152.4 mm), so which endpoints weld
 *     would depend on where the user happened to click;
 *   - merge two real rooms into one SILENTLY, which is a worse failure than
 *     today's, because today's is visible on screen and that one is not.
 *
 * **A gap you can see is a modelling problem, not a tolerance problem.** Fix
 * it where the coordinates are written — endpoint snapping while drawing, and
 * welding on CV/AI ingest — not here.
 *
 * ── Why 15 mm and not 1 mm ──
 * It was 1 mm, which is under the noise floor of anything that has been
 * through a rotation or a scale: the same diagnostic showed ±4 mm of endpoint
 * jitter deleting **every edge in the graph** and yielding zero rooms, because
 * a near-miss makes a node degree-1 and `pruneDangles` then cascades. 15 mm is
 * chosen against three bounds:
 *
 *   | bound                                   | value    |
 *   |-----------------------------------------|----------|
 *   | thinnest legal wall (must not fuse two) |  20 mm   |
 *   | ft-in grid step (must stay predictable) | 152.4 mm |
 *   | metric grid step                        | 500 mm   |
 *
 * 15 mm sits below the first and at ~10% of the second, so it absorbs noise
 * without ever making a drawing decision for the user.
 */
export const JOIN_TOLERANCE = 0.015

/** True when two floor-plane points are the same point within tolerance. */
export const samePlacePoint = (
  a: { x: number; z: number },
  b: { x: number; z: number },
): boolean => Math.hypot(a.x - b.x, a.z - b.z) <= JOIN_TOLERANCE
