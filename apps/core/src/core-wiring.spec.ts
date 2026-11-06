import { readRulePack } from './active-rule-pack';
import { buildApp } from './app';
import { loadConfig } from './config';
import { wireCore } from './core-wiring';
import type { DbHandle } from './db/client';
import { testDb } from './db/test-db';
import { Client, PrivateKey } from '@hiero-ledger/sdk';
import { findRepoRoot } from '@kosha/shared/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SECRET = 'f'.repeat(64);
const CORE_KEY = PrivateKey.generateED25519();
const CONFIG = loadConfig({
  HEDERA_NETWORK: 'testnet',
  CORE_PORT: '4000',
  CORE_ACCOUNT_ID: '0.0.4000',
  CORE_PRIVATE_KEY: CORE_KEY.toStringDer(),
  RULEPACK_PATH: 'rulepacks/in-2026.2.json',
  DATABASE_URL: 'postgres://unused',
  MIRROR_URL: 'https://testnet.mirrornode.hedera.com',
  SETTLEMENT_TOKEN_ID: '0.0.7000',
  HCS_PAYMENTS_TOPIC: '0.0.7100',
  MAX_TX_FEE_HBAR: '2',
  FX_DEMO_INR_PER_USD: '88.40',
  PAIR_HMAC_SECRET: SECRET,
  PAN_COMMIT_SECRET: SECRET,
  CONSOLE_ADMIN_TOKEN: SECRET,
  ISSUER_PRIVATE_KEY: PrivateKey.generateED25519().toStringDer()
});

describe('wireCore', () => {
  let handle: DbHandle;
  let client: Client;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    if (!CONFIG.ok) throw new Error('sample config is invalid');
    const rulePack = await readRulePack(
      CONFIG.data.rulePackPath,
      findRepoRoot(process.cwd()) ?? ''
    );
    if (!rulePack.ok) throw new Error(rulePack.data.reason);
    handle = await testDb();
    client = Client.forTestnet();
    const wired = wireCore(CONFIG.data, rulePack.data, handle.db, { client, key: CORE_KEY });
    if (!wired.ok) throw new Error(wired.data.problem);
    app = buildApp({ logger: false, routes: wired.data.routes });
  });

  afterAll(async () => {
    client.close();
    await handle.close();
  });

  it.each([
    ['GET', '/v1/supported', 200],
    ['GET', '/v1/receivers/challenge', 401],
    ['POST', '/v1/agents', 401],
    ['POST', '/v1/quote', 401],
    ['POST', '/v1/verify', 401],
    ['POST', '/v1/settle', 401]
  ] as const)('mounts %s %s', async (method, url, status) => {
    const payload = method === 'POST' ? { x402Version: 2 } : undefined;
    const response = await app.inject({ method, url, payload });
    expect([status, 400]).toContain(response.statusCode);
    expect(response.statusCode).not.toBe(404);
  });

  it('refuses an unusable issuer key or FX rate', async () => {
    if (!CONFIG.ok) throw new Error('sample config is invalid');
    const rulePack = await readRulePack(
      CONFIG.data.rulePackPath,
      findRepoRoot(process.cwd()) ?? ''
    );
    if (!rulePack.ok) throw new Error(rulePack.data.reason);
    const operator = { client, key: CORE_KEY };
    const badIssuer = wireCore(
      { ...CONFIG.data, issuerPrivateKey: 'nope' },
      rulePack.data,
      handle.db,
      operator
    );
    expect(badIssuer).toMatchObject({
      ok: false,
      data: { problem: expect.stringContaining('ISSUER') }
    });
    const badFx = wireCore(
      { ...CONFIG.data, fxInrPerUsd: '0' },
      rulePack.data,
      handle.db,
      operator
    );
    expect(badFx).toMatchObject({ ok: false, data: { problem: expect.stringContaining('FX') } });
  });
});
