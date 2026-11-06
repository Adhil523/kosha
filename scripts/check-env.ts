import { loadEnv } from '@kosha/shared/env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

// Reports which keys from .env.example are still empty, without printing any value.
const main = () => {
  const loaded = loadEnv();
  if (!loaded.ok) {
    console.error(`[check-env]: no pnpm workspace found above ${loaded.data.searchedFrom}`);
    process.exitCode = 1;
    return;
  }

  const { root, loadedFiles } = loaded.data;
  const expected = Object.keys(parseEnv(readFileSync(join(root, '.env.example'), 'utf8')));
  const missing = expected.filter((key) => !process.env[key]);

  console.info(`[check-env]: read ${loadedFiles.length ? loadedFiles.join(', ') : 'no env files'}`);
  console.info(`[check-env]: ${expected.length - missing.length}/${expected.length} keys set`);
  if (missing.length > 0) {
    console.info(`[check-env]: missing ${missing.join(', ')}`);
  }
};

void main();
