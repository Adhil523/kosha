import { readRulePack } from './active-rule-pack';
import { buildApp } from './app';
import { supportedRoutes } from './supported-routes';
import { findRepoRoot } from '@kosha/shared/env';
import { accountIdSchema } from '@kosha/shared/ids';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = findRepoRoot(process.cwd()) ?? '';

describe('readRulePack', () => {
  it('reads and hashes the shipped pack', async () => {
    const read = await readRulePack('rulepacks/in-2026.2.json', REPO_ROOT);
    expect(read.ok && read.data.pack.id).toBe('in-2026.2');
    expect(read.ok && read.data.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports a missing file, bad JSON and an invalid pack', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kosha-pack-'));
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    writeFileSync(join(dir, 'wrong.json'), JSON.stringify({ id: 'in-2026.2' }));

    expect((await readRulePack('nope.json', dir)).data).toMatchObject({ reason: 'unreadable' });
    expect((await readRulePack('bad.json', dir)).data).toMatchObject({ reason: 'invalid_json' });
    const wrong = await readRulePack(join(dir, 'wrong.json'), REPO_ROOT);
    expect(wrong.data).toMatchObject({ reason: 'invalid_rule_pack' });
  });
});

describe('GET /v1/supported', () => {
  it('lists both schemes with Core as fee payer, and the rule pack', async () => {
    const rulePack = await readRulePack('rulepacks/in-2026.2.json', REPO_ROOT);
    if (!rulePack.ok) throw new Error(rulePack.data.reason);
    const feePayer = accountIdSchema.parse('0.0.4000');
    const app = buildApp({
      logger: false,
      routes: [supportedRoutes({ network: 'testnet', feePayer, rulePack: rulePack.data })]
    });

    const response = await app.inject({ method: 'GET', url: '/v1/supported' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.kinds).toEqual([
      {
        x402Version: 2,
        scheme: 'kosha-split',
        network: 'hedera:testnet',
        extra: { feePayer: '0.0.4000' }
      },
      {
        x402Version: 2,
        scheme: 'exact',
        network: 'hedera:testnet',
        extra: { feePayer: '0.0.4000' }
      }
    ]);
    expect(body.signers).toEqual({ 'hedera:*': ['0.0.4000'] });
    expect(body.kosha.rulepack).toEqual({
      id: 'in-2026.2',
      hash: rulePack.data.hash,
      reviewedBy: null
    });
  });
});
