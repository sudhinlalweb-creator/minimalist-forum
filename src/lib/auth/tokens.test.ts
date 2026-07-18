import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { createDevDb } from "../db/dev";
import type { AppDb } from "../db/types";
import { consumeToken, issueToken, purgeExpiredTokens } from "./tokens";

/**
 * Exercised against a real in-process Postgres (PGlite), not a mock — the
 * single-use guarantee depends on DELETE … RETURNING actually being atomic.
 */
let db: AppDb;

before(async () => {
  db = (await createDevDb()) as unknown as AppDb;
});

const NOW = new Date("2026-07-18T12:00:00.000Z");
const plus = (ms: number) => new Date(NOW.getTime() + ms);

describe("issueToken / consumeToken", () => {
  it("round-trips a freshly issued token", async () => {
    const { token } = await issueToken(db, "email_verification", "a@example.com", NOW);
    const r = await consumeToken(db, "email_verification", "a@example.com", token, NOW);
    assert.equal(r.ok, true);
  });

  it("is single-use", async () => {
    const { token } = await issueToken(db, "email_verification", "b@example.com", NOW);
    assert.equal(
      (await consumeToken(db, "email_verification", "b@example.com", token, NOW)).ok,
      true,
    );
    const second = await consumeToken(
      db, "email_verification", "b@example.com", token, NOW,
    );
    assert.equal(second.ok, false);
    assert.equal(second.ok === false && second.reason, "not_found");
  });

  it("rejects a token that was never issued", async () => {
    const r = await consumeToken(
      db, "email_verification", "c@example.com", "made-up-token", NOW,
    );
    assert.equal(r.ok === false && r.reason, "not_found");
  });

  it("rejects the right token presented for the wrong subject", async () => {
    const { token } = await issueToken(db, "email_verification", "d@example.com", NOW);
    const r = await consumeToken(
      db, "email_verification", "someone-else@example.com", token, NOW,
    );
    assert.equal(r.ok === false && r.reason, "not_found");
  });

  it("will not redeem a verification token as a password reset", async () => {
    const { token } = await issueToken(db, "email_verification", "e@example.com", NOW);
    const crossed = await consumeToken(
      db, "password_reset", "e@example.com", token, NOW,
    );
    assert.equal(crossed.ok === false && crossed.reason, "not_found");

    // …and the token is still valid for its actual purpose.
    assert.equal(
      (await consumeToken(db, "email_verification", "e@example.com", token, NOW)).ok,
      true,
    );
  });

  it("treats the subject case-insensitively", async () => {
    const { token } = await issueToken(db, "password_reset", "Mixed@Example.COM", NOW);
    const r = await consumeToken(db, "password_reset", "mixed@example.com", token, NOW);
    assert.equal(r.ok, true);
  });
});

describe("expiry", () => {
  it("rejects a verification token after 24h", async () => {
    const { token, expiresAt } = await issueToken(
      db, "email_verification", "f@example.com", NOW,
    );
    assert.equal(expiresAt.getTime(), plus(24 * 60 * 60 * 1000).getTime());

    const r = await consumeToken(
      db, "email_verification", "f@example.com", token,
      plus(24 * 60 * 60 * 1000 + 1),
    );
    assert.equal(r.ok === false && r.reason, "expired");
  });

  it("expires a reset token in an hour, far sooner than a verification one", async () => {
    const { expiresAt } = await issueToken(
      db, "password_reset", "g@example.com", NOW,
    );
    assert.equal(expiresAt.getTime(), plus(60 * 60 * 1000).getTime());
  });

  it("spends an expired token rather than leaving it redeemable", async () => {
    const { token } = await issueToken(db, "password_reset", "h@example.com", NOW);
    await consumeToken(db, "password_reset", "h@example.com", token, plus(2 * 60 * 60 * 1000));
    // Even at a valid time, the row is gone.
    const again = await consumeToken(db, "password_reset", "h@example.com", token, NOW);
    assert.equal(again.ok === false && again.reason, "not_found");
  });
});

describe("reissuing", () => {
  it("invalidates the previous token for the same purpose and subject", async () => {
    const first = await issueToken(db, "password_reset", "i@example.com", NOW);
    const second = await issueToken(db, "password_reset", "i@example.com", NOW);
    assert.notEqual(first.token, second.token);

    assert.equal(
      (await consumeToken(db, "password_reset", "i@example.com", first.token, NOW)).ok,
      false,
      "the superseded link must stop working",
    );
    assert.equal(
      (await consumeToken(db, "password_reset", "i@example.com", second.token, NOW)).ok,
      true,
    );
  });

  it("does not disturb a token of a different purpose", async () => {
    const verify = await issueToken(db, "email_verification", "j@example.com", NOW);
    await issueToken(db, "password_reset", "j@example.com", NOW);
    assert.equal(
      (await consumeToken(db, "email_verification", "j@example.com", verify.token, NOW)).ok,
      true,
    );
  });
});

describe("purgeExpiredTokens", () => {
  it("removes only expired rows", async () => {
    await issueToken(db, "password_reset", "k@example.com", NOW);
    await issueToken(db, "email_verification", "l@example.com", NOW);

    // 2h later: the reset token has expired, the verification token has not.
    const purged = await purgeExpiredTokens(db, plus(2 * 60 * 60 * 1000));
    assert.ok(purged >= 1, "expected at least the expired reset token");

    const live = await consumeToken(
      db, "email_verification", "l@example.com",
      (await issueToken(db, "email_verification", "l@example.com", NOW)).token,
      NOW,
    );
    assert.equal(live.ok, true);
  });
});

describe("token shape", () => {
  it("issues URL-safe, high-entropy tokens", async () => {
    const { token } = await issueToken(db, "email_verification", "m@example.com", NOW);
    assert.match(token, /^[A-Za-z0-9_-]+$/, "must be URL-safe unescaped");
    // 32 random bytes in base64url.
    assert.equal(token.length, 43);
  });

  it("never issues the same token twice", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const { token } = await issueToken(db, "email_verification", `n${i}@example.com`, NOW);
      assert.equal(seen.has(token), false);
      seen.add(token);
    }
  });
});
