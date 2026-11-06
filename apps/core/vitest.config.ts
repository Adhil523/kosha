import { defineConfig } from 'vitest/config';

// Database tests start an in-process Postgres (PGlite) and apply the migrations in beforeAll. That
// takes a few seconds locally but can exceed Vitest's 10-second hook default on CI runners.
export default defineConfig({
  test: {
    hookTimeout: 60_000,
    testTimeout: 30_000
  }
});
