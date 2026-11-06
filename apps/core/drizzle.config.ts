import { defineConfig } from 'drizzle-kit';

// drizzle-kit needs a default export. Generating migrations reads only the schema; the URL is
// used by drizzle-kit commands that connect (Core itself migrates with src/db/migrate.ts).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' }
});
