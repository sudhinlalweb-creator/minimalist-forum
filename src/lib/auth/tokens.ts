import { createHash, randomBytes } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";

import type { AppDb } from "../db/types";
import { verificationTokens } from "../db/schema";

/**
 * Single-use, expiring tokens for email verification and password reset.
 *
 * Only the SHA-256 of the token is stored. The raw value exists solely in the
 * emailed link, so a database leak cannot be replayed into account takeover.
 * SHA-256 without a KDF is deliberate and safe here: unlike a password, the
 * token is 256 bits of CSPRNG output, so there is nothing to brute-force.
 *
 * Tokens are namespaced by purpose, so a verification link can never be
 * redeemed as a password reset.
 */

export type TokenPurpose = "email_verification" | "password_reset";

const TTL_MS: Record<TokenPurpose, number> = {
  // Long enough to survive a delayed inbox; short enough to matter.
  email_verification: 24 * 60 * 60 * 1000,
  // Reset links are far more dangerous, so they live briefly.
  password_reset: 60 * 60 * 1000,
};

export type TokenRejection = "not_found" | "expired";

export interface IssuedToken {
  /** Raw token — goes in the link, and is never persisted. */
  token: string;
  expiresAt: Date;
}

function identifierFor(purpose: TokenPurpose, subject: string): string {
  // Email is the subject; lowercase so lookups match regardless of casing.
  return `${purpose}:${subject.toLowerCase()}`;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a token, invalidating any outstanding token of the same purpose for
 * the same subject — requesting a new reset link must kill the previous one.
 */
export async function issueToken(
  db: AppDb,
  purpose: TokenPurpose,
  subject: string,
  now: Date = new Date(),
): Promise<IssuedToken> {
  const identifier = identifierFor(purpose, subject);

  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, identifier));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + TTL_MS[purpose]);

  await db.insert(verificationTokens).values({
    identifier,
    token: hash(token),
    expires: expiresAt,
  });

  return { token, expiresAt };
}

/**
 * Redeems a token. Deletes it first and reports success from the delete's own
 * result, so two concurrent requests cannot both consume the same token.
 */
export async function consumeToken(
  db: AppDb,
  purpose: TokenPurpose,
  subject: string,
  token: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: TokenRejection }> {
  const identifier = identifierFor(purpose, subject);

  const deleted = await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.token, hash(token)),
      ),
    )
    .returning({ expires: verificationTokens.expires });

  const row = deleted[0];
  if (!row) return { ok: false, reason: "not_found" };

  // Expiry is checked after deletion: an expired token is spent either way.
  if (row.expires.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true };
}

/** Housekeeping for expired rows; safe to run on a schedule. */
export async function purgeExpiredTokens(
  db: AppDb,
  now: Date = new Date(),
): Promise<number> {
  const deleted = await db
    .delete(verificationTokens)
    .where(lt(verificationTokens.expires, now))
    .returning({ token: verificationTokens.token });
  return deleted.length;
}
