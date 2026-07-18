/**
 * The design signals thread activity with shadow depth instead of a count
 * badge ("Depth by shading only" — Forum.dc.html).
 *
 * The design computes this continuously: t = min(replies / 26, 1), feeding a
 * blur/spread/alpha ramp. We quantise to four steps instead, for two reasons:
 *
 *   1. Continuous values mean a unique inline `box-shadow` per card, which
 *      can't be expressed as a design token or a static class.
 *   2. The design's own thread on this decision settles on capping the ramp
 *      ("we capped it at three steps for exactly that reason"), so discrete
 *      steps match the stated intent rather than the prototype code.
 *
 * Returns a Tailwind class backed by --elev-* in globals.css.
 */
const ELEVATION_CLASSES = [
  "shadow-elev-0",
  "shadow-elev-1",
  "shadow-elev-2",
  "shadow-elev-3",
] as const;

export type ElevationClass = (typeof ELEVATION_CLASSES)[number];

/** Reply counts at or above each threshold move up a step. */
const THRESHOLDS = [0, 7, 16, 26] as const;

export function elevationForReplies(replyCount: number): ElevationClass {
  let step = 0;
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (replyCount >= THRESHOLDS[i]) {
      step = i;
      break;
    }
  }
  return ELEVATION_CLASSES[step];
}

/**
 * The design also swaps the card background at the hot end of the ramp
 * (t > 0.6 → `raisedHot`). 0.6 * 26 ≈ 16 replies, i.e. step 2 and up.
 */
export function surfaceForReplies(replyCount: number): "bg-raised" | "bg-raised-hot" {
  return replyCount >= THRESHOLDS[2] ? "bg-raised-hot" : "bg-raised";
}
