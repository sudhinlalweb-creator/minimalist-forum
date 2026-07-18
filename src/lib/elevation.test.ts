import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { activityForReplies } from "./elevation";

/**
 * The ramp is quantised at 0 / 7 / 16 / 26 replies. These tests pin the
 * boundaries rather than the class strings' contents, except where a class
 * has to carry `border` for the Tailwind utility to apply at all — that one
 * is easy to drop in a refactor and produces a borderless card rather than a
 * visible failure.
 */

const STEP_0 = activityForReplies(0);
const STEP_1 = activityForReplies(7);
const STEP_2 = activityForReplies(16);
const STEP_3 = activityForReplies(26);

describe("activityForReplies", () => {
  it("returns a distinct class set per step", () => {
    const steps = new Set([STEP_0, STEP_1, STEP_2, STEP_3]);
    assert.equal(steps.size, 4, "steps must be visually distinguishable");
  });

  it("starts at step 0 for a thread with no replies", () => {
    assert.equal(activityForReplies(0), STEP_0);
  });

  it("holds each step up to its boundary", () => {
    assert.equal(activityForReplies(6), STEP_0);
    assert.equal(activityForReplies(15), STEP_1);
    assert.equal(activityForReplies(25), STEP_2);
  });

  it("advances exactly at each threshold", () => {
    assert.equal(activityForReplies(7), STEP_1);
    assert.equal(activityForReplies(16), STEP_2);
    assert.equal(activityForReplies(26), STEP_3);
  });

  it("caps at the top step rather than running off the end", () => {
    assert.equal(activityForReplies(27), STEP_3);
    assert.equal(activityForReplies(10_000), STEP_3);
    assert.equal(activityForReplies(Number.MAX_SAFE_INTEGER), STEP_3);
  });

  it("never advances backwards as replies accumulate", () => {
    const order = [STEP_0, STEP_1, STEP_2, STEP_3];
    let previous = 0;
    for (let replies = 0; replies <= 40; replies++) {
      const index = order.indexOf(activityForReplies(replies));
      assert.ok(index >= previous, `step dropped at ${replies} replies`);
      previous = index;
    }
  });

  it("degrades to step 0 on nonsensical counts instead of throwing", () => {
    // replyCount is a non-negative counter in the schema, but a card should
    // still render if a counter-sync bug ever produces a negative.
    assert.equal(activityForReplies(-1), STEP_0);
    assert.equal(activityForReplies(-9999), STEP_0);
  });

  it("includes the border utility every step, not just the colour", () => {
    // `border-act-N-edge` sets a colour; without `border` the width stays 0
    // and the card silently loses its outline.
    for (const cls of [STEP_0, STEP_1, STEP_2, STEP_3]) {
      assert.match(cls, /(^|\s)border(\s|$)/, `missing border width in "${cls}"`);
      assert.match(cls, /\bbg-act-\d\b/, `missing surface fill in "${cls}"`);
      assert.match(cls, /\bborder-act-\d-edge\b/, `missing edge colour in "${cls}"`);
    }
  });
});
