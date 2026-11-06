import { registerAgent } from './register';
import { PrivateKey } from '@hiero-ledger/sdk';
import { agentIdentitySchema } from '@kosha/shared/ids';
import { describe, expect, it } from 'vitest';

const KEY = PrivateKey.generateED25519();
const ACCOUNT = '0.0.6003';
const IDENTITY = agentIdentitySchema.parse(`hedera:testnet:${ACCOUNT}`);
const NONCE = 'a1'.repeat(24);

const AGENT_ROW = {
  agentId: 'agt_1',
  identity: IDENTITY,
  level: 1,
  residency: 'resident',
  panOnFile: true,
  reserveAccountId: '0.0.6103',
  wallets: [ACCOUNT],
  credentialIssuer: null,
  profileTopicId: null,
  verifiedAt: null
};

type Call = { url: string; init?: RequestInit };

// Core's two endpoints, recording what the agent sent
const fakeCore = (selfStatus = 201, selfBody: unknown = AGENT_ROW) => {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/v1/agents/challenge')) {
      return Response.json({ nonce: NONCE, expiresAt: '2026-11-07T00:10:00.000Z' });
    }
    return Response.json(selfBody, { status: selfStatus });
  }) as typeof fetch;
  return { fetchImpl, calls };
};

const deps = (fetchImpl: typeof fetch) => ({
  fetch: fetchImpl,
  accountId: ACCOUNT,
  privateKey: KEY
});

describe('registerAgent', () => {
  it('signs the nonce with the account key and posts the registration', async () => {
    const core = fakeCore();
    const result = await registerAgent(deps(core.fetchImpl), {
      coreUrl: 'http://core.test/',
      identity: IDENTITY
    });

    expect(result.ok && result.data.status).toBe('created');
    const self = core.calls[1];
    expect(self?.url).toBe('http://core.test/v1/agents/self');
    const body = JSON.parse(String(self?.init?.body)) as {
      identity: string;
      wallets: string[];
      challengeNonce: string;
      signature: string;
      credential?: unknown;
    };
    expect(body.identity).toBe(IDENTITY);
    expect(body.wallets).toEqual([ACCOUNT]);
    expect(body.challengeNonce).toBe(NONCE);
    expect(body.credential).toBeUndefined();
    const verified = KEY.publicKey.verify(
      new TextEncoder().encode(NONCE),
      Buffer.from(body.signature, 'hex')
    );
    expect(verified).toBe(true);
  });

  it('reports an upgrade as updated', async () => {
    const core = fakeCore(200);
    const result = await registerAgent(deps(core.fetchImpl), {
      coreUrl: 'http://core.test',
      identity: IDENTITY
    });
    expect(result).toMatchObject({ ok: true, data: { status: 'updated' } });
  });

  it('passes Core’s refusal through with its code', async () => {
    const core = fakeCore(400, { error: 'invalid', message: 'challenge expired or already used' });
    const result = await registerAgent(deps(core.fetchImpl), {
      coreUrl: 'http://core.test',
      identity: IDENTITY
    });
    expect(result).toEqual({
      ok: false,
      data: {
        reason: 'refused',
        status: 400,
        message: 'invalid: challenge expired or already used'
      }
    });
  });

  it('fails cleanly when Core issues no challenge', async () => {
    const fetchImpl = (async () => new Response('down', { status: 503 })) as typeof fetch;
    const result = await registerAgent(deps(fetchImpl), {
      coreUrl: 'http://core.test',
      identity: IDENTITY
    });
    expect(result).toMatchObject({
      ok: false,
      data: { reason: 'challenge_unavailable', status: 503 }
    });
  });
});
