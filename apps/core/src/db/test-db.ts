import { type DbHandle, MIGRATIONS_FOLDER } from './client';
import * as schema from './schema';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

// An in-process Postgres with Core's real migrations applied: tests need no Docker and no ports,
// so both agents can run them at once (PROTOCOL §2)
export const testDb = async (): Promise<DbHandle> => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
};
