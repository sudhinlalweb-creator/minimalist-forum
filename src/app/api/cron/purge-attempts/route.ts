import { purgeOldAttempts } from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db";

/**
 * Scheduled cleanup for `auth_attempts`.
 *
 * Rate limiting only ever reads rows inside a window, so nothing expires on
 * its own — the table grows for the lifetime of the deployment and every
 * bucket count scans more dead rows over time.
 *
 * Exposed as an authenticated route rather than a platform-specific scheduled
 * handler so the same endpoint works from Cloudflare Cron Triggers, Vercel
 * Cron, or curl. The deployment target for this project is still unsettled;
 * a Worker `scheduled()` export would tie cleanup to one of them.
 */

// Cleanup mutates and must never be prerendered or cached.
export const dynamic = "force-dynamic";

/** Constant-time compare, so a wrong secret leaks nothing through timing. */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;

  // Closed by default: an unset secret disables the endpoint rather than
  // leaving a public delete route exposed.
  if (!expected) {
    return Response.json(
      { error: "CRON_SECRET is not configured." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!secretMatches(token, expected)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const db = await getDb();
  const deleted = await purgeOldAttempts(db);

  return Response.json({ deleted });
}
