/**
 * DEV/TEST ONLY — an in-process Postgres via PGlite (real Postgres compiled to
 * WASM), so migrations, seeds and data-dependent tests can run with no Neon
 * project and no local Postgres install.
 *
 * The application itself never imports this: `src/lib/db/index.ts` is
 * Neon-only, so nothing here reaches a production bundle and the serverless
 * driver requirement is unaffected. Scripts and tests import it explicitly.
 */
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "./schema";

export type DevDb = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * @param dataDir Persist to disk (e.g. ".pglite") or omit for a throwaway
 *                in-memory database, which is what tests want.
 */
export async function createDevDb(dataDir?: string): Promise<DevDb> {
  const client = new PGlite(dataDir);
  await client.waitReady;

  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return db;
}
