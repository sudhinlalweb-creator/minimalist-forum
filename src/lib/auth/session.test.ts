import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { can } from "./permissions";
import { type SessionUserRecord, validateSession } from "./session";

const T0 = new Date("2026-07-18T12:00:00.000Z");
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

function user(overrides: Partial<SessionUserRecord> = {}): SessionUserRecord {
  return {
    id: "u1",
    role: "member",
    isBanned: false,
    isDeleted: false,
    emailVerified: new Date("2026-01-01"),
    sessionsValidAfter: T0,
    ...overrides,
  };
}

describe("validateSession", () => {
  it("accepts a token issued after the cutoff", () => {
    const r = validateSession(user(), seconds(plus(T0, 60_000)));
    assert.equal(r.ok, true);
  });

  it("rejects a token issued before the cutoff", () => {
    const r = validateSession(user(), seconds(plus(T0, -1000)));
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, "revoked");
  });

  it("keeps a token minted in the same second as the bump", () => {
    // Otherwise a password change would invalidate the very token it issues.
    const r = validateSession(user(), seconds(T0));
    assert.equal(r.ok, true);
  });

  it("accepts a Date as well as epoch seconds", () => {
    assert.equal(validateSession(user(), plus(T0, 5000)).ok, true);
    assert.equal(validateSession(user(), plus(T0, -5000)).ok, false);
  });
});

describe("validateSession rejections", () => {
  const later = seconds(plus(T0, 60_000));

  it("rejects a missing token", () => {
    assert.equal(validateSession(user(), null).ok, false);
    assert.equal(validateSession(user(), undefined).ok, false);
  });

  it("rejects an unresolvable user", () => {
    const r = validateSession(null, later);
    assert.equal(r.ok === false && r.reason, "user_not_found");
  });

  it("rejects a banned user even with a fresh token", () => {
    const r = validateSession(user({ isBanned: true }), later);
    assert.equal(r.ok === false && r.reason, "user_banned");
  });

  it("rejects a deleted user, and reports deletion over ban", () => {
    const r = validateSession(user({ isDeleted: true, isBanned: true }), later);
    assert.equal(r.ok === false && r.reason, "user_deleted");
  });

  it("rejects a non-finite iat rather than trusting it", () => {
    assert.equal(validateSession(user(), Number.NaN).ok, false);
    assert.equal(validateSession(user(), Number.POSITIVE_INFINITY).ok, false);
  });
});

describe("revocation scenarios", () => {
  it("password change invalidates every older token", () => {
    const issued = seconds(T0);
    const changedAt = plus(T0, 30_000);
    const after = validateSession(
      user({ sessionsValidAfter: changedAt }),
      issued,
    );
    assert.equal(after.ok === false && after.reason, "revoked");

    // The replacement token, minted after the change, is accepted.
    const fresh = validateSession(
      user({ sessionsValidAfter: changedAt }),
      seconds(plus(changedAt, 1000)),
    );
    assert.equal(fresh.ok, true);
  });

  it("hands back an actor the permission layer accepts", () => {
    const r = validateSession(user({ role: "moderator" }), seconds(plus(T0, 1000)));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(can(r.actor, "thread:lock"), true);
    assert.equal(can(r.actor, "role:assign"), false);
  });

  it("propagates unverified email into the actor, blocking posting", () => {
    const r = validateSession(
      user({ emailVerified: null }),
      seconds(plus(T0, 1000)),
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(can(r.actor, "post:create"), false);
    assert.equal(can(r.actor, "content:read"), true);
  });
});
