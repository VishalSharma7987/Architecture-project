/**
 * Did a share, download or chat step resize these images on the way here?
 *
 * ── The observation this exists for ──
 * Corpus batch 3 arrived as four genuine CAD drawings measuring 474×693,
 * 474×842, 473×496 and 473×494. Four different drawings, four different aspect
 * ratios — 0.68, 0.56, 0.95, 0.96 — and all four within one pixel of the same
 * WIDTH. Nothing about four unrelated drawings makes their widths agree. A
 * pipeline that normalises everything to a fixed width does exactly that.
 *
 * Every gate then refused them, each in its own vocabulary, and every refusal
 * was really about that one fact. The user could have fixed all of it by
 * re-sending the files a different way, and nothing told them so.
 *
 * ── Why it is a cross-file test and cannot be anything else ──
 * On ONE image the signature is invisible: 474×693 is an unremarkable size.
 * Within-file provenance signals were measured and deliberately NOT shipped —
 * see `docs/testing/corpus-batch-3-gates.md`. Edge softness rises monotonically
 * with downsampling (0.30 native → 0.48 at 474 px → 0.76 at 180 px) and
 * batch 3's img3 contains no true black at all (darkest 0.5% at luminance 89).
 * Both are real. Neither separates a downsampled copy from a small native
 * vector export, because a native export anti-aliases its thin lines too. A
 * provenance claim on that evidence would be a guess with a number attached.
 *
 * Across files there is no such ambiguity, and the test needs no pixels
 * decoded — only the natural dimensions every `Blueprint` already carries.
 *
 * ── What it can get wrong ──
 * A practice that exports every sheet at a fixed pixel width from CAD would
 * trip this, and for them "the originals will work" is wrong advice. That is
 * accepted: the message costs a sentence, names a checkable fact about their
 * own files, and the alternative is silence in the case that has actually
 * occurred. It is a note, never a refusal.
 */

/** Natural dimensions of one image the user has supplied this session. */
export type ImageObservation = {
  fileName: string
  width: number
  height: number
}

export type TransportSignature = {
  /** The axis that is pinned. */
  axis: 'width' | 'height'
  /** The pinned extent, as a range — batch 3 spans 473–474, not one value. */
  low: number
  high: number
  /** The observations that agree, in the order they were seen. */
  images: ImageObservation[]
}

/**
 * How far apart two "identical" widths may sit.
 *
 * A resize to a target width lands on 473 or 474 depending on how the source
 * aspect rounded, so an exact match is too strict. Two pixels is the smallest
 * slack that admits batch 3's 473/474 and stays far below any distance a
 * deliberate choice of size would produce.
 */
export const TRANSPORT_AXIS_TOLERANCE_PX = 2

const spread = (values: number[]) => Math.max(...values) - Math.min(...values)

/**
 * The pinned axis, or null.
 *
 * Needs BOTH halves of the signature:
 *
 *   - one axis agreeing across images to within the tolerance, AND
 *   - the other axis varying by MORE than the tolerance.
 *
 * The second half is what keeps this from firing on a set of same-size images.
 * Three exports that are all 800×600 have agreeing widths, but they also have
 * agreeing heights — that is one export setting, not a pipeline reshaping
 * drawings of different shapes to a common width. Re-picking the same file to
 * restore its pixels is the commonest way that would otherwise happen, which is
 * why callers should dedupe by file name as well.
 */
export function detectFixedAxisTransport(
  observations: ImageObservation[],
): TransportSignature | null {
  if (observations.length < 2) return null

  const widths = observations.map((o) => o.width)
  const heights = observations.map((o) => o.height)

  const widthPinned = spread(widths) <= TRANSPORT_AXIS_TOLERANCE_PX
  const heightPinned = spread(heights) <= TRANSPORT_AXIS_TOLERANCE_PX

  if (widthPinned && !heightPinned) {
    return {
      axis: 'width',
      low: Math.min(...widths),
      high: Math.max(...widths),
      images: observations,
    }
  }
  if (heightPinned && !widthPinned) {
    return {
      axis: 'height',
      low: Math.min(...heights),
      high: Math.max(...heights),
      images: observations,
    }
  }
  return null
}

const COUNT_WORDS = ['', '', 'Both', 'All three', 'All four', 'All five', 'All six']

/**
 * What the user is told.
 *
 * States the fact about their own files first, because it is checkable and
 * they may recognise how it happened; then the cause; then the action. No
 * hedging — the signature is not ambiguous enough to warrant it, and a
 * sentence that says "may have possibly been resized" gets skimmed past.
 */
export function transportMessage(signature: TransportSignature): string {
  const n = signature.images.length
  const subject =
    n < COUNT_WORDS.length
      ? `${COUNT_WORDS[n]} drawings you've added are`
      : `All ${n} drawings you've added are`
  const extent =
    signature.low === signature.high
      ? `${signature.low} px`
      : `${signature.low}–${signature.high} px`

  return (
    `${subject} ${extent} ${signature.axis === 'width' ? 'wide' : 'tall'} — ` +
    "they've been resized by whatever you sent them through. The originals " +
    'will work.'
  )
}

/**
 * Adds one image to the session's record, newest last.
 *
 * Deduped by file name: re-picking the same file to restore its pixels after a
 * reload is one image seen twice, not two images that happen to agree. Capped
 * so a long session cannot grow it without bound; the cap is far above the
 * two observations the signature needs.
 */
export const MAX_TRACKED_IMAGES = 20

export function rememberImage(
  seen: ImageObservation[],
  next: ImageObservation,
): ImageObservation[] {
  const withoutDuplicate = seen.filter((o) => o.fileName !== next.fileName)
  return [...withoutDuplicate, next].slice(-MAX_TRACKED_IMAGES)
}
