import type { Actor, Role } from "./permissions";

/**
 * Session validation.
 *
 * Auth.js forces the JWT strategy when the Credentials provider is enabled, so
 * we cannot revoke by deleting a session row. Instead every request re-reads
 * the user and runs the token through here, which restores the instant
 * revocation the brief wanted from database sessions:
 *
 *   ban / delete      → rejected on the next request
 *   password change   → bump sessionsValidAfter, every older token dies
 *   forced logout     → same bump, applied by an admin
 *
 * This is a pure function so the rules are testable without Auth.js, a
 * database, or a request context.
 */

export type SessionRejection =
  | "no_token"
  | "user_not_found"
  | "user_deleted"
  | "user_banned"
  | "revoked";

/** The columns session validation depends on. */
export interface SessionUserRecord {
  id: string;
  role: Role;
  isBanned: boolean;
  isDeleted: boolean;
  emailVerified: Date | null;
  sessionsValidAfter: Date;
}

export type SessionResult =
  | { ok: true; actor: Actor }
  | { ok: false; reason: SessionRejection };

/**
 * @param user           Freshly read from the database, or null if the id in
 *                       the token no longer resolves.
 * @param tokenIssuedAt  The JWT `iat`. Seconds-since-epoch (as JWTs encode it)
 *                       or a Date; both are accepted.
 */
export function validateSession(
  user: SessionUserRecord | null | undefined,
  tokenIssuedAt: number | Date | null | undefined,
): SessionResult {
  if (tokenIssuedAt === null || tokenIssuedAt === undefined) {
    return { ok: false, reason: "no_token" };
  }
  if (!user) return { ok: false, reason: "user_not_found" };

  // Deleted before banned: a deleted account is the more fundamental state,
  // and the distinction matters for the message shown to the user.
  if (user.isDeleted) return { ok: false, reason: "user_deleted" };
  if (user.isBanned) return { ok: false, reason: "user_banned" };

  const issuedAtSeconds =
    tokenIssuedAt instanceof Date
      ? Math.floor(tokenIssuedAt.getTime() / 1000)
      : Math.floor(tokenIssuedAt);

  if (!Number.isFinite(issuedAtSeconds)) {
    return { ok: false, reason: "no_token" };
  }

  const validAfterSeconds = Math.floor(user.sessionsValidAfter.getTime() / 1000);

  // Compared at second granularity because that is all a JWT `iat` carries.
  // A token minted in the same second as the bump is kept, so the fresh token
  // issued by a password change is not immediately invalidated by its own bump.
  if (issuedAtSeconds < validAfterSeconds) {
    return { ok: false, reason: "revoked" };
  }

  return {
    ok: true,
    actor: {
      id: user.id,
      role: user.role,
      isBanned: user.isBanned,
      emailVerified: user.emailVerified,
    },
  };
}

/** User-facing copy for a rejected session. */
export function rejectionMessage(reason: SessionRejection): string {
  switch (reason) {
    case "user_banned":
      return "This account has been suspended.";
    case "user_deleted":
      return "This account no longer exists.";
    case "revoked":
      return "Your session expired. Please sign in again.";
    case "user_not_found":
    case "no_token":
      return "Please sign in.";
  }
}
