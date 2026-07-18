import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { users } from "../db/schema";
import type { AppDb } from "../db/types";
import {
  type Mailer,
  getMailer,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email";
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password";
import { consumeToken, issueToken } from "./tokens";

/**
 * Registration, verification, login and password reset.
 *
 * Written against the structural `AppDb` type so every path here is exercised
 * against real Postgres in tests.
 *
 * Account enumeration is treated as a real concern throughout: registration and
 * password-reset requests return the same result whether or not the address is
 * already in use, and login gives one message for every failure mode.
 */

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;

/** Reserved because they collide with routes or impersonate the site. */
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "moderator", "mod", "staff", "support", "help",
  "root", "system", "meridian", "official", "api", "auth", "login", "logout",
  "register", "signup", "signin", "settings", "account", "profile", "user",
  "u", "c", "tag", "search", "about", "terms", "privacy", "sitemap", "robots",
  "new", "edit", "delete", "null", "undefined", "me",
]);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type ValidationIssue =
  | "email_invalid"
  | "username_invalid"
  | "username_reserved"
  | "username_taken"
  | "password_too_short";

/** Deliberately permissive: the verification email is the real check. */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function validateUsername(username: string): ValidationIssue | null {
  const value = username.trim().toLowerCase();
  // Reserved is checked first so short reserved names ("u", "c", "me") report
  // the accurate reason. The format check runs second and enforces 3-30 chars,
  // which would otherwise mask them as merely malformed.
  if (RESERVED_USERNAMES.has(value)) return "username_reserved";
  if (!USERNAME_RE.test(value)) return "username_invalid";
  return null;
}

export type RegisterResult =
  | { ok: true; userId: string | null; emailSent: true }
  | { ok: false; issue: ValidationIssue };

/**
 * Registers an account and sends a verification link.
 *
 * When the address already exists, this still reports success and still sends
 * mail — but a "someone tried to register with your address" notice rather than
 * a verification link. From the caller's side the two cases are identical, so
 * the endpoint cannot be used to discover who has an account.
 *
 * A taken *username* is reported plainly: usernames are public by design.
 */
