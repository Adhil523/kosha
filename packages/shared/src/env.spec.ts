import { findRepoRoot, loadEnv } from './env';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('loadEnv', () => {
  let base: string;
  let root: string;
  let nested: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'kosha-env-'));
    root = join(base, 'repo');
    nested = join(root, 'apps', 'core');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('finds the repo root from a nested directory', () => {
    expect(findRepoRoot(nested)).toBe(root);
  });

  it('fails when no workspace marker exists above the directory', () => {
    const result = loadEnv({ cwd: tmpdir(), target: {} });
    expect(result.ok).toBe(false);
  });

  it('lets .env.local override .env', () => {
    writeFileSync(join(root, '.env'), 'CORE_PORT=4000\nHEDERA_NETWORK=testnet\n');
    writeFileSync(join(root, '.env.local'), 'CORE_PORT=4100\n');
    const target: NodeJS.ProcessEnv = {};

    const result = loadEnv({ cwd: nested, target });

    expect(result.ok).toBe(true);
    expect(target).toEqual({ CORE_PORT: '4100', HEDERA_NETWORK: 'testnet' });
  });

  it('never overrides variables already set in the process', () => {
    writeFileSync(join(root, '.env'), 'CORE_PORT=4000\n');
    const target: NodeJS.ProcessEnv = { CORE_PORT: '9999' };

    loadEnv({ cwd: nested, target });

    expect(target.CORE_PORT).toBe('9999');
  });

  it('follows a symlinked .env, as the shared env file is set up', () => {
    const shared = join(base, 'kosha.env');
    writeFileSync(shared, 'USDC_TOKEN_ID=0.0.1234\n');
    symlinkSync(shared, join(root, '.env'));
    const target: NodeJS.ProcessEnv = {};

    const result = loadEnv({ cwd: nested, target });

    expect(target.USDC_TOKEN_ID).toBe('0.0.1234');
    expect(result.ok && result.data.loadedFiles).toEqual([join(root, '.env')]);
  });

  it('loads nothing when neither file exists', () => {
    const target: NodeJS.ProcessEnv = {};

    const result = loadEnv({ cwd: nested, target });

    expect(result).toEqual({ ok: true, data: { root, loadedFiles: [] } });
    expect(target).toEqual({});
  });
});
