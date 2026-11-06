import { buildApp } from './app';
import { hashApiKey } from './auth';
import { CHALLENGE_TTL_MS, createChallengeStore } from './challenges';
import type { DbHandle } from './db/client';
import { receiver, receiverWallet } from './db/schema';
import { testDb } from './db/test-db';
import { panCommitment, receiverRoutes } from './receiver-routes';
import { PrivateKey } from '@hiero-ledger/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN = { authorization: `Bearer ${'a'.repeat(48)}` };
const PAN_SECRET = 's'.repeat(32);
const walletKey = PrivateKey.generateED25519();
const otherKey = PrivateKey.generateED25519();

const sign = (key: PrivateKey, nonce: string) =>
  Buffer.from(key.sign(new TextEncoder().encode(nonce))).toString('hex');

describe('receiver onboarding', () => {
  let handle: DbHandle;
  let clock = new Date('2026-11-06T09:00:00Z');
  const challenges = createChallengeStore(() => clock);
  let app: ReturnType<typeof buildApp>;

  const business = (nonce: string, signature: string, accountId = '0.0.5001') => ({
    legalName: 'Demo GST Data Pvt Ltd',
    residency: 'resident',
    specifiedPerson: false,
    pan: 'AAPFU0939F',
    tan: 'MUMD12345E',
    mode: 'threshold',
    challengeNonce: nonce,
    wallets: [{ accountId, signature }]
  });

  const challenge = async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/receivers/challenge',
      headers: ADMIN
    });
    return response.json<{ nonce: string }>().nonce;
  };

  const onboard = (payload: object) =>
    app.inject({ method: 'POST', url: '/v1/receivers', headers: ADMIN, payload });

  beforeAll(async () => {
    handle = await testDb();
    app = buildApp({
      logger: false,
      routes: [
        receiverRoutes({
          db: handle.db,
          adminToken: 'a'.repeat(48),
          panCommitSecret: PAN_SECRET,
          keyLookup: async (accountId) => (accountId === '0.0.5001' ? walletKey.publicKey : null),
          challenges,
          defaultUnverifiedPolicy: 'threshold_tolerant'
        })
      ]
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it('onboards a receiver whose wallet signed the challenge, and returns its key once', async () => {
    const nonce = await challenge();
    const response = await onboard(business(nonce, sign(walletKey, nonce)));

    expect(response.statusCode).toBe(201);
    const { receiverId, apiKey } = response.json<{ receiverId: string; apiKey: string }>();
    expect(apiKey).toMatch(/^[0-9a-f]{64}$/);

    const [row] = await handle.db.select().from(receiver);
    expect(row?.id).toBe(receiverId);
    expect(row?.apiKeyHash).toBe(hashApiKey(apiKey));
    expect(row?.panCommitment).toBe(panCommitment('AAPFU0939F', PAN_SECRET));
    expect(JSON.stringify(row)).not.toContain('AAPFU0939F');
    expect(row?.unverifiedPolicy).toBe('threshold_tolerant');
    const wallets = await handle.db.select().from(receiverWallet);
    expect(wallets.map((wallet) => wallet.accountID)).toEqual(['0.0.5001']);
  });

  it('refuses a wallet that is already registered', async () => {
    const nonce = await challenge();
    const response = await onboard(business(nonce, sign(walletKey, nonce)));
    expect(response.statusCode).toBe(400);
  });

  it('refuses a signature by another key and an account with no key', async () => {
    let nonce = await challenge();
    expect((await onboard(business(nonce, sign(otherKey, nonce), '0.0.5001'))).statusCode).toBe(
      400
    );
    nonce = await challenge();
    expect((await onboard(business(nonce, sign(otherKey, nonce), '0.0.5999'))).statusCode).toBe(
      400
    );
  });

  it('refuses a reused or expired challenge', async () => {
    const reused = await challenge();
    await onboard(business(reused, sign(otherKey, reused)));
    expect((await onboard(business(reused, sign(walletKey, reused)))).json()).toMatchObject({
      error: 'invalid_payload',
      message: 'challenge expired or already used'
    });

    const stale = await challenge();
    clock = new Date(clock.getTime() + CHALLENGE_TTL_MS + 1);
    expect((await onboard(business(stale, sign(walletKey, stale)))).statusCode).toBe(400);
  });

  it('needs the admin token and a valid body', async () => {
    const noAuth = await app.inject({ method: 'GET', url: '/v1/receivers/challenge' });
    expect(noAuth.statusCode).toBe(401);
    const nonce = await challenge();
    const noTan = { ...business(nonce, sign(walletKey, nonce)), tan: undefined };
    expect((await onboard(noTan)).json()).toMatchObject({ error: 'invalid_payload' });
  });
});
