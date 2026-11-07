import { buildApp } from './app';
import type { DbHandle } from './db/client';
import {
  agent,
  agentWallet,
  aggregate,
  hcsOutbox,
  payment,
  quote,
  receiver,
  receiverWallet
} from './db/schema';
import { testDb } from './db/test-db';
import { demoRoutes } from './demo-routes';
import { demoFixedFx } from './fx';
import {
  addPayment,
  ADMIN,
  ADMIN_TOKEN,
  FY,
  type LedgerSeed,
  loadTestPack,
  NOW,
  seedParties
} from './ledger.fixture';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

const RESIDENT = 'hedera:testnet:0.0.6001';
const UNKNOWN = 'hedera:testnet:0.0.6003';
const RESET = {
  balances: [
    { agent: RESIDENT, receiverAccountId: '0.0.5001', valuePaise: '998000' },
    { agent: UNKNOWN, receiverAccountId: '0.0.5001', valuePaise: '498000' }
  ],
  clearAgents: [RESIDENT, UNKNOWN],
  level0: [UNKNOWN]
};

describe('POST /v1/admin/demo-reset', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let seed: LedgerSeed;

  const reset = (payload: object = RESET) =>
    app.inject({ method: 'POST', url: '/v1/admin/demo-reset', headers: ADMIN, payload });

  const totalOf = async (agentId: string, receiverId: string) => {
    const [row] = await handle.db
      .select({ value: aggregate.valuePaise, count: aggregate.paymentsCount })
      .from(aggregate)
      .where(and(eq(aggregate.agentID, agentId), eq(aggregate.receiverID, receiverId)));
    return row;
  };

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    const { agents, receivers } = seed;
    await handle.db.insert(agentWallet).values([
      { agentID: agents.resident, accountID: '0.0.6001' },
      { agentID: agents.unknown, accountID: '0.0.6003' }
    ]);
    await handle.db.insert(receiverWallet).values(
      [
        [receivers.in, '0.0.5001'],
        [receivers.solo, '0.0.5002']
      ].map(([receiverID = '', accountID = '']) => ({
        receiverID,
        accountID,
        proofSignature: 'ff',
        verifiedAt: NOW
      }))
    );
    // The last demo run: live payments (one with an unpublished HCS row), on top of sample history
    const live = await addPayment(handle.db, {
      receiverId: receivers.in,
      agentId: agents.resident,
      at: NOW
    });
    await handle.db
      .insert(hcsOutbox)
      .values({ kind: 'pay', topicID: '0.0.7001', payload: {}, paymentID: live });
    await addPayment(handle.db, {
      receiverId: receivers.in,
      agentId: agents.resident,
      at: new Date('2026-08-01T10:00:00Z'),
      inrValuePaise: 500_000n,
      sample: true
    });
    await addPayment(handle.db, {
      receiverId: receivers.solo,
      agentId: agents.resident,
      at: new Date('2026-08-01T10:00:00Z'),
      inrValuePaise: 300_000n,
      sample: true
    });
    await addPayment(handle.db, { receiverId: receivers.solo, agentId: agents.resident, at: NOW });
    await addPayment(handle.db, { receiverId: receivers.in, agentId: agents.unknown, at: NOW });
    await handle.db.insert(aggregate).values([
      { agentID: agents.resident, receiverID: receivers.solo, fy: FY, valuePaise: 1n },
      { agentID: agents.unknown, receiverID: receivers.in, fy: FY, valuePaise: 1n }
    ]);
    // A quote the demo opened but never paid, and an agent that verified on stage
    const [open] = await handle.db
      .select()
      .from(quote)
      .where(eq(quote.agentID, agents.resident))
      .limit(1);
    if (!open) throw new Error('no quote');
    await handle.db
      .insert(quote)
      .values({ ...open, id: 'q_openquote', usedTransactionID: null, createdAt: NOW });
    await handle.db
      .update(agent)
      .set({ level: 1, residency: 'resident', panOnFile: true, verifiedAt: NOW })
      .where(eq(agent.id, agents.unknown));

    const fx = demoFixedFx('88.40');
    if (!fx) throw new Error('fx');
    app = buildApp({
      logger: false,
      routes: [
        demoRoutes({
          db: handle.db,
          pack: await loadTestPack(),
          fx,
          adminToken: ADMIN_TOKEN,
          now: () => NOW
        })
      ]
    });
  });

  it('sets each demo pair to its opening balance as one sample payment', async () => {
    const response = await reset();
    expect(response.json()).toEqual({ clearedPayments: 3, balancedPairs: 2, level0Agents: 1 });

    const { agents, receivers } = seed;
    expect(await totalOf(agents.resident, receivers.in)).toEqual({ value: 998_000n, count: 1 });
    expect(await totalOf(agents.unknown, receivers.in)).toEqual({ value: 498_000n, count: 1 });
    const opening = await handle.db
      .select()
      .from(payment)
      .where(and(eq(payment.agentID, agents.resident), eq(payment.receiverID, receivers.in)));
    expect(opening).toMatchObject([{ inrValuePaise: 998_000n, sample: true, status: 'settled' }]);
  });

  it("clears the demo's own payments elsewhere and recounts, keeping sample history", async () => {
    await reset();
    expect(await totalOf(seed.agents.resident, seed.receivers.solo)).toEqual({
      value: 300_000n,
      count: 1
    });
    expect(await handle.db.select().from(hcsOutbox)).toEqual([]);
    expect(await handle.db.select().from(quote).where(eq(quote.id, 'q_openquote'))).toEqual([]);
  });

  it('sends the on-stage agent back to Level 0, unverified', async () => {
    await reset();
    const [row] = await handle.db.select().from(agent).where(eq(agent.id, seed.agents.unknown));
    expect(row).toMatchObject({
      level: 0,
      residency: 'unknown',
      panOnFile: false,
      verifiedAt: null
    });
  });

  it('gives the same result when run twice', async () => {
    await reset();
    const second = await reset();
    expect(second.json()).toMatchObject({ clearedPayments: 0 });
    expect(await totalOf(seed.agents.resident, seed.receivers.in)).toEqual({
      value: 998_000n,
      count: 1
    });
  });

  it('puts a receiver in the requested mode, and clears a pair set to zero with no opening', async () => {
    const response = await reset({
      ...RESET,
      balances: [{ agent: RESIDENT, receiverAccountId: '0.0.5001', valuePaise: '0' }],
      receiverModes: [{ receiverAccountId: '0.0.5001', mode: 'first_rupee' }]
    });
    expect(response.statusCode).toBe(200);
    const [row] = await handle.db.select().from(receiver).where(eq(receiver.id, seed.receivers.in));
    expect(row?.mode).toBe('first_rupee');
    expect(await totalOf(seed.agents.resident, seed.receivers.in)).toEqual({ value: 0n, count: 0 });
  });

  it('refuses a receiver wallet that is not registered', async () => {
    const response = await reset({
      ...RESET,
      receiverModes: [{ receiverAccountId: '0.0.9999', mode: 'first_rupee' }]
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses an agent that is not registered, changing nothing', async () => {
    const response = await reset({ ...RESET, level0: ['hedera:testnet:0.0.9999'] });
    expect(response.statusCode).toBe(400);
    const [row] = await handle.db.select().from(agent).where(eq(agent.id, seed.agents.unknown));
    expect(row?.level).toBe(1);
  });
});
