/**
 * Per-request details that rate limiting needs from the HTTP layer.
 *
 * Kept apart from `rate-limit.ts` on purpose: that module is pure database
 * logic and is exercised directly in tests, while this one imports
 * `next/headers` and only works inside a request scope. Merging them would
 * drag a server-only import into the test path.
 */

import { headers } from "next/headers";

/**
 * Best-effort client address for rate limiting. Set by the platform in
 * production; usually absent locally, in which case only the per-account
 * bucket applies.
 *
 * `x-forwarded-for` is a client-controlled header that the proxy appends to,
 * so the left-most entry is the original caller. It is spoofable in principle
 * — treat it as a throttling hint, never as identity or authorisation.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip");
}

/** Human-readable retry message for a blocked action. */
export function tooManyMessage(
  retryAfter: Date | null,
  now: Date = new Date(),
): string {
  if (!retryAfter) return "Too many attempts. Please try again later.";

  const minutes = Math.max(
    1,
    Math.ceil((retryAfter.getTime() - now.getTime()) / 60_000),
  );
  return `Too many attempts. Please try again in ${minutes} minute${
    minutes === 1 ? "" : "s"
  }.`;
}
