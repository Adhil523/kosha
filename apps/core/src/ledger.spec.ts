import type { DbHandle } from './db/client';
import { aggregate, hcsOutbox, payment, quote } from './db/schema';
import { testDb } from './db/test-db';
import { pairId } from './hcs-messages';
import { type LedgerContext, recordSettlement, type SettlementOutcome } from './ledger';
import { QUOTE_ID, seedQuotedPayment } from './payment.fixture';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CONTEXT: LedgerContext = {
  pairSecret: 'pair-secret',
  rulepackHash: 'cd'.repeat(32),
  paymentsTopicId: '0.0.7100'
};
const TX = '0.0.4000@1794911400.000000000';

describe('recordSettlement', () => {
  let handle: DbHandle;
  let ids: { receiverId: string; agentId: string };

  beforeEach(async () => {
    handle = await testDb();
    ids = await seedQuotedPayment(handle.db);
  });

  afterEach(async () => {
    await handle.close();
  });

  const record = async (outcome: SettlementOutcome) => {
    const [row] = await handle.db.select().from(quote).where(eq(quote.id, QUOTE_ID));
    if (!row) throw new Error('fixture quote missing');
    return recordSettlement(handle.db, CONTEXT, row, TX, outcome);
  };
  const totals = () => handle.db.select().from(aggregate);
  const outbox = () => handle.db.select().from(hcsOutbox);

  it('records a settled payment, adds it to the pair, and queues the HCS message', async () => {
    const recorded = await record('settled');
    expect(recorded.aggregatePaise).toBe(884n);

    const [saved] = await handle.db.select().from(payment);
    expect(saved).toMatchObject({ id: recorded.paymentId, status: 'settled', transactionID: TX });
    expect(await totals()).toMatchObject([{ valuePaise: 884n, paymentsCount: 1 }]);
    const [queued] = await outbox();
    expect(queued).toMatchObject({
      kind: 'pay',
      topicID: '0.0.7100',
      paymentID: recorded.paymentId,
      hcsSequence: null
    });
    expect(queued?.payload).toMatchObject({
      t: 'pay',
      pid: recorded.paymentId,
      tx: TX,
      tds: '1019',
      agg: '884',
      pair: pairId(CONTEXT.pairSecret, ids.agentId, ids.receiverId)
    });
  });

  it('adds to the running total the decision saw', async () => {
    await handle.db.insert(aggregate).values({
      agentID: ids.agentId,
      receiverID: ids.receiverId,
      fy: '2026-27',
      valuePaise: 999_000n,
      outsideValuePaise: 500n,
      paymentsCount: 7
    });
    const recorded = await record('settled');
    expect(recorded.aggregatePaise).toBe(1_000_384n);
    expect(await totals()).toMatchObject([{ valuePaise: 999_884n, paymentsCount: 8 }]);
  });

  it('counts a pending payment toward the threshold but publishes nothing yet', async () => {
    await record('pending');
    expect(await totals()).toMatchObject([{ valuePaise: 884n }]);
    expect(await outbox()).toEqual([]);
  });

  it('records a failed payment without touching the total', async () => {
    await record('failed');
    const [saved] = await handle.db.select().from(payment);
    expect(saved?.status).toBe('failed');
    expect(await totals()).toEqual([]);
    expect(await outbox()).toEqual([]);
  });
});
