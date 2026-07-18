import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type * as schema from "./schema";

/**
 * Structural database type: satisfied by both the Neon driver used in the app
 * and the PGlite instance used by scripts and tests, so data-access code is
 * written once and exercised against real Postgres in either context.
 */
export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;
