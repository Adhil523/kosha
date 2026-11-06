import type { DbHandle } from './client';
import { agent, aggregate, payment, quote, receiver } from './schema';
import { testDb } from './test-db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NEW_RECEIVER = {
  legalName: 'Demo GST Data Pvt Ltd',
  residency: 'resident',
  specifiedPerson: false,
  mode: 'threshold',
  unverifiedPolicy: 'threshold_tolerant',
  apiKeyHash: 'hash_receiver_in'
} as const;

const quoteFor = (receiverID: string, agentID: string, overrides = {}) => ({
  scheme: 'kosha_split' as const,
  receiverID,
  agentID,
  resource: 'https://api.demo-in.dev/v1/gst-lookup',
  payToAccountID: '0.0.5001',
  reserveAccountID: '0.0.6101',
  priceMicro: 100000n,
  tdsMicro: 1019n,
  totalMicro: 101019n,
  inrValuePaise: 884n,
  rateBps: 100,
  reason: 'threshold_crossed',
  rulepack: 'in-2026.2',
  inrPerUsdMicro: 88_400_000n,
  nodeAccountIDs: ['0.0.3', '0.0.4', '0.0.5'],
  fy: '2026-27',
  expiresAt: new Date('2026-11-06T10:32:00Z'),
  ...overrides
});

describe('schema on PGlite with the real migrations', () => {
  let handle: DbHandle;
  let receiverID: string;
  let agentID: string;

  beforeAll(async () => {
    handle = await testDb();
    const [createdReceiver] = await handle.db.insert(receiver).values(NEW_RECEIVER).returning();
    const [createdAgent] = await handle.db
      .insert(agent)
      .values({ identity: 'hedera:testnet:0.0.6001', level: 1, residency: 'resident' })
      .returning();
    receiverID = createdReceiver?.id ?? '';
    agentID = createdAgent?.id ?? '';
  });

  afterAll(async () => {
    await handle.close();
  });

  it('fills ids and timestamps from the schema defaults', async () => {
    const [row] = await handle.db.select().from(receiver).where(eq(receiver.id, receiverID));
    expect(row?.id).toMatch(/^[a-z0-9]{20,}$/);
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it('gives quotes a q_ id and keeps money exact beyond 2^53', async () => {
    const big = 2n ** 60n;
    const [created] = await handle.db
      .insert(quote)
      .values(
        quoteFor(receiverID, agentID, { priceMicro: big, tdsMicro: 1n, totalMicro: big + 1n })
      )
      .returning();
    expect(created?.id).toMatch(/^q_[a-z0-9]+$/);
    expect(created?.totalMicro).toBe(big + 1n);
  });

  it('refuses a quote whose total is not price plus TDS', async () => {
    await expect(
      handle.db.insert(quote).values(quoteFor(receiverID, agentID, { totalMicro: 101020n }))
    ).rejects.toThrow();
  });

  it('refuses an agent level outside 0–2', async () => {
    await expect(
      handle.db.insert(agent).values({ identity: 'hedera:testnet:0.0.6009', level: 3 })
    ).rejects.toThrow();
  });

  it('refuses a second payment with the same transaction id', async () => {
    const [first, second] = await handle.db
      .insert(quote)
      .values([quoteFor(receiverID, agentID), quoteFor(receiverID, agentID)])
      .returning();
    const paid = (quoteID: string) => ({
      quoteID,
      transactionID: '0.0.4000@1762424400.000000001',
      receiverID,
      agentID,
      priceMicro: 100000n,
      tdsMicro: 1019n,
      inrValuePaise: 884n,
      fy: '2026-27'
    });
    await handle.db.insert(payment).values(paid(first?.id ?? ''));
    await expect(handle.db.insert(payment).values(paid(second?.id ?? ''))).rejects.toThrow();
  });

  it('keeps one aggregate per pair and year, and adds to it', async () => {
    const key = { agentID, receiverID, fy: '2026-27' };
    await handle.db.insert(aggregate).values(key);
    await handle.db
      .update(aggregate)
      .set({
        valuePaise: sql`${aggregate.valuePaise} + 884`,
        paymentsCount: sql`${aggregate.paymentsCount} + 1`
      })
      .where(eq(aggregate.agentID, agentID));

    const [row] = await handle.db.select().from(aggregate);
    expect(row?.valuePaise).toBe(884n);
    expect(row?.paymentsCount).toBe(1);
    await expect(handle.db.insert(aggregate).values(key)).rejects.toThrow();
  });
});
