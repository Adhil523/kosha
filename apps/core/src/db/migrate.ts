import { migrateDb } from './client';
import { loadEnv } from '@kosha/shared/env';

// `pnpm --filter @kosha/core db:migrate`: applies drizzle/ to DATABASE_URL. Never prints the URL,
// which carries the password.
const main = async (): Promise<void> => {
  loadEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error('[db:migrate]: DATABASE_URL is missing');
    process.exitCode = 1;
    return;
  }
  try {
    await migrateDb(url);
    console.info('[db:migrate]: migrations applied');
  } catch (error) {
    console.error('[db:migrate]: migration failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
};

void main();
