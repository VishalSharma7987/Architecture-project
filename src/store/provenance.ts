import type { Provenance } from './useDesignStore'

/**
 * The constructors for `Provenance`. One per origin, so a call site states
 * where its element came from and cannot half-state it.
 *
 * Every element-creating store action takes one of these EXPLICITLY rather than
 * defaulting to `manual`. That is not ceremony: `addWall` is called by the 2D
 * draw tool, by `buildWallsFromBlueprint` and by the blueprint panel's
 * "add detected walls" — two of its three callers are CV. A default would have
 * labelled machine output as hand-drawn, which is the precise failure L5 exists
 * to prevent. `architecture.test.ts` enforces that no element is built without
 * one.
 *
 * `createdAt` is read from the clock here, and only here. That is correct for
 * creation — it genuinely is the moment the element came into being. It is
 * emphatically NOT correct in a migration, which must take the date from the
 * file it is migrating; see the v2→v3 step in `persistence/schema.ts`.
 */
export const provenance = {
  /** The user drew it. Deterministic path, so full confidence. */
  manual: (): Provenance => ({
    source: 'manual',
    confidence: 1,
    createdAt: new Date().toISOString(),
  }),

  /**
   * The wall detector found it in a traced blueprint.
   *
   * **No `confidence`, deliberately.** The obvious candidate is
   * `scoreSegments`, but that returns total detected wall length in pixels: an
   * unbounded figure whose only job is ranking one binarisation against
   * another on the same image. It is not a quality measure and cannot be
   * rescaled into one — ADR 0002 measured it preferring 75 imaginary walls
   * totalling 77,592 px to 7 real walls totalling 6,300 px, so a HIGHER score
   * can mean a WORSE reading. Presenting it as a 0–1 confidence would put a
   * fabricated number in front of the user under the one field that exists to
   * tell them what to trust. Absent means "not assessed" (§6 C1), which is the
   * true state of affairs until B5b gives the scorer a sanity gate.
   */
  cv: (sourceRef?: string): Provenance => ({
    source: 'cv',
    createdAt: new Date().toISOString(),
    ...(sourceRef && { sourceRef }),
  }),

  /** A model produced it. `sourceRef` is the request id. */
  ai: (sourceRef?: string): Provenance => ({
    source: 'ai',
    createdAt: new Date().toISOString(),
    ...(sourceRef && { sourceRef }),
  }),

  /** Duplicated from another element. `sourceRef` is the original's id. */
  copy: (sourceRef: string): Provenance => ({
    source: 'copy',
    confidence: 1,
    createdAt: new Date().toISOString(),
    sourceRef,
  }),

  /** Came in through `parseDesign` from a file the user opened. */
  importJson: (sourceRef?: string): Provenance => ({
    source: 'import-json',
    createdAt: new Date().toISOString(),
    ...(sourceRef && { sourceRef }),
  }),
}
