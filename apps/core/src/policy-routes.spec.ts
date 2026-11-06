import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { agent } from './db/schema';
import { testDb } from './db/test-db';
import { policyRoutes } from './policy-routes';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_TOKEN = 'a'.repeat(48);
const ADMIN = { authorization: `Bearer ${ADMIN_TOKEN}` };
const RULES = {
  perPaymentMicro: '500000',
  dailyMicro: '5000000',
  fyBudgetMicro: '200000000',
  allowlist: ['api.demo-in.dev', '*.demo-global.dev'],
  thresholdAction: 'warn',
  acceptRulepacks: ['in-tds-194t-v2']
};

describe('agent policy endpoints', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let agentId = '';

  const policyOf = (id: string, headers = ADMIN) =>
    app.inject({ method: 'GET', url: `/v1/agents/${id}/policy`, headers });
  const putPolicy = (id: string, payload: object) =>
    app.inject({ method: 'PUT', url: `/v1/agents/${id}/policy`, headers: ADMIN, payload });

  beforeAll(async () => {
    handle = await testDb();
    app = buildApp({
      logger: false,
      routes: [policyRoutes({ db: handle.db, adminToken: ADMIN_TOKEN })]
    });
    const [row] = await handle.db
      .insert(agent)
      .values({ identity: 'hedera:testnet:0.0.6001' })
      .returning({ id: agent.id });
    agentId = row?.id ?? '';
  });

  afterAll(async () => {
    await handle.close();
  });

  it('answers 404 before a policy is set', async () => {
    const response = await policyOf(agentId);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });

  it('stores a policy and reads it back', async () => {
    const saved = await putPolicy(agentId, RULES);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual(RULES);
    expect((await policyOf(agentId)).json()).toEqual(RULES);
  });

  it('replaces every rule on a second PUT', async () => {
    const next = { ...RULES, dailyMicro: '1000000', allowlist: [], thresholdAction: 'block' };
    await putPolicy(agentId, next);
    expect((await policyOf(agentId)).json()).toEqual(next);
  });

  it('refuses a policy for an unknown agent', async () => {
    const response = await putPolicy('missing', RULES);
    expect(response.statusCode).toBe(404);
  });

  it('rejects a cap that is not a whole number of micro-USDC', async () => {
    const response = await putPolicy(agentId, { ...RULES, dailyMicro: '1.5' });
    expect(response.statusCode).toBe(400);
  });

  it('requires the admin token', async () => {
    const response = await policyOf(agentId, { authorization: 'Bearer wrong' });
    expect(response.statusCode).toBe(401);
  });
});
