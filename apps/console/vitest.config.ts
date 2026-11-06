import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  // tests/ holds the Playwright suite (pnpm test:e2e)
  test: { exclude: [...configDefaults.exclude, 'tests/**'] }
});
