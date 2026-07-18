import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { createDevDb } from "../db/dev";
import type { AppDb } from "../db/types";
import {
  checkRateLimit,
  clearAttempts,
  purgeOldAttempts,
  recordAttempt,
} from "./rate-limit";

let db: AppDb;

before(async () => {
  db = (await createDevDb()) as unknown as AppDb;
});

const NOW = new Date("2026-07-18T12:00:00.000Z");
const plus = (ms: number) => new Date(NOW.getTime() + ms);
const MINUTE = 60 * 1000;

/** Unique identifier per test, so buckets never bleed between cases. */
let n = 0;
const freshUser = () => `user${n++}@example.com`;
const freshIp = () => `10.0.0.${n++}`;

describe("per-account login limit", () => {
  it("allows the first 5 attempts and blocks the 6th", async () => {
    const identifier = freshUser();

    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(db, "login", { identifier }, NOW);
      assert.equal(r.allowed, true, `attempt ${i + 1} should be allowed`);
      assert.equal(r.remaining, 5 - i);
      await recordAttempt(db, "login", { identifier }, NOW);
    }

    const blocked = await checkRateLimit(db, "login", { identifier }, NOW);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfter, "must say when to retry");
  });

  it("frees up once the window slides past", async () => {
    const identifier = freshUser();
    for (let i = 0; i < 5; i++) {
      await recordAttempt(db, "login", { identifier }, NOW);
    }
    assert.equal((await checkRateLimit(db, "login", { identifier }, NOW)).allowed, false);

    // 14 minutes later: still inside the 15-minute window.
    assert.equal(
      (await checkRateLimit(db, "login", { identifier }, plus(14 * MINUTE))).allowed,
      false,
    );
    // 16 minutes later: the attempts have aged out.
    assert.equal(
      (await checkRateLimit(db, "login", { identifier }, plus(16 * MINUTE))).allowed,
      true,
    );
  });

  it("does not let one account's attempts block another", async () => {
    const victim = freshUser();
    const bystander = freshUser();
    for (let i = 0; i < 5; i++) {
      await recordAttempt(db, "login", { identifier: victim }, NOW);
    }
    assert.equal((await checkRateLimit(db, "login", { identifier: victim }, NOW)).allowed, false);
    assert.equal((await checkRateLimit(db, "login", { identifier: bystander }, NOW)).allowed, true);
  });
});

describe("per-IP limit", () => {
  it("blocks one IP spraying many accounts", async () => {
    const ip = freshIp();
    // Under the account limit each time, but 20 attempts from one address.
    for (let i = 0; i < 20; i++) {
      const identifier = freshUser();
      const r = await checkRateLimit(db, "login", { identifier, ip }, NOW);
      assert.equal(r.allowed, true, `spray ${i + 1} should still be allowed`);
      await recordAttempt(db, "login", { identifier, ip }, NOW);
    }

    const blocked = await checkRateLimit(
      db, "login", { identifier: freshUser(), ip }, NOW,
    );
    assert.equal(blocked.allowed, false, "IP bucket must stop the spray");
  });

  it("does not block a different IP", async () => {
    const ip = freshIp();
    for (let i = 0; i < 20; i++) {
      await recordAttempt(db, "login", { identifier: freshUser(), ip }, NOW);
    }
    assert.equal((await checkRateLimit(db, "login", { ip }, NOW)).allowed, false);
    assert.equal((await checkRateLimit(db, "login", { ip: freshIp() }, NOW)).allowed, true);
  });
});

describe("policy differences", () => {
  it("limits registration harder than login", async () => {
    const identifier = freshUser();
    for (let i = 0; i < 3; i++) {
      assert.equal((await checkRateLimit(db, "register", { identifier }, NOW)).allowed, true);
      await recordAttempt(db, "register", { identifier }, NOW);
    }
    assert.equal((await checkRateLimit(db, "register", { identifier }, NOW)).allowed, false);
  });

  it("keeps actions in separate buckets", async () => {
    const identifier = freshUser();
    for (let i = 0; i < 5; i++) {
      await recordAttempt(db, "login", { identifier }, NOW);
    }
    assert.equal((await checkRateLimit(db, "login", { identifier }, NOW)).allowed, false);
    // Exhausting login must not lock the user out of a password reset.
    assert.equal(
      (await checkRateLimit(db, "password_reset_request", { identifier }, NOW)).allowed,
      true,
    );
  });

  it("uses the longer window for password resets", async () => {
    const identifier = freshUser();
    for (let i = 0; i < 3; i++) {
      await recordAttempt(db, "password_reset_request", { identifier }, NOW);
    }
    // Still blocked well past login's 15-minute window.
    assert.equal(
      (await checkRateLimit(db, "password_reset_request", { identifier }, plus(30 * MINUTE))).allowed,
      false,
    );
    assert.equal(
      (await checkRateLimit(db, "password_reset_request", { identifier }, plus(61 * MINUTE))).allowed,
      true,
    );
  });
});