export async function registerUser(
  db: AppDb,
  input: { email: string; username: string; password: string; displayName?: string },
  mailer: Mailer = getMailer(),
  now: Date = new Date(),
): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const username = input.username.trim().toLowerCase();

  if (!isPlausibleEmail(email)) return { ok: false, issue: "email_invalid" };

  const usernameIssue = validateUsername(username);
  if (usernameIssue) return { ok: false, issue: usernameIssue };

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, issue: "password_too_short" };
  }

  const existingByEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  if (existingByEmail.length > 0) {
    await mailer.send({
      to: email,
      subject: "Someone tried to register with your address",
      text: [
        "An account already exists for this email address.",
        "",
        "If this was you, sign in instead — or reset your password if you have",
        "forgotten it. If it wasn't you, no action is needed.",
      ].join("\n"),
    });
    return { ok: true, userId: null, emailSent: true };
  }

  const existingByUsername = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.username})`, username))
    .limit(1);

  if (existingByUsername.length > 0) return { ok: false, issue: "username_taken" };

  const passwordHash = await hashPassword(input.password);

  const [created] = await db
    .insert(users)
    .values({
      email,
      username,
      name: input.displayName?.trim() || username,
      passwordHash,
      emailVerified: null,
      createdAt: now,
      sessionsValidAfter: now,
    })
    .returning({ id: users.id });

  const { token } = await issueToken(db, "email_verification", email, now);
  await sendVerificationEmail(email, token, mailer);

  return { ok: true, userId: created.id, emailSent: true };
}

export type VerifyEmailResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid_token" | "expired_token" | "no_such_user" };

export async function verifyEmail(
  db: AppDb,
  rawEmail: string,
  token: string,
  now: Date = new Date(),
): Promise<VerifyEmailResult> {
  const email = normalizeEmail(rawEmail);

  const consumed = await consumeToken(db, "email_verification", email, token, now);
  if (!consumed.ok) {
    return {
      ok: false,
      reason: consumed.reason === "expired" ? "expired_token" : "invalid_token",
    };
  }

  const [updated] = await db
    .update(users)
    .set({ emailVerified: now })
    .where(eq(sql`lower(${users.email})`, email))
    .returning({ id: users.id });

  if (!updated) return { ok: false, reason: "no_such_user" };
  return { ok: true, userId: updated.id };
}

/**
 * Always reports success, and only sends mail when the account exists — so the
 * response cannot be used to test whether an address is registered.
 */
export async function requestPasswordReset(
  db: AppDb,
  rawEmail: string,
  mailer: Mailer = getMailer(),
  now: Date = new Date(),
): Promise<{ ok: true }> {
  const email = normalizeEmail(rawEmail);
  if (!isPlausibleEmail(email)) return { ok: true };

  const [user] = await db
    .select({ id: users.id, isDeleted: users.isDeleted })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  if (user && !user.isDeleted) {
    const { token } = await issueToken(db, "password_reset", email, now);
    await sendPasswordResetEmail(email, token, mailer);
  }

  return { ok: true };
}

export type ResetPasswordResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason: "invalid_token" | "expired_token" | "no_such_user" | "password_too_short";
    };

/**
 * Consumes the reset token and bumps `sessionsValidAfter`, which kills every
 * session issued before the change — the point of the reset when an account is
 * suspected compromised.
 */
export async function resetPassword(
  db: AppDb,
  rawEmail: string,
  token: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<ResetPasswordResult> {
  const email = normalizeEmail(rawEmail);

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "password_too_short" };
  }

  const consumed = await consumeToken(db, "password_reset", email, token, now);
  if (!consumed.ok) {
    return {
      ok: false,
      reason: consumed.reason === "expired" ? "expired_token" : "invalid_token",
    };
  }

  const passwordHash = await hashPassword(newPassword);

  const [updated] = await db
    .update(users)
    .set({
      passwordHash,
      sessionsValidAfter: now,
      // Completing a reset proves control of the inbox.
      emailVerified: sql`coalesce(${users.emailVerified}, ${now})`,
    })
    .where(eq(sql`lower(${users.email})`, email))
    .returning({ id: users.id });

  if (!updated) return { ok: false, reason: "no_such_user" };
  return { ok: true, userId: updated.id };
}

export type LoginResult =
  | { ok: true; userId: string; needsRehash: boolean }
  | { ok: false; reason: "invalid_credentials" | "banned" | "unverified" };

/**
 * Verifies credentials. Every wrong-email and wrong-password path returns
 * `invalid_credentials`, and a dummy hash is verified when no user is found so
 * the response time does not reveal whether the address exists.
 */
export async function authenticate(
  db: AppDb,
  rawEmail: string,
  password: string,
): Promise<LoginResult> {
  const email = normalizeEmail(rawEmail);

  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      isBanned: users.isBanned,
      isDeleted: users.isDeleted,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email))
    .limit(1);

  if (!user || user.isDeleted || !user.passwordHash) {
    // Burn comparable time so a missing account is not detectably faster.
    await verifyPassword(password, await getDummyHash());
    return { ok: false, reason: "invalid_credentials" };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false, reason: "invalid_credentials" };

  // Checked only after the password is proven, so neither state leaks to an
  // attacker who does not already know the password.
  if (user.isBanned) return { ok: false, reason: "banned" };
  if (!user.emailVerified) return { ok: false, reason: "unverified" };

  return {
    ok: true,
    userId: user.id,
    // True when the stored hash predates the current cost parameters. The
    // caller re-hashes on successful login, since that is the only moment the
    // plaintext is available.
    needsRehash: needsRehash(user.passwordHash),
  };
}

/**
 * Upgrades a stored hash to the current cost parameters. Call after a
 * successful login when `needsRehash` is set; failure is non-fatal, since the
 * user is already authenticated and the old hash still works.
 */
export async function upgradePasswordHash(
  db: AppDb,
  userId: string,
  password: string,
): Promise<void> {
  try {
    const passwordHash = await hashPassword(password);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
  } catch {
    // Deliberately swallowed: a failed upgrade must not fail the login.
  }
}

/**
 * A real scrypt hash of a random value, used only to equalise timing on the
 * no-such-user path.
 *
 * Generated at runtime rather than hardcoded: a handwritten literal that failed
 * to parse would make `verifyPassword` bail out before running scrypt at all,
 * silently reinstating the timing difference this exists to remove.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummyHashPromise;
}

/* -------------------------------------------------------------------------- */
/*  Account settings                                                           */
/* -------------------------------------------------------------------------- */

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "wrong_password" | "password_too_short" | "no_such_user" };

/**
 * Changing a password requires the current one — otherwise a borrowed session
 * (shared laptop, stolen cookie) is enough to take the account permanently.
 *
 * Bumps `sessionsValidAfter`, so every other session is signed out. The caller
 * must re-issue the current session's token or the user logs themselves out.
 */
export async function changePassword(
  db: AppDb,
  userId: string,
  currentPassword: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<ChangePasswordResult> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "password_too_short" };
  }

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return { ok: false, reason: "no_such_user" };

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) return { ok: false, reason: "wrong_password" };

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      sessionsValidAfter: now,
    })
    .where(eq(users.id, userId));

  return { ok: true };
}

export type ChangeEmailResult =
  | { ok: true }
  | {
      ok: false;
      reason: "wrong_password" | "email_invalid" | "email_taken" | "no_such_user";
    };

/**
 * Changing an email address also requires the password, and drops the account
 * back to unverified until the new address is confirmed — so a typo cannot
 * silently move the account to an inbox the user does not control.
 */
export async function changeEmail(
  db: AppDb,
  userId: string,
  password: string,
  rawNewEmail: string,
  mailer: Mailer = getMailer(),
  now: Date = new Date(),
): Promise<ChangeEmailResult> {
  const newEmail = normalizeEmail(rawNewEmail);
  if (!isPlausibleEmail(newEmail)) return { ok: false, reason: "email_invalid" };

  const [user] = await db
    .select({ passwordHash: users.passwordHash, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return { ok: false, reason: "no_such_user" };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false, reason: "wrong_password" };

  if (normalizeEmail(user.email) !== newEmail) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, newEmail))
      .limit(1);
    // Unlike registration, this is behind a password check, so reporting the
    // clash leaks nothing an attacker could not already determine.
    if (existing.length > 0) return { ok: false, reason: "email_taken" };
  }

  await db
    .update(users)
    .set({ email: newEmail, emailVerified: null })
    .where(eq(users.id, userId));

  const { token } = await issueToken(db, "email_verification", newEmail, now);
  await sendVerificationEmail(newEmail, token, mailer);

  return { ok: true };
}

const MAX_BIO_LENGTH = 500;

export type UpdateProfileResult =
  | { ok: true }
  | { ok: false; reason: "display_name_empty" | "bio_too_long" };

export async function updateProfile(
  db: AppDb,
  userId: string,
  input: { displayName: string; bio: string },
): Promise<UpdateProfileResult> {
  const displayName = input.displayName.trim();
  const bio = input.bio.trim();

  if (displayName.length === 0) return { ok: false, reason: "display_name_empty" };
  if (bio.length > MAX_BIO_LENGTH) return { ok: false, reason: "bio_too_long" };

  await db
    .update(users)
    .set({ name: displayName, bio: bio || null })
    .where(eq(users.id, userId));

  return { ok: true };
}

export { MAX_BIO_LENGTH };
