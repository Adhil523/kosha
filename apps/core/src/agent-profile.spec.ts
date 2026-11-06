import { agentRoutes } from './agent-routes';
import { buildApp } from './app';
import { credentialHash, issueCredential } from './credentials';
import type { DbHandle } from './db/client';
import { agent } from './db/schema';
import { testDb } from './db/test-db';
import { PrivateKey } from '@hiero-ledger/sdk';
import type { AgentProfile, ProfileResult } from '@kosha/hedera/hcs11-profile';
import { accountIdSchema, agentIdentitySchema, type Uaid, uaidSchema } from '@kosha/shared/ids';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_TOKEN = 'a'.repeat(48);
const ADMIN = { authorization: `Bearer ${ADMIN_TOKEN}` };
const ISSUER = PrivateKey.generateED25519();
const uaidFor = (account: string): Uaid =>
  uaidSchema.parse(
    `uaid:aid:7Hq3JX9;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:${account}`
  );
const UAID = uaidFor('0.0.6001');
const CREDENTIAL = issueCredential(ISSUER, UAID, {
  residency: 'resident',
  panOnFile: true,
  level: 1
});

const kosha = (hash: string, wallets: string[]): AgentProfile['kosha'] => ({
  credentialHash: hash,
  wallets: wallets.map((wallet) => accountIdSchema.parse(wallet))
});

// The profile B23 publishes for UAID
const PUBLISHED: AgentProfile = {
  accountId: '0.0.6001',
  profileTopicId: '0.0.7001',
  uaid: UAID,
  kosha: kosha(credentialHash(CREDENTIAL), ['0.0.6001'])
};

describe('POST /v1/agents with the HCS-14 profile check', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let served: ProfileResult = { ok: true, data: PUBLISHED };
  const looked: Uaid[] = [];

  const register = (payload: object) =>
    app.inject({ method: 'POST', url: '/v1/agents', headers: ADMIN, payload });
  const serve = (profile: Partial<AgentProfile>) => {
    served = { ok: true, data: { ...PUBLISHED, ...profile } };
  };

  beforeAll(async () => {
    handle = await testDb();
    const profileReader = {
      profileForUaid: async (uaid: Uaid) => {
        looked.push(uaid);
        return served;
      }
    };
    app = buildApp({
      logger: false,
      routes: [
        agentRoutes({
          db: handle.db,
          adminToken: ADMIN_TOKEN,
          issuerKey: ISSUER.publicKey,
          profileReader
        })
      ]
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it.each<[string, Partial<AgentProfile>, string]>([
    ['names another UAID', { uaid: uaidFor('0.0.6009') }, 'names another UAID'],
    ['has no properties.kosha', { kosha: null }, 'no properties.kosha'],
    [
      'holds another credential hash',
      { kosha: kosha('sha256:00', ['0.0.6001']) },
      'does not match the hash'
    ],
    [
      'declares other wallets',
      { kosha: kosha(credentialHash(CREDENTIAL), ['0.0.6001', '0.0.6002']) },
      'wallets differ'
    ]
  ])('refuses a profile that %s', async (_case, profile, message) => {
    serve(profile);
    const response = await register({
      identity: UAID,
      credential: CREDENTIAL,
      wallets: ['0.0.6001']
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_payload' });
    expect(response.json<{ message: string }>().message).toContain(message);
  });

  it('refuses an account without a profile, and answers 502 when the CDN is down', async () => {
    served = { ok: false, data: { reason: 'no_profile_memo' } };
    const missing = await register({
      identity: UAID,
      credential: CREDENTIAL,
      wallets: ['0.0.6001']
    });
    expect(missing.statusCode).toBe(400);

    served = { ok: false, data: { reason: 'http_error' } };
    const down = await register({ identity: UAID, credential: CREDENTIAL, wallets: ['0.0.6001'] });
    expect(down.statusCode).toBe(502);
    expect(down.json()).toMatchObject({ error: 'internal_error' });
  });

  it('registers a UAID whose profile matches, and caches the profile topic', async () => {
    serve({});
    const response = await register({
      identity: UAID,
      credential: CREDENTIAL,
      wallets: ['0.0.6001']
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ identity: UAID, level: 1 });

    const [row] = await handle.db.select().from(agent).where(eq(agent.identity, UAID));
    expect(row?.profileTopicID).toBe('0.0.7001');
    expect(row?.profileCheckedAt).toBeInstanceOf(Date);
  });

  it('never looks up a profile for a CAIP-10 identity', async () => {
    looked.length = 0;
    const identity = agentIdentitySchema.parse('hedera:testnet:0.0.6003');
    const response = await register({ identity, wallets: ['0.0.6003'] });
    expect(response.statusCode).toBe(201);
    expect(looked).toEqual([]);
  });

  it('registers a UAID unchecked when Core runs without a profile reader', async () => {
    const fallback = buildApp({
      logger: false,
      routes: [agentRoutes({ db: handle.db, adminToken: ADMIN_TOKEN, issuerKey: ISSUER.publicKey })]
    });
    const identity = uaidFor('0.0.6002');
    const response = await fallback.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: ADMIN,
      payload: { identity, wallets: ['0.0.6002'] }
    });
    expect(response.statusCode).toBe(201);

    const [row] = await handle.db.select().from(agent).where(eq(agent.identity, identity));
    expect(row?.profileTopicID).toBeNull();
  });
});
