import { FORWARD_EXPIRY_MS, forwardDue, type ForwarderDeps } from './compat-forwarder';
import type { DbHandle } from './db/client';
import { payment, quote } from './db/schema';
import { testDb } from './db/test-db';
import { addPayment, type LedgerSeed, NOW, seedParties } from './ledger.fixture';
import { type Transaction, TransferTransaction } from '@hiero-ledger/sdk';
import { type Executed, UNKNOWN_EXECUTION_STATUS } from '@kosha/hedera/executor';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SETTLED: Executed = {
  ok: true,
  data: { topicSequenceNumber: null, accountId: null, scheduleId: null }
};
const TIMED_OUT: Executed = {
  ok: false,
  data: { status: UNKNOWN_EXECUTION_STATUS, receipt: null }
};
const REFUSED: Executed = {
  ok: false,
  data: { status: 'INSUFFICIENT_TOKEN_BALANCE', receipt: null }
};

const legsOf = (transaction: Transaction | undefined) =>
  transaction instanceof TransferTransaction
    ? [...transaction.tokenTransfers]
        .flatMap(([, moves]) =>
          [...moves].map(([account, amount]) => [account.toString(), amount.toString()])
        )
        .sort()
    : [];

describe('forwardDue', () => {
  let handle: DbHandle;
  let seed: LedgerSeed;
  let executed: Transaction[];
  let outcomes: Executed[];
  let mirror: 'settled' | 'failed' | 'unknown';
  let clock: Date;

  const deps = (): ForwarderDeps => ({
    db: handle.db,
    execute: async (transaction) => {
      executed.push(transaction);
      return outcomes.shift() ?? SETTLED;
    },
    reconcile: async () => mirror,
    coreAccountId: '0.0.4000',
    compatSettlementAccountId: '0.0.4200',
    poolReserveAccountId: '0.0.4300',
    settlementTokenId: '0.0.429274',
    maxTransactionFeeHbar: '2',
    now: () => clock
  });
  const stored = async (paymentId: string) =>
    (await handle.db.select().from(payment).where(eq(payment.id, paymentId)))[0];

  // A compatibility payment: 0.10 USDC for receiver-in's wallet 0.0.5001, 1019 of TDS
  const compatPayment = async (fields: { sample?: boolean } = {}) => {
    const paymentId = await addPayment(handle.db, {
      receiverId: seed.receivers.in,
      agentId: seed.agents.resident,
      at: NOW,
      tdsMicro: 1_019n,
      ...fields
    });
    const [row] = await handle.db.select().from(payment).where(eq(payment.id, paymentId));
    await handle.db
      .update(quote)
      .set({ scheme: 'exact_compat' })
      .where(eq(quote.id, row?.quoteID ?? ''));
    return paymentId;
  };

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    executed = [];
    outcomes = [];
    mirror = 'unknown';
    clock = NOW;
  });

  afterEach(async () => {
    await handle.close();
  });

  it('forwards the price to the API and the TDS to the pooled reserve, once', async () => {
    const paymentId = await compatPayment();
    expect(await forwardDue(deps())).toEqual({ forwarded: 1, failed: 0 });

    const [forward] = executed;
    expect(legsOf(forward)).toEqual([
      ['0.0.4200', '-101019'],
      ['0.0.4300', '1019'],
      ['0.0.5001', '100000']
    ]);
    expect(forward?.transactionId?.accountId?.toString()).toBe('0.0.4000');
    expect(forward?.transactionMemo).toMatch(/^kosha-fwd:q_/);
    expect(await stored(paymentId)).toMatchObject({
      forwardTransactionID: forward?.transactionId?.toString(),
      forwardedAt: NOW
    });

    expect(await forwardDue(deps())).toEqual({ forwarded: 0, failed: 0 });
    expect(executed).toHaveLength(1);
  });

  it('leaves kosha-split payments and sample history alone', async () => {
    await addPayment(handle.db, {
      receiverId: seed.receivers.in,
      agentId: seed.agents.resident,
      at: NOW
    });
    await compatPayment({ sample: true });
    expect(await forwardDue(deps())).toEqual({ forwarded: 0, failed: 0 });
  });

  it('resolves a timed-out forward through the Mirror Node instead of sending it again', async () => {
    const paymentId = await compatPayment();
    outcomes = [TIMED_OUT];
    await forwardDue(deps());
    const attempt = (await stored(paymentId))?.forwardTransactionID;
    expect(attempt).toBeTruthy();

    mirror = 'settled';
    expect(await forwardDue(deps())).toEqual({ forwarded: 1, failed: 0 });
    expect(executed).toHaveLength(1);
    expect(await stored(paymentId)).toMatchObject({
      forwardTransactionID: attempt,
      forwardedAt: NOW
    });
  });

  it('retries with a new transaction after a refusal or an attempt that expired unseen', async () => {
    const paymentId = await compatPayment();
    outcomes = [REFUSED];
    await forwardDue(deps());
    expect((await stored(paymentId))?.forwardTransactionID).toBeNull();

    outcomes = [TIMED_OUT];
    await forwardDue(deps());
    clock = new Date(NOW.getTime() + FORWARD_EXPIRY_MS + 1);
    await forwardDue(deps());
    expect((await stored(paymentId))?.forwardTransactionID).toBeNull();

    await forwardDue(deps());
    expect(executed).toHaveLength(3);
    expect(new Set(executed.map((tx) => tx.transactionId?.toString())).size).toBe(3);
    expect((await stored(paymentId))?.forwardedAt).toEqual(clock);
  });
});
