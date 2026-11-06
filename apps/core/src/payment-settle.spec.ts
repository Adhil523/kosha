import type { DbHandle } from './db/client';
import { aggregate, hcsOutbox, payment, quote } from './db/schema';
import { testDb } from './db/test-db';
import { pairTotalPaise } from './pair-total';
import { ISSUED_AT, payloadFor, QUOTE_ID, seedQuotedPayment, verifyDeps } from './payment.fixture';
import { type SettleDeps, settlePayment } from './payment-settle';
import { type Executed, UNKNOWN_EXECUTION_STATUS } from '@kosha/hedera/executor';
import { signedVariant } from '@kosha/hedera/transfer-verifier.fixture';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RECEIPT = { topicSequenceNumber: null, accountId: null, scheduleId: null };
const SETTLED: Executed = { ok: true, data: RECEIPT };
const TIMED_OUT: Executed = {
  ok: false,
  data: { status: UNKNOWN_EXECUTION_STATUS, receipt: null }
};

describe('settlePayment', () => {
  let handle: DbHandle;
  let receiverId: string;
  let executions: number;

  beforeEach(async () => {
    handle = await testDb();
    ({ receiverId } = await seedQuotedPayment(handle.db));
    executions = 0;
  });

  afterEach(async () => {
    await handle.close();
  });

  const depsWith = (
    executed: Executed,
    mirror: Awaited<ReturnType<SettleDeps['reconcile']>> = 'unknown'
  ): SettleDeps => ({
    ...verifyDeps(handle.db),
    ledger: {
      pairSecret: 'pair-secret',
      rulepackHash: 'cd'.repeat(32),
      paymentsTopicId: '0.0.7100'
    },
    execute: async () => {
      executions += 1;
      return executed;
    },
    reconcile: async () => mirror
  });
  const settle = async (deps: SettleDeps, transaction?: string) =>
    settlePayment(deps, receiverId, payloadFor(transaction ?? (await signedVariant())));
  const storedQuote = async () =>
    (await handle.db.select().from(quote).where(eq(quote.id, QUOTE_ID)))[0];

  // A quote issued mid-settlement must still see this payment, or it could under-deduct
  it('keeps the payment in its pair total while it executes', async () => {
    const row = await storedQuote();
    const pair = { agentId: row?.agentID ?? '', receiverId, fy: row?.fy ?? '' };
    const before = await pairTotalPaise(handle.db, pair, ISSUED_AT);
    let during = 0n;
    const deps: SettleDeps = {
      ...depsWith(SETTLED),
      execute: async () => {
        during = await pairTotalPaise(handle.db, pair, ISSUED_AT);
        return SETTLED;
      }
    };

    await settle(deps);

    expect(before).toBeGreaterThan(0n);
    expect([during, await pairTotalPaise(handle.db, pair, ISSUED_AT)]).toEqual([before, before]);
  });

  it('marks the quote used, executes once and records the payment', async () => {
    const result = await settle(depsWith(SETTLED));

    expect(result.ok && result.data.payer).toBe('0.0.6001');
    expect(executions).toBe(1);
    expect((await storedQuote())?.usedTransactionID).toBe(result.ok && result.data.transactionId);
    expect(await handle.db.select().from(payment)).toMatchObject([{ status: 'settled' }]);
    expect(await handle.db.select().from(hcsOutbox)).toHaveLength(1);
  });

  it('refuses to settle the same payment twice, even concurrently', async () => {
    const signed = await signedVariant();
    const deps = depsWith(SETTLED);
    const results = await Promise.all([settle(deps, signed), settle(deps, signed)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ data: { code: 'replay' } });
    expect(executions).toBe(1);

    const retry = await settle(deps, signed);
    expect(retry).toMatchObject({ ok: false, data: { code: 'replay' } });
    expect(executions).toBe(1);
  });

  it('records a rejected settlement as failed and keeps the quote used', async () => {
    const rejected: Executed = {
      ok: false,
      data: { status: 'INSUFFICIENT_TOKEN_BALANCE', receipt: null }
    };
    const result = await settle(depsWith(rejected));

    expect(result).toMatchObject({
      ok: false,
      data: { code: 'settlement_failed', status: 'INSUFFICIENT_TOKEN_BALANCE' }
    });
    expect((await storedQuote())?.usedTransactionID).not.toBeNull();
    expect(await handle.db.select().from(payment)).toMatchObject([{ status: 'failed' }]);
    expect(await handle.db.select().from(aggregate)).toEqual([]);
  });

  it('resolves a receipt timeout through the Mirror Node, never by resubmitting', async () => {
    const confirmed = await settle(depsWith(TIMED_OUT, 'settled'));
    expect(confirmed.ok).toBe(true);
    expect(executions).toBe(1);
  });

  it('keeps an unconfirmed settlement pending and counted', async () => {
    const result = await settle(depsWith(TIMED_OUT, 'unknown'));

    expect(result).toMatchObject({ ok: false, data: { code: 'settlement_pending' } });
    expect(await handle.db.select().from(payment)).toMatchObject([{ status: 'pending' }]);
    expect(await handle.db.select().from(aggregate)).toMatchObject([{ valuePaise: 884n }]);
    expect(await handle.db.select().from(hcsOutbox)).toEqual([]);
  });

  it('executes nothing when verification fails', async () => {
    const legs: [string, bigint][] = [
      ['0.0.6001', -101_019n],
      ['0.0.5001', 101_019n]
    ];
    const result = await settle(depsWith(SETTLED), await signedVariant({ legs }));

    expect(result).toMatchObject({ ok: false, data: { code: 'transfer_count' } });
    expect(executions).toBe(0);
    expect((await storedQuote())?.usedTransactionID).toBeNull();
  });
});
