import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { eq } from "drizzle-orm";

import { createDevDb } from "../db/dev";
import { users } from "../db/schema";
import type { AppDb } from "../db/types";
import {
  authenticate,
  changeEmail,
  changePassword,
  registerUser,
  updateProfile,
  verifyEmail,
} from "./accounts";
import { createMemoryMailer } from "./email";
import { validateSession } from "./session";

let db: AppDb;
let mailer: ReturnType<typeof createMemoryMailer>;

before(async () => {
  db = (await createDevDb()) as unknown as AppDb;
});
beforeEach(() => {
  mailer = createMemoryMailer();
});

const NOW = new Date("2026-07-18T12:00:00.000Z");
const PASSWORD = "the-original-password";
let n = 0;

async function makeUser() {
  const email = `settings${n}@example.com`;
  const username = `settings${n}`;
  n++;
  const r = await registerUser(db, { email, username, password: PASSWORD }, mailer, NOW);
  assert.equal(r.ok, true);
  const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(mailer.sent.at(-1)!.text)![1];
  await verifyEmail(db, email, token, NOW);
  mailer.sent.length = 0;
  return { email, username, id: (r as { userId: string }).userId };
}

describe("changePassword", () => {
  it("requires the current password", async () => {
    const u = await makeUser();
    const r = await changePassword(db, u.id, "not-the-password", "a-new-long-password");
    assert.equal(r.ok === false && r.reason, "wrong_password");

    // The old password must still work after a failed attempt.
    assert.equal((await authenticate(db, u.email, PASSWORD)).ok, true);
  });

  it("changes the password when the current one is right", async () => {
    const u = await makeUser();
    const r = await changePassword(db, u.id, PASSWORD, "a-brand-new-password");
    assert.equal(r.ok, true);

    assert.equal((await authenticate(db, u.email, PASSWORD)).ok, false);
    assert.equal((await authenticate(db, u.email, "a-brand-new-password")).ok, true);
  });

  it("rejects a too-short new password without touching the old one", async () => {
    const u = await makeUser();
    const r = await changePassword(db, u.id, PASSWORD, "short");
    assert.equal(r.ok === false && r.reason, "password_too_short");
    assert.equal((await authenticate(db, u.email, PASSWORD)).ok, true);
  });

  it("signs out sessions issued before the change", async () => {
    const u = await makeUser();
    const changedAt = new Date(NOW.getTime() + 60_000);
    await changePassword(db, u.id, PASSWORD, "yet-another-password", changedAt);

    const [row] = await db
      .select({
        id: users.id, role: users.role, isBanned: users.isBanned,
        isDeleted: users.isDeleted, emailVerified: users.emailVerified,
        sessionsValidAfter: users.sessionsValidAfter,
      })
      .from(users)
      .where(eq(users.id, u.id));

    const stale = validateSession(row, Math.floor(NOW.getTime() / 1000));
    assert.equal(stale.ok === false && stale.reason, "revoked");
  });
});

describe("changeEmail", () => {
  it("requires the password", async () => {
    const u = await makeUser();
    const r = await changeEmail(db, u.id, "wrong", "moved@example.com", mailer, NOW);
    assert.equal(r.ok === false && r.reason, "wrong_password");
    assert.equal(mailer.sent.length, 0);
  });

  it("moves the address and drops back to unverified", async () => {
    const u = await makeUser();
    const next = `moved${n++}@example.com`;
    const r = await changeEmail(db, u.id, PASSWORD, next, mailer, NOW);
    assert.equal(r.ok, true);

    // Unverified again, so posting is blocked until the new inbox is confirmed.
    const login = await authenticate(db, next, PASSWORD);
    assert.equal(login.ok === false && login.reason, "unverified");

    assert.equal(mailer.sent.length, 1);
    assert.match(mailer.sent[0].text, /\/verify-email\?/);
    assert.equal(mailer.sent[0].to, next);
  });

  it("verifying the new address restores sign-in", async () => {
    const u = await makeUser();
    const next = `moved${n++}@example.com`;
    await changeEmail(db, u.id, PASSWORD, next, mailer, NOW);
    const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(mailer.sent.at(-1)!.text)![1];

    assert.equal((await verifyEmail(db, next, token, NOW)).ok, true);
    assert.equal((await authenticate(db, next, PASSWORD)).ok, true);
  });

  it("refuses an address already in use", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const r = await changeEmail(db, a.id, PASSWORD, b.email, mailer, NOW);
    assert.equal(r.ok === false && r.reason, "email_taken");
  });

  it("rejects a malformed address", async () => {
    const u = await makeUser();
    const r = await changeEmail(db, u.id, PASSWORD, "nope", mailer, NOW);
    assert.equal(r.ok === false && r.reason, "email_invalid");
  });
});

describe("updateProfile", () => {
  it("saves display name and bio", async () => {
    const u = await makeUser();
    const r = await updateProfile(db, u.id, {
      displayName: "  Rosa Vidal  ",
      bio: "  Interested in interface density.  ",
    });
    assert.equal(r.ok, true);

    const [row] = await db
      .select({ name: users.name, bio: users.bio })
      .from(users)
      .where(eq(users.id, u.id));
    assert.equal(row.name, "Rosa Vidal", "should be trimmed");
    assert.equal(row.bio, "Interested in interface density.");
  });

  it("stores an empty bio as null rather than a blank string", async () => {
    const u = await makeUser();
    await updateProfile(db, u.id, { displayName: "Someone", bio: "   " });
    const [row] = await db.select({ bio: users.bio }).from(users).where(eq(users.id, u.id));
    assert.equal(row.bio, null);
  });

  it("rejects an empty display name and an over-long bio", async () => {
    const u = await makeUser();
    assert.equal(
      (await updateProfile(db, u.id, { displayName: "   ", bio: "" })).ok === false,
      true,
    );
    const tooLong = await updateProfile(db, u.id, {
      displayName: "Fine",
      bio: "x".repeat(501),
    });
    assert.equal(tooLong.ok === false && tooLong.reason, "bio_too_long");
  });
});
