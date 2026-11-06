import * as schema from './schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Postgres in dev and deploy, PGlite in tests: both satisfy this type, so services take a KoshaDb
export type KoshaDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export type DbHandle = { db: KoshaDb; close: () => Promise<void> };

// One pool per process, created at startup and closed on shutdown; never per request
export const createDb = (url: string): DbHandle => {
  const pool = new pg.Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
};

export const migrateDb = async (url: string): Promise<void> => {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
};
