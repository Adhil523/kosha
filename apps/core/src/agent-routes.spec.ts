import { agentRoutes } from './agent-routes';
import { buildApp } from './app';
import { createChallengeStore } from './challenges';
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
// The keys the Mirror Node would report for the accounts that register themselves
const ACCOUNT_KEYS: Record<string, PrivateKey> = {
  '0.0.6004': PrivateKey.generateED25519(),
  '0.0.6005': PrivateKey.generateECDSA()
};

describe('agent registry', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;

  const register = (payload: object) =>
    app.inject({ method: 'POST', url: '/v1/agents', headers: ADMIN, payload });

  beforeAll(async () => {
    handle = await testDb();
    app = buildApp({
      logger: false,
      routes: [
        agentRoutes({
          db: handle.db,
          adminToken: ADMIN_TOKEN,
          issuerKey: ISSUER.publicKey,
          keyLookup: async (account) => ACCOUNT_KEYS[account]?.publicKey ?? null,
          challenges: createChallengeStore()
        })
      ]
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

  it('lists every registered agent, oldest first, with its wallets', async () => {
    const later = agentIdentitySchema.parse('hedera:testnet:0.0.6002');
    await register({ identity: later, wallets: ['0.0.6002', '0.0.6012'] });

    const response = await app.inject({ method: 'GET', url: '/v1/agents', headers: ADMIN });
    expect(response.statusCode).toBe(200);
    const rows = response.json() as { identity: string; wallets: string[] }[];
    expect(rows.map((row) => row.identity)).toEqual([UNKNOWN, later]);
    expect(rows[0]).toMatchObject({ level: 1, wallets: ['0.0.6003'] });
    expect([...(rows[1]?.wallets ?? [])].sort()).toEqual(['0.0.6002', '0.0.6012']);

    const anonymous = await app.inject({ method: 'GET', url: '/v1/agents' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('answers 404 for an unknown agent and 401 without the admin token', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/v1/agents/nope', headers: ADMIN })).statusCode
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/agents/nope' })).statusCode).toBe(401);
  });

  describe('moving from a CAIP-10 identity to a UAID', () => {
    const uaidFor = (account: string) =>
      agentIdentitySchema.parse(
        `uaid:aid:z6Mk${account.replaceAll('.', '')};uid=0;nativeId=hedera:testnet:${account}`
      );

    it('upgrades the agent in place, keeping its ID, wallets and reserve', async () => {
      const before = await register({ identity: UNKNOWN, wallets: ['0.0.6003'] });
      const upgraded = await register({ identity: uaidFor('0.0.6003'), wallets: ['0.0.6003'] });

      expect(upgraded.statusCode).toBe(200);
      expect(upgraded.json()).toMatchObject({
        agentId: before.json<{ agentId: string }>().agentId,
        identity: uaidFor('0.0.6003'),
        wallets: ['0.0.6003'],
        reserveAccountId: '0.0.6103'
      });
    });

    it('keeps the UAID when the agent registers by its account again', async () => {
      const again = await register({ identity: UNKNOWN, wallets: ['0.0.6003'] });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ identity: uaidFor('0.0.6003') });
    });

    it("still refuses a UAID for an account that is another agent's wallet", async () => {
      // 0.0.6012 is a second wallet of the agent registered as hedera:testnet:0.0.6002
      const clash = await register({ identity: uaidFor('0.0.6012'), wallets: ['0.0.6012'] });
      expect(clash.statusCode).toBe(400);
    });
  });

  describe('POST /v1/agents/self', () => {
    const SELF = agentIdentitySchema.parse('hedera:testnet:0.0.6004');

    const selfRegister = async (body: object, account = '0.0.6004') => {
      const challenge = await app.inject({ method: 'GET', url: '/v1/agents/challenge' });
      const { nonce } = challenge.json<{ nonce: string }>();
      const key = ACCOUNT_KEYS[account];
      if (!key) throw new Error(`no key for ${account}`);
      const signature = Buffer.from(key.sign(new TextEncoder().encode(nonce))).toString('hex');
      return app.inject({
        method: 'POST',
        url: '/v1/agents/self',
        payload: { challengeNonce: nonce, signature, ...body }
      });
    };

    it('registers an agent that signs with its own account, without the admin token', async () => {
      const response = await selfRegister({ identity: SELF, wallets: ['0.0.6004'] });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ identity: SELF, level: 0, reserveAccountId: null });
    });

    it('upgrades itself to a UAID and Level 1 with its credential', async () => {
      const uaid = agentIdentitySchema.parse(
        'uaid:aid:z6Mk6004;uid=0;nativeId=hedera:testnet:0.0.6004'
      );
      const credential = issueCredential(ISSUER, uaid, {
        residency: 'resident',
        panOnFile: true,
        level: 1
      });
      const response = await selfRegister({ identity: uaid, credential, wallets: ['0.0.6004'] });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ identity: uaid, level: 1, panOnFile: true });
    });

    it("refuses a signature from another account's key", async () => {
      const response = await selfRegister({ identity: SELF, wallets: ['0.0.6004'] }, '0.0.6005');
      expect(response.statusCode).toBe(401);
    });

    it('refuses a wallet other than its own account, and a reused challenge', async () => {
      const extra = await selfRegister({ identity: SELF, wallets: ['0.0.6004', '0.0.6099'] });
      expect(extra.statusCode).toBe(400);

      const challenge = await app.inject({ method: 'GET', url: '/v1/agents/challenge' });
      const { nonce } = challenge.json<{ nonce: string }>();
      const key = ACCOUNT_KEYS['0.0.6004'];
      const signature = Buffer.from(key?.sign(new TextEncoder().encode(nonce)) ?? []).toString(
        'hex'
      );
      const payload = { challengeNonce: nonce, signature, identity: SELF, wallets: ['0.0.6004'] };
      await app.inject({ method: 'POST', url: '/v1/agents/self', payload });
      const replay = await app.inject({ method: 'POST', url: '/v1/agents/self', payload });
      expect(replay.statusCode).toBe(400);
    });

    it('cannot set its own reserve', async () => {
      const response = await selfRegister({
        identity: SELF,
        wallets: ['0.0.6004'],
        reserveAccountId: '0.0.6666'
      });
      expect(response.json()).toMatchObject({ reserveAccountId: null });
    });
  });
});
