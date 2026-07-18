import { and, count, eq, gte, lt } from "drizzle-orm";

import { authAttempts } from "../db/schema";
import type { AppDb } from "../db/types";

/**
 * Sliding-window rate limiting for auth endpoints (brute-force protection).
 *
 * Each protected action is limited on two independent buckets — the account
 * being targeted and the caller's IP — because either alone is trivially
 * bypassed: per-account only lets one IP spray many accounts, per-IP only lets
 * a botnet hammer one account.
 */

export type RateLimitedAction =
  // Auth: brute-force protection.
  | "login"
  | "register"
  | "password_reset_request"
  | "email_verification_resend"
  // Content: flood protection. A verified account posting faster than a human
  // can type is either scripted or broken, and both are worth stopping.
  | "create_thread"
  | "create_reply"
  | "cast_vote";

interface Policy {
  limit: number;
  windowMs: number;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Per-account/identifier limits — tight, since they gate a single target. */
const ACCOUNT_POLICY: Record<RateLimitedAction, Policy> = {
  login: { limit: 5, windowMs: 15 * MINUTE },
  register: { limit: 3, windowMs: HOUR },
  password_reset_request: { limit: 3, windowMs: HOUR },
  email_verification_resend: { limit: 3, windowMs: HOUR },
  // Content limits sit well above real use and only bite scripted flooding —
  // a rate limit a genuine user can hit is a bug report waiting to happen.
  create_thread: { limit: 10, windowMs: HOUR },
  create_reply: { limit: 40, windowMs: HOUR },
  // Votes are single clicks, and the unique index on (user, target) already
  // stops repeat voting from moving a score. This is load protection, so it
  // can afford to be loose.
  cast_vote: { limit: 200, windowMs: HOUR },
};

/** Per-IP limits — looser, since NAT means many users share an address. */
const IP_POLICY: Record<RateLimitedAction, Policy> = {
  login: { limit: 20, windowMs: 15 * MINUTE },
  register: { limit: 5, windowMs: HOUR },
  password_reset_request: { limit: 10, windowMs: HOUR },
  email_verification_resend: { limit: 10, windowMs: HOUR },
  // Deliberately several times the per-account limit: an office or campus
  // behind one NAT address is a normal thing, not an attack.
  create_thread: { limit: 30, windowMs: HOUR },
  create_reply: { limit: 120, windowMs: HOUR },
  cast_vote: { limit: 600, windowMs: HOUR },
};

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts left in the current window; 0 once blocked. */
  remaining: number;
  /** When the caller may retry. Null while still allowed. */
  retryAfter: Date | null;
}

const ALLOWED: RateLimitResult = {
  allowed: true,
  remaining: Number.POSITIVE_INFINITY,
  retryAfter: null,
};

function bucketKey(
  action: RateLimitedAction,
  scope: "user" | "ip",
  value: string,
): string {
  return `${action}:${scope}:${value.toLowerCase()}`;
}

async function checkBucket(
  db: AppDb,
  key: string,
  policy: Policy,
  now: Date,
): Promise<RateLimitResult> {
  const windowStart = new Date(now.getTime() - policy.windowMs);

  const [row] = await db
    .select({ n: count() })
    .from(authAttempts)
    .where(
      and(eq(authAttempts.key, key), gte(authAttempts.createdAt, windowStart)),
    );

  const used = row?.n ?? 0;
  if (used < policy.limit) {
    return { allowed: true, remaining: policy.limit - used, retryAfter: null };
  }

  // Blocked until the oldest attempt in the window ages out.
  const [oldest] = await db
    .select({ createdAt: authAttempts.createdAt })
    .from(authAttempts)
    .where(
      and(eq(authAttempts.key, key), gte(authAttempts.createdAt, windowStart)),
    )
    .orderBy(authAttempts.createdAt)
    .limit(1);

  const retryAfter = oldest
    ? new Date(oldest.createdAt.getTime() + policy.windowMs)
    : new Date(now.getTime() + policy.windowMs);

  return { allowed: false, remaining: 0, retryAfter };
}

/**
 * Reports whether the action may proceed. Does NOT record an attempt — call
 * `recordAttempt` for that, so a successful login can avoid burning quota.
 */
export async function checkRateLimit(
  db: AppDb,
  action: RateLimitedAction,
  opts: { identifier?: string | null; ip?: string | null },
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const checks: Promise<RateLimitResult>[] = [];

  if (opts.identifier) {
    checks.push(
      checkBucket(
        db,
        bucketKey(action, "user", opts.identifier),
        ACCOUNT_POLICY[action],
        now,
      ),
    );
  }
  if (opts.ip) {
    checks.push(
      checkBucket(db, bucketKey(action, "ip", opts.ip), IP_POLICY[action], now),
    );
  }

  if (checks.length === 0) return ALLOWED;

  const results = await Promise.all(checks);

  // Most restrictive bucket wins.
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length > 0) {
    const soonest = blocked.reduce((a, b) =>
      (a.retryAfter?.getTime() ?? 0) <= (b.retryAfter?.getTime() ?? 0) ? a : b,
    );
    return { allowed: false, remaining: 0, retryAfter: soonest.retryAfter };
  }

  return {
    allowed: true,
    remaining: Math.min(...results.map((r) => r.remaining)),
    retryAfter: null,
  };
}

/** Records a failed//countable attempt against every applicable bucket. */
export async function recordAttempt(
  db: AppDb,
  action: RateLimitedAction,
  opts: { identifier?: string | null; ip?: string | null },
  now: Date = new Date(),
): Promise<void> {
  const rows: { key: string; createdAt: Date }[] = [];
  if (opts.identifier) {
    rows.push({ key: bucketKey(action, "user", opts.identifier), createdAt: now });
  }
  if (opts.ip) {
    rows.push({ key: bucketKey(action, "ip", opts.ip), createdAt: now });
  }
  if (rows.length === 0) return;

  await db.insert(authAttempts).values(rows);
}

/** Clears a bucket after a successful action, so users are not punished. */
export async function clearAttempts(
  db: AppDb,
  action: RateLimitedAction,
  opts: { identifier?: string | null; ip?: string | null },
): Promise<void> {
  if (opts.identifier) {
    await db
      .delete(authAttempts)
      .where(eq(authAttempts.key, bucketKey(action, "user", opts.identifier)));
  }
  if (opts.ip) {
    await db
      .delete(authAttempts)
      .where(eq(authAttempts.key, bucketKey(action, "ip", opts.ip)));
  }
}

/** Housekeeping: drop rows older than any window. Safe to run on a schedule. */
export async function purgeOldAttempts(
  db: AppDb,
  now: Date = new Date(),
): Promise<number> {
  const deleted = await db
    .delete(authAttempts)
    .where(lt(authAttempts.createdAt, new Date(now.getTime() - 24 * HOUR)))
    .returning({ id: authAttempts.id });
  return deleted.length;
}
