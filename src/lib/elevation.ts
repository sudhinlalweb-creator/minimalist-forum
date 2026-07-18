/**
 * The design signals thread activity with depth instead of a count badge
 * ("Depth by shading only" — Forum.dc.html).
 *
 * Under the Notion-style flat treatment there are no drop shadows to carry
 * that, so the same signal is expressed as border weight plus a faint grey
 * fill: a hotter thread sits on a darker surface behind a harder outline.
 * The ramp and its thresholds are unchanged — only the medium is.
 *
 * The design computes depth continuously: t = min(replies / 26, 1), feeding a
 * blur/spread/alpha ramp. We quantise to four steps instead, for two reasons:
 *
 *   1. Continuous values mean a unique inline style per card, which can't be
 *      expressed as a design token or a static class.
 *   2. The design's own thread on this decision settles on capping the ramp
 *      ("we capped it at three steps for exactly that reason"), so discrete
 *      steps match the stated intent rather than the prototype code.
 *
 * Returns Tailwind classes backed by --act-* in globals.css.
 */
const ACTIVITY_CLASSES = [
  "border bg-act-0 border-act-0-edge",
  "border bg-act-1 border-act-1-edge",
  "border bg-act-2 border-act-2-edge",
  "border bg-act-3 border-act-3-edge",
] as const;

export type ActivityClass = (typeof ACTIVITY_CLASSES)[number];

/** Reply counts at or above each threshold move up a step. */
const THRESHOLDS = [0, 7, 16, 26] as const;

export function activityForReplies(replyCount: number): ActivityClass {
  let step = 0;
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (replyCount >= THRESHOLDS[i]) {
      step = i;
      break;
    }
  }
  return ACTIVITY_CLASSES[step];
}
