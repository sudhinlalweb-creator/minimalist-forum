import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { createDevDb } from "../db/dev";
import { users } from "../db/schema";
import type { AppDb } from "../db/types";
import {
  authenticate,
  registerUser,
  requestPasswordReset,
  resetPassword,
  validateUsername,
  verifyEmail,
} from "./accounts";
import { createMemoryMailer } from "./email";
import { validateSession } from "./session";
import { issueToken } from "./tokens";

let db: AppDb;
let mailer: ReturnType<typeof createMemoryMailer>;

before(async () => {
  db = (await createDevDb()) as unknown as AppDb;
});

beforeEach(() => {
  mailer = createMemoryMailer();
});

const NOW = new Date("2026-07-18T12:00:00.000Z");
const plus = (ms: number) => new Date(NOW.getTime() + ms);
const PASSWORD = "a-sufficiently-long-password";

let n = 0;
const freshEmail = () => `person${n++}@example.com`;
const freshUsername = () => `person${n++}`;

/** Pulls the verification link's token out of the last email sent. */
function tokenFromLastEmail(): string {
  const last = mailer.sent.at(-1);
  assert.ok(last, "expected an email to have been sent");
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(last.text);
  assert.ok(match, `no token in email:\n${last.text}`);
  return match[1];
}

async function registerAndVerify(email: string, username: string) {
  const r = await registerUser(db, { email, username, password: PASSWORD }, mailer, NOW);
  assert.equal(r.ok, true);
  const verified = await verifyEmail(db, email, tokenFromLastEmail(), NOW);
  assert.equal(verified.ok, true);
  return r;
}

describe("registerUser", () => {
  it("creates an unverified account and emails a link", async () => {
    const email = freshEmail();
    const r = await registerUser(
      db, { email, username: freshUsername(), password: PASSWORD }, mailer, NOW,
    );
    assert.equal(r.ok, true);
    assert.equal(mailer.sent.length, 1);
    assert.match(mailer.sent[0].text, /\/verify-email\?/);

    const [row] = await db
      .select({ emailVerified: users.emailVerified, hash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email));
    assert.equal(row.emailVerified, null, "must start unverified");
    assert.ok(row.hash?.startsWith("scrypt$"), "password must be hashed");
    assert.equal(row.hash?.includes(PASSWORD), false, "plaintext must not appear");
  });

  it("rejects a short password, bad email, and malformed username", async () => {
    const bad = [
      { email: freshEmail(), username: freshUsername(), password: "short", issue: "password_too_short" },
      { email: "not-an-email", username: freshUsername(), password: PASSWORD, issue: "email_invalid" },
      { email: freshEmail(), username: "a", password: PASSWORD, issue: "username_invalid" },
      { email: freshEmail(), username: "has spaces", password: PASSWORD, issue: "username_invalid" },
    ];
    for (const b of bad) {
      const r = await registerUser(db, b, mailer, NOW);
      assert.equal(r.ok, false, `expected failure for ${b.username}`);
      assert.equal(r.ok === false && r.issue, b.issue);
    }
    assert.equal(mailer.sent.length, 0, "no mail on validation failure");
  });

  it("refuses reserved usernames that would collide with routes", () => {
    for (const name of ["admin", "settings", "api", "u", "c", "tag"]) {
      assert.equal(validateUsername(name), "username_reserved", name);
    }
  });

  it("reports a taken username plainly, since usernames are public", async () => {
    const username = freshUsername();
    await registerUser(db, { email: freshEmail(), username, password: PASSWORD }, mailer, NOW);
    const second = await registerUser(
      db, { email: freshEmail(), username, password: PASSWORD }, mailer, NOW,
    );
    assert.equal(second.ok === false && second.issue, "username_taken");
  });
});

describe("registration does not leak which emails exist", () => {
  it("reports success for a duplicate address, without creating a second account", async () => {
    const email = freshEmail();
    const first = await registerUser(
      db, { email, username: freshUsername(), password: PASSWORD }, mailer, NOW,
    );
    assert.equal(first.ok, true);

    const second = await registerUser(
      db, { email, username: freshUsername(), password: PASSWORD }, mailer, NOW,
    );
    // Same shape of success as a genuine signup.
    assert.equal(second.ok, true);
    assert.equal(second.ok === true && second.userId, null);

    const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    assert.equal(rows.length, 1, "must not create a duplicate account");
  });

  it("sends a notice rather than a verification link to the existing owner", async () => {
    const email = freshEmail();
    await registerUser(db, { email, username: freshUsername(), password: PASSWORD }, mailer, NOW);
    mailer.sent.length = 0;

    await registerUser(db, { email, username: freshUsername(), password: PASSWORD }, mailer, NOW);
    assert.equal(mailer.sent.length, 1, "the real owner is still told");
    assert.equal(
      /\/verify-email\?/.test(mailer.sent[0].text),
      false,
      "must not hand an attacker a working verification link",
    );
  });
});

describe("verifyEmail", () => {
  it("marks the account verified", async () => {
    const email = freshEmail();
    await registerUser(db, { email, username: freshUsername(), password: PASSWORD }, mailer, NOW);
    const r = await verifyEmail(db, email, tokenFromLastEmail(), NOW);
    assert.equal(r.ok, true);

    const [row] = await db
      .select({ emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, email));
    assert.notEqual(row.emailVerified, null);
  });

  it("rejects a wrong or reused token", async () => {
    const email = freshEmail();
    await registerUser(db, { email, username: freshUsername(), password: PASSWORD }, mailer, NOW);
    const token = tokenFromLastEmail();

    assert.equal(
      (await verifyEmail(db, email, "wrong-token", NOW)).ok, false,
    );
    assert.equal((await verifyEmail(db, email, token, NOW)).ok, true);
    const reused = await verifyEmail(db, email, token, NOW);
    assert.equal(reused.ok === false && reused.reason, "invalid_token");
  });

  it("rejects an expired token", async () => {
    const email = freshEmail();
    await registerUser(db, { email, username: freshUsername(), password: PASSWORD }, mailer, NOW);
    const r = await verifyEmail(
      db, email, tokenFromLastEmail(), plus(25 * 60 * 60 * 1000),
    );
    assert.equal(r.ok === false && r.reason, "expired_token");
  });
});

