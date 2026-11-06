import { agentRoutes } from './agent-routes';
import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { testDb } from './db/test-db';
import { PrivateKey } from '@hiero-ledger/sdk';
import { issueCredential } from '@kosha/hedera/credentials';
import { agentIdentitySchema } from '@kosha/shared/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_TOKEN = 'a'.repeat(48);
const ADMIN = { authorization: `Bearer ${ADMIN_TOKEN}` };
const ISSUER = PrivateKey.generateED25519();
const UNKNOWN = agentIdentitySchema.parse('hedera:testnet:0.0.6003');
const RESIDENT = agentIdentitySchema.parse('hedera:testnet:0.0.6001');

describe('agent registry', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;

  const register = (payload: object) =>
    app.inject({ method: 'POST', url: '/v1/agents', headers: ADMIN, payload });

  beforeAll(async () => {
    handle = await testDb();
    app = buildApp({
      logger: false,
      routes: [agentRoutes({ db: handle.db, adminToken: ADMIN_TOKEN, issuerKey: ISSUER.publicKey })]
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it('registers an agent without a credential at Level 0', async () => {
    const response = await register({
      identity: UNKNOWN,
      wallets: ['0.0.6003'],
      reserveAccountId: '0.0.6103'
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      identity: UNKNOWN,
      level: 0,
      residency: 'unknown',
      panOnFile: false,
      wallets: ['0.0.6003'],
      reserveAccountId: '0.0.6103',
      verifiedAt: null
    });
  });

  it('upgrades the same agent to Level 1 when it presents a credential', async () => {
    const credential = issueCredential(ISSUER, UNKNOWN, {
      residency: 'resident',
      panOnFile: true,
      level: 1
    });
    const response = await register({ identity: UNKNOWN, credential, wallets: ['0.0.6003'] });

    expect(response.statusCode).toBe(200);
    const row = response.json<{ agentId: string }>();
    expect(row).toMatchObject({
      level: 1,
      residency: 'resident',
      panOnFile: true,
      reserveAccountId: '0.0.6103'
    });

    const read = await app.inject({
      method: 'GET',
      url: `/v1/agents/${row.agentId}`,
      headers: ADMIN
    });
    expect(read.json()).toMatchObject({ identity: UNKNOWN, level: 1 });
  });

  it('refuses a credential from another issuer, for another agent, or tampered with', async () => {
    const foreign = issueCredential(PrivateKey.generateED25519(), RESIDENT, {
      residency: 'resident',
      panOnFile: true,
      level: 1
    });
    const forOther = issueCredential(ISSUER, UNKNOWN, {
      residency: 'resident',
      panOnFile: true,
      level: 1
    });
    const genuine = issueCredential(ISSUER, RESIDENT, {
      residency: 'resident',
      panOnFile: false,
      level: 1
    });
    const tampered = { ...genuine, claims: { ...genuine.claims, panOnFile: true } };

    for (const credential of [foreign, forOther, tampered]) {
      const response = await register({ identity: RESIDENT, credential, wallets: ['0.0.6001'] });
      expect(response.statusCode).toBe(400);
    }
  });

  it('refuses a wallet that belongs to another agent', async () => {
    const response = await register({ identity: RESIDENT, wallets: ['0.0.6003'] });
    expect(response.json()).toMatchObject({
      error: 'invalid_payload',
      message: 'a wallet belongs to another agent'
    });
  });

  it('answers 404 for an unknown agent and 401 without the admin token', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/v1/agents/nope', headers: ADMIN })).statusCode
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/agents/nope' })).statusCode).toBe(401);
  });
});
