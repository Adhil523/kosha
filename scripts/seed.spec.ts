import {
  type CoreHttp,
  demoReceivers,
  demoResetRequest,
  previousQuarter,
  readSeedEnv,
  sampleHistory,
  seedAgents,
  type SeedEnv,
  seedHistory,
  seedReceivers,
  seedResetDemo
} from './seed';
import { PrivateKey } from '@hiero-ledger/sdk';
import { verifyCredential } from '@kosha/hedera/credentials';
import { demoResetRequestSchema, samplePaymentsRequestSchema } from '@kosha/shared/demo-admin';
import { agentRegisterSchema, receiverCreateSchema } from '@kosha/shared/registry';
import { describe, expect, it } from 'vitest';

const ISSUER = PrivateKey.generateED25519();
const WALLET_KEYS = {
  '0.0.5001': PrivateKey.generateED25519(),
  '0.0.5002': PrivateKey.generateECDSA(),
  '0.0.5003': PrivateKey.generateED25519()
};

const ENV = {
  HEDERA_NETWORK: 'testnet',
  CORE_URL: 'http://localhost:4000',
  CONSOLE_ADMIN_TOKEN: 'a'.repeat(64),
  ISSUER_PRIVATE_KEY: ISSUER.toStringDer(),
  DEMO_API_IN_KEY: 'b'.repeat(64),
  DEMO_API_GLOBAL_KEY: 'c'.repeat(64),
  RECEIVER_IN_ACCOUNT_ID: '0.0.5001',
  RECEIVER_IN_PRIVATE_KEY: WALLET_KEYS['0.0.5001'].toStringDer(),
  RECEIVER_IN_SOLO_ACCOUNT_ID: '0.0.5002',
  RECEIVER_IN_SOLO_PRIVATE_KEY: WALLET_KEYS['0.0.5002'].toStringDer(),
  RECEIVER_GLOBAL_ACCOUNT_ID: '0.0.5003',
  RECEIVER_GLOBAL_PRIVATE_KEY: WALLET_KEYS['0.0.5003'].toStringDer(),
  AGENT_RESIDENT_ACCOUNT_ID: '0.0.6001',
  AGENT_RESIDENT_RESERVE_ID: '0.0.6101',
  AGENT_NONRESIDENT_ACCOUNT_ID: '0.0.6002',
  AGENT_NONRESIDENT_RESERVE_ID: '0.0.6102',
  AGENT_UNKNOWN_ACCOUNT_ID: '0.0.6003',
  AGENT_UNKNOWN_RESERVE_ID: '0.0.6103'
};

const seedEnv = (): SeedEnv => {
  const env = readSeedEnv(ENV);
  if (!env.ok) throw new Error(`fixture env is missing ${env.data.keys.join(', ')}`);
  return env.data;
};

// Behaves like Core's registry: checks each wallet signature against that wallet's key, answers
// 409 for a wallet it already has, and upserts agents by identity.
const fakeCore = () => {
  const receivers = new Map<string, unknown>();
  const agents = new Map<string, unknown>();
  let nonce = 0;
  const core: CoreHttp = async (method, path, body) => {
    if (method === 'GET' && path === '/v1/receivers/challenge') {
      nonce += 1;
      const hex = nonce.toString(16).padStart(32, '0');
      return { status: 200, body: { nonce: hex, expiresAt: '2026-11-06T10:40:00Z' } };
    }
    if (path === '/v1/receivers') {
      const parsed = receiverCreateSchema.parse(body);
      const [wallet] = parsed.wallets;
      if (!wallet) return { status: 400, body: { error: 'invalid_payload' } };
      const key = WALLET_KEYS[wallet.accountId as keyof typeof WALLET_KEYS];
      const message = new TextEncoder().encode(parsed.challengeNonce);
      if (!key.publicKey.verify(message, Buffer.from(wallet.signature, 'hex'))) {
        return { status: 400, body: { error: 'invalid_payload', message: 'bad proof' } };
      }
      if (receivers.has(wallet.accountId))
        return { status: 409, body: { error: 'invalid_payload' } };
      receivers.set(wallet.accountId, parsed);
      return { status: 201, body: { receiverId: `r_${receivers.size}` } };
    }
    const parsed = agentRegisterSchema.parse(body);
    const known = agents.has(parsed.identity);
    agents.set(parsed.identity, parsed);
    return { status: known ? 200 : 201, body: {} };
  };
  return { core, receivers, agents };
};