describe("authenticate", () => {
  it("refuses to sign in before the address is verified", async () => {
    const email = freshEmail();
    await registerUser(db, { email, username: freshUsername(), password: PASSWORD }, mailer, NOW);
    const r = await authenticate(db, email, PASSWORD);
    assert.equal(r.ok === false && r.reason, "unverified");
  });

  it("signs in once verified", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());
    assert.equal((await authenticate(db, email, PASSWORD)).ok, true);
  });

  it("is case-insensitive on the email", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());
    assert.equal((await authenticate(db, email.toUpperCase(), PASSWORD)).ok, true);
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());

    const wrongPassword = await authenticate(db, email, "not-the-password");
    const unknownAccount = await authenticate(db, "nobody-here@example.com", PASSWORD);

    assert.equal(wrongPassword.ok === false && wrongPassword.reason, "invalid_credentials");
    assert.equal(unknownAccount.ok === false && unknownAccount.reason, "invalid_credentials");
  });

  it("rejects a banned account, but only after the password checks out", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());
    await db.update(users).set({ isBanned: true }).where(eq(users.email, email));

    assert.equal((await authenticate(db, email, PASSWORD)).ok === false, true);
    const banned = await authenticate(db, email, PASSWORD);
    assert.equal(banned.ok === false && banned.reason, "banned");

    // A wrong password on a banned account must not reveal the ban.
    const wrong = await authenticate(db, email, "not-the-password");
    assert.equal(wrong.ok === false && wrong.reason, "invalid_credentials");
  });

  it("rejects a soft-deleted account as merely invalid", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());
    await db.update(users).set({ isDeleted: true }).where(eq(users.email, email));

    const r = await authenticate(db, email, PASSWORD);
    assert.equal(r.ok === false && r.reason, "invalid_credentials");
  });
});

describe("password reset", () => {
  it("reports success for an unknown address, and sends nothing", async () => {
    const r = await requestPasswordReset(db, "no-such-person@example.com", mailer, NOW);
    assert.equal(r.ok, true);
    assert.equal(mailer.sent.length, 0);
  });

  it("emails a link for a real account", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());
    mailer.sent.length = 0;

    await requestPasswordReset(db, email, mailer, NOW);
    assert.equal(mailer.sent.length, 1);
    assert.match(mailer.sent[0].text, /\/reset-password\?/);
  });

  it("changes the password and invalidates the old one", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());
    mailer.sent.length = 0;
    await requestPasswordReset(db, email, mailer, NOW);

    const newPassword = "an-entirely-different-password";
    const r = await resetPassword(db, email, tokenFromLastEmail(), newPassword, NOW);
    assert.equal(r.ok, true);

    assert.equal((await authenticate(db, email, PASSWORD)).ok, false, "old password must die");
    assert.equal((await authenticate(db, email, newPassword)).ok, true);
  });

  it("revokes sessions issued before the reset", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());
    mailer.sent.length = 0;
    await requestPasswordReset(db, email, mailer, NOW);

    const resetAt = plus(10 * 60 * 1000);
    await resetPassword(db, email, tokenFromLastEmail(), "another-long-password", resetAt);

    const [row] = await db
      .select({
        id: users.id, role: users.role, isBanned: users.isBanned,
        isDeleted: users.isDeleted, emailVerified: users.emailVerified,
        sessionsValidAfter: users.sessionsValidAfter,
      })
      .from(users)
      .where(eq(users.email, email));

    // A session minted before the reset is now dead…
    const stale = validateSession(row, Math.floor(NOW.getTime() / 1000));
    assert.equal(stale.ok === false && stale.reason, "revoked");

    // …while one minted after it is fine.
    const fresh = validateSession(row, Math.floor(plus(11 * 60 * 1000).getTime() / 1000));
    assert.equal(fresh.ok, true);
  });

  it("rejects a reset token minted for verification", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());
    const { token } = await issueToken(db, "email_verification", email, NOW);

    const r = await resetPassword(db, email, token, "yet-another-password", NOW);
    assert.equal(r.ok === false && r.reason, "invalid_token");
  });

  it("rejects a short new password before spending the token", async () => {
    const email = freshEmail();
    await registerAndVerify(email, freshUsername());
    mailer.sent.length = 0;
    await requestPasswordReset(db, email, mailer, NOW);
    const token = tokenFromLastEmail();

    const short = await resetPassword(db, email, token, "tiny", NOW);
    assert.equal(short.ok === false && short.reason, "password_too_short");

    // The token must survive a rejected attempt.
    const retry = await resetPassword(db, email, token, "a-proper-long-password", NOW);
    assert.equal(retry.ok, true, "token must not be burned by a validation failure");
  });

  it("verifies the address as a side effect, since the inbox was proven", async () => {
    const email = freshEmail();
    const username = freshUsername();
    await registerUser(db, { email, username, password: PASSWORD }, mailer, NOW);
    mailer.sent.length = 0;

    await requestPasswordReset(db, email, mailer, NOW);
    await resetPassword(db, email, tokenFromLastEmail(), "brand-new-password-x", NOW);

    const r = await authenticate(db, email, "brand-new-password-x");
    assert.equal(r.ok, true, "reset should imply verification");
  });
});