describe("clearing and housekeeping", () => {
  it("clears a bucket after a successful login", async () => {
    const identifier = freshUser();
    for (let i = 0; i < 5; i++) {
      await recordAttempt(db, "login", { identifier }, NOW);
    }
    assert.equal((await checkRateLimit(db, "login", { identifier }, NOW)).allowed, false);

    await clearAttempts(db, "login", { identifier });
    assert.equal((await checkRateLimit(db, "login", { identifier }, NOW)).allowed, true);
  });

  it("purges rows older than a day", async () => {
    const identifier = freshUser();
    await recordAttempt(db, "login", { identifier }, NOW);
    const purged = await purgeOldAttempts(db, plus(25 * 60 * MINUTE));
    assert.ok(purged >= 1);
  });
});

describe("degenerate input", () => {
  it("allows when neither identifier nor IP is known", async () => {
    // Nothing to key on — fail open rather than block every anonymous caller.
    const r = await checkRateLimit(db, "login", {}, NOW);
    assert.equal(r.allowed, true);
  });

  it("ignores null and empty values", async () => {
    const r = await checkRateLimit(db, "login", { identifier: null, ip: "" }, NOW);
    assert.equal(r.allowed, true);
  });
});

describe("content flood limits", () => {
  const NOW = new Date("2026-07-19T12:00:00.000Z");

  /** Exhausts a bucket by recording `n` attempts for one actor. */
  async function burn(
    action: "create_thread" | "create_reply" | "cast_vote",
    identifier: string,
    n: number,
  ) {
    for (let i = 0; i < n; i++) {
      await recordAttempt(db, action, { identifier }, NOW);
    }
  }

  it("blocks thread creation past the per-account limit", async () => {
    const actor = "flood-threads";
    await burn("create_thread", actor, 10);

    const verdict = await checkRateLimit(
      db,
      "create_thread",
      { identifier: actor },
      NOW,
    );
    assert.equal(verdict.allowed, false);
    assert.ok(verdict.retryAfter);
  });

  it("lets a normal posting rate through untouched", async () => {
    const actor = "normal-poster";
    // Three threads in an hour is ordinary use, not flooding.
    await burn("create_thread", actor, 3);

    const verdict = await checkRateLimit(
      db,
      "create_thread",
      { identifier: actor },
      NOW,
    );
    assert.equal(verdict.allowed, true);
  });

  it("meters replies more generously than threads", async () => {
    const actor = "chatty";
    // 15 replies would have blocked a thread bucket; replies should allow it.
    await burn("create_reply", actor, 15);

    const verdict = await checkRateLimit(
      db,
      "create_reply",
      { identifier: actor },
      NOW,
    );
    assert.equal(verdict.allowed, true);
  });

  it("keeps buckets independent per action", async () => {
    const actor = "mixed";
    await burn("create_thread", actor, 10);

    // Exhausting threads must not stop the same user replying or voting.
    for (const action of ["create_reply", "cast_vote"] as const) {
      const verdict = await checkRateLimit(db, action, { identifier: actor }, NOW);
      assert.equal(verdict.allowed, true, `${action} should be unaffected`);
    }
  });

  it("frees the bucket once the window rolls past", async () => {
    const actor = "patient";
    await burn("create_thread", actor, 10);

    const later = new Date(NOW.getTime() + 61 * 60 * 1000);
    const verdict = await checkRateLimit(
      db,
      "create_thread",
      { identifier: actor },
      later,
    );
    assert.equal(verdict.allowed, true);
  });

  it("separates two accounts on the same action", async () => {
    await burn("cast_vote", "voter-a", 200);

    const blocked = await checkRateLimit(
      db,
      "cast_vote",
      { identifier: "voter-a" },
      NOW,
    );
    const other = await checkRateLimit(
      db,
      "cast_vote",
      { identifier: "voter-b" },
      NOW,
    );

    assert.equal(blocked.allowed, false);
    assert.equal(other.allowed, true);
  });
});
