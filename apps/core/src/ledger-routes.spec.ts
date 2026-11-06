import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { testDb } from './db/test-db';
import {
  addPayment,
  ADMIN,
  ADMIN_TOKEN,
  type LedgerSeed,
  loadTestPack,
  NOW,
  receiverAuth,
  seedParties
} from './ledger.fixture';
import { ledgerRoutes } from './ledger-routes';
import { type LedgerPage, ledgerPageSchema } from '@kosha/shared/console-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe('GET /v1/ledger', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let seed: LedgerSeed;
  const paymentIds: string[] = [];

  const ledger = async (query: string, headers: Record<string, string> = ADMIN) => {
    const response = await app.inject({ method: 'GET', url: `/v1/ledger?${query}`, headers });
    return { status: response.statusCode, body: response.json() as LedgerPage };
  };

  beforeAll(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    const { receivers, agents } = seed;
    // Oldest first: four settled payments to receiver-in, two of them in the same instant
    for (const at of [minutesAgo(30), minutesAgo(20), minutesAgo(10), minutesAgo(10)]) {
      paymentIds.push(
        await addPayment(handle.db, { receiverId: receivers.in, agentId: agents.resident, at })
      );
    }
    await addPayment(handle.db, {
      receiverId: receivers.in,
      agentId: agents.unknown,
      at: minutesAgo(5),
      tdsMicro: 22_624n,
      rateBps: 2000,
      reason: 'tolerance_exceeded',
      sample: true
    });
    for (const status of ['pending', 'failed'] as const) {
      await addPayment(handle.db, {
        receiverId: receivers.in,
        agentId: agents.resident,
        at: minutesAgo(1),
        status
      });
    }
    await addPayment(handle.db, {
      receiverId: receivers.solo,
      agentId: agents.resident,
      at: minutesAgo(2),
      reason: 'non_resident'
    });
    app = buildApp({
      logger: false,
      routes: [
        ledgerRoutes({
          db: handle.db,
          adminToken: ADMIN_TOKEN,
          network: 'testnet',
          pack: await loadTestPack()
        })
      ]
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it("lists a receiver's settled payments newest first, in the Console's shape", async () => {
    const { status, body } = await ledger(`receiverId=${seed.receivers.in}`);
    expect(status).toBe(200);
    expect(ledgerPageSchema.parse(body)).toEqual(body);
    expect(body.rows).toHaveLength(5);
    expect(body.nextCursor).toBeNull();
    const [newest] = body.rows;
    expect(newest).toMatchObject({
      agentId: seed.agents.unknown,
      agentLabel: 'hedera:testnet:0.0.6003',
      mode: 'kosha_split',
      tdsMicro: '22624',
      rateBps: 2000,
      reason: 'tolerance_exceeded',
      flags: [],
      reserveAccountId: '0.0.6101',
      sample: true
    });
    expect(body.rows[1]?.sample).toBe(false);
    expect(newest?.hashscanUrl).toMatch(/^https:\/\/hashscan\.io\/testnet\/transaction\//);
    expect(body.rows[1]?.agentLabel).toBe('agent-resident');
  });

  it('pages with a cursor without skipping or repeating rows that share an instant', async () => {
    const first = await ledger(`receiverId=${seed.receivers.in}&limit=2`);
    const cursor = first.body.nextCursor ?? '';
    expect(cursor).not.toBe('');
    const second = await ledger(`receiverId=${seed.receivers.in}&limit=2&cursor=${cursor}`);
    const third = await ledger(
      `receiverId=${seed.receivers.in}&limit=2&cursor=${second.body.nextCursor ?? ''}`
    );
    expect(third.body.nextCursor).toBeNull();

    const seen = [...first.body.rows, ...second.body.rows, ...third.body.rows];
    expect(seen.map((row) => row.paymentId).sort()).toEqual(
      (await ledger(`receiverId=${seed.receivers.in}`)).body.rows.map((row) => row.paymentId).sort()
    );
  });

  it('filters by agent and by time', async () => {
    const byAgent = await ledger(`agentId=${seed.agents.unknown}`);
    expect(byAgent.body.rows).toHaveLength(1);

    const from = minutesAgo(15).toISOString();
    const to = minutesAgo(6).toISOString();
    const window = await ledger(`receiverId=${seed.receivers.in}&from=${from}&to=${to}`);
    expect(window.body.rows).toHaveLength(2);
  });

  it('flags a payment with a non-resident side for FEMA review', async () => {
    const { body } = await ledger(`receiverId=${seed.receivers.solo}`);
    expect(body.rows[0]?.flags).toEqual(['fema_review']);
  });

  it("scopes a receiver key to the receiver's own rows", async () => {
    const own = await ledger('', receiverAuth('solo'));
    expect(own.body.rows.map((row) => row.receiverId)).toEqual([seed.receivers.solo]);

    const other = await ledger(`receiverId=${seed.receivers.in}`, receiverAuth('solo'));
    expect(other.status).toBe(403);
  });

  it('refuses a missing secret and a forged cursor', async () => {
    expect((await ledger('', {})).status).toBe(401);
    expect((await ledger('cursor=bm90LWEtY3Vyc29y')).status).toBe(400);
  });
});
