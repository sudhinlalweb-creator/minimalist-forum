import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";
import type { AppDb } from "./types";

/**
 * Database handle.
 *
 * Production always uses Neon's HTTP driver, not a `pg` Pool: every query is a
 * stateless fetch, so serverless/edge invocations cannot exhaust the connection
 * limit. Trade-off: no interactive transactions — multi-statement atomic writes
 * must use `db.batch([...])`, which Neon runs in a single transaction.
 *
 * With no DATABASE_URL in development, it falls back to in-process PGlite so
 * the app runs against real Postgres before a Neon project exists. That branch
 * cannot be reached in production, where a missing URL throws instead.
 */

// Cached on globalThis so Next's hot reload does not open a second PGlite
// instance against the same directory on every edit.
const globalForDb = globalThis as unknown as { __meridianDb?: Promise<AppDb> };

async function create(): Promise<AppDb> {
  const url = process.env.DATABASE_URL;

  if (url) {
    return drizzle(neon(url), { schema }) as unknown as AppDb;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL is required in production. Set it to the Neon pooled connection string.",
    );
  }

  console.warn(
    "[db] No DATABASE_URL — using local PGlite at .pglite/. Run `npm run db:seed` to populate it.",
  );
  const { createDevDb } = await import("./dev");
  return (await createDevDb(".pglite")) as unknown as AppDb;
}

export function getDb(): Promise<AppDb> {
  globalForDb.__meridianDb ??= create();
  return globalForDb.__meridianDb;
}

export * from "./schema";
