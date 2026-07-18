import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";
import type { AppDb } from "./types";

/**
 * Database handle.
 *
 * The application runtime is Neon-only. Using Neon's HTTP driver keeps queries
 * stateless, so serverless/edge invocations cannot exhaust a connection pool.
 * Trade-off: no interactive transactions — multi-statement atomic writes must
 * use `db.batch([...])`, which Neon runs in a single transaction.
 *
 * PGlite stays available to tests and local scripts via `src/lib/db/dev.ts`,
 * but the app runtime must not reference it or Cloudflare will bundle the WASM
 * binaries into the Worker and blow past the free-tier size limit.
 */
const globalForDb = globalThis as unknown as { __meridianDb?: Promise<AppDb> };

async function create(): Promise<AppDb> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "DATABASE_URL is required for the app runtime. Set it to the Neon pooled connection string.",
    );
  }

  return drizzle(neon(url), { schema }) as unknown as AppDb;
}

export function getDb(): Promise<AppDb> {
  globalForDb.__meridianDb ??= create();
  return globalForDb.__meridianDb;
}

export * from "./schema";