describe('seed --profiles', () => {
  it('names every missing env key without echoing values', () => {
    const { RECEIVER_IN_PRIVATE_KEY: _key, ...partial } = ENV;
    expect(readSeedEnv({ ...partial, CORE_URL: 'not a url' })).toEqual({
      ok: false,
      data: { keys: ['CORE_URL', 'RECEIVER_IN_PRIVATE_KEY'] }
    });
  });

  it('onboards the three receivers with wallet proofs, and is safe to run again', async () => {
    const { core, receivers } = fakeCore();
    expect(await seedReceivers(core, seedEnv())).toEqual([
      { name: 'receiver-in', result: 'created' },
      { name: 'receiver-in-solo', result: 'created' },
      { name: 'receiver-global', result: 'created' }
    ]);
    expect(receivers.get('0.0.5001')).toMatchObject({
      specifiedPerson: false,
      unverifiedPolicy: 'threshold_tolerant',
      apiKey: ENV.DEMO_API_IN_KEY
    });
    expect(receivers.get('0.0.5002')).toMatchObject({ specifiedPerson: true });
    expect(receivers.get('0.0.5002')).not.toHaveProperty('tan');
    expect(receivers.get('0.0.5003')).toMatchObject({ residency: 'non_resident' });

    const again = await seedReceivers(core, seedEnv());
    expect(again.map((outcome) => outcome.result)).toEqual(['exists', 'exists', 'exists']);
  });

  it('registers two Level 1 agents with issuer credentials and one Level 0 agent', async () => {
    const { core, agents } = fakeCore();
    expect(await seedAgents(core, seedEnv())).toEqual([
      { name: 'agent-resident', result: 'created' },
      { name: 'agent-nonresident', result: 'created' },
      { name: 'agent-unknown', result: 'created' }
    ]);

    const resident = agentRegisterSchema.parse(agents.get('hedera:testnet:0.0.6001'));
    expect(resident.reserveAccountId).toBe('0.0.6101');
    const credential = resident.credential;
    if (!credential) throw new Error('agent-resident has no credential');
    expect(verifyCredential(credential, ISSUER.publicKey)).toEqual({
      ok: true,
      data: { residency: 'resident', panOnFile: true, level: 1 }
    });
    const nonresident = agentRegisterSchema.parse(agents.get('hedera:testnet:0.0.6002'));
    expect(nonresident.credential?.claims).toEqual({
      residency: 'non_resident',
      panOnFile: false,
      level: 1
    });
    expect(agents.get('hedera:testnet:0.0.6003')).not.toHaveProperty('credential');

    const again = await seedAgents(core, seedEnv());
    expect(again.map((outcome) => outcome.result)).toEqual(['updated', 'updated', 'updated']);
  });

  it('stops with the refusal when Core rejects a profile', async () => {
    const refusing: CoreHttp = async (method) =>
      method === 'GET'
        ? { status: 200, body: { nonce: 'ab'.repeat(16), expiresAt: '2026-11-06T10:40:00Z' } }
        : { status: 400, body: { error: 'invalid_payload', message: 'challenge expired' } };
    await expect(seedReceivers(refusing, seedEnv())).rejects.toThrow(
      'receiver-in was refused: 400 invalid_payload challenge expired'
    );
  });

  describe('history and demo reset', () => {
    const NOW = new Date('2026-11-06T10:30:00Z');

    it('takes the calendar quarter before this one, in IST', () => {
      expect(previousQuarter(NOW)).toEqual({
        label: '2026-07',
        start: new Date('2026-06-30T18:30:00Z'),
        days: 92
      });
      expect(previousQuarter(new Date('2027-01-15T00:00:00Z')).label).toBe('2026-10');
    });

    it('builds the same keyed history every run, inside last quarter', () => {
      const history = sampleHistory(seedEnv(), NOW);
      expect(samplePaymentsRequestSchema.parse({ payments: history }).payments).toHaveLength(160);
      expect(new Set(history.map((row) => row.key)).size).toBe(160);
      expect(sampleHistory(seedEnv(), NOW)).toEqual(history);
      for (const row of history) {
        expect(row.at >= '2026-06-30T18:30:00.000Z' && row.at < '2026-09-30T18:30:00.000Z').toBe(
          true
        );
      }
    });

    it('posts the history and the reset to Core, and stops on a refusal', async () => {
      const calls: { path: string; body: unknown }[] = [];
      const core: CoreHttp = async (_method, path, body) => {
        calls.push({ path, body });
        return path === '/v1/admin/sample-payments'
          ? { status: 200, body: { inserted: 160, existing: 0 } }
          : { status: 400, body: { error: 'invalid_payload', message: 'not registered' } };
      };
      expect(await seedHistory(core, seedEnv(), NOW)).toEqual({ inserted: 160, existing: 0 });
      await expect(seedResetDemo(core, seedEnv())).rejects.toThrow(/demo reset was refused: 400/);
      expect(calls.map((call) => call.path)).toEqual([
        '/v1/admin/sample-payments',
        '/v1/admin/demo-reset'
      ]);
    });

    it('empties both demo pairs, clears every demo agent, and sends agent-unknown to Level 0', () => {
      const request = demoResetRequestSchema.parse(demoResetRequest(seedEnv()));
      expect(request.balances).toEqual([
        { agent: 'hedera:testnet:0.0.6001', receiverAccountId: '0.0.5001', valuePaise: '0' },
        { agent: 'hedera:testnet:0.0.6003', receiverAccountId: '0.0.5001', valuePaise: '0' }
      ]);
      expect(request.clearAgents).toHaveLength(3);
      expect(request.level0).toEqual(['hedera:testnet:0.0.6003']);
    });

    it('puts every demo receiver in first-rupee mode, the default since #73', () => {
      const request = demoResetRequestSchema.parse(demoResetRequest(seedEnv()));
      expect(request.receiverModes).toHaveLength(demoReceivers(seedEnv()).length);
      expect(request.receiverModes.every(({ mode }) => mode === 'first_rupee')).toBe(true);
      expect(demoReceivers(seedEnv()).every(({ mode }) => mode === 'first_rupee')).toBe(true);
    });
  });
});
