import type { DbHandle } from './db/client';
import {
  agentWallet,
  aggregate,
  hcsOutbox,
  outsidePayment,
  quote,
  receiverWallet,
  watcherCursor
} from './db/schema';
import { testDb } from './db/test-db';
import { createEventBus } from './event-bus';
import { demoFixedFx } from './fx';
import { addPayment, FY, type LedgerSeed, loadTestPack, NOW, seedParties } from './ledger.fixture';
import { fromMirrorTransactionId, type WatcherDeps, watchOutsidePayments } from './outside-watcher';
import type { MirrorClient, TokenCredit } from '@kosha/hedera/mirror';
import type { StreamEvent } from '@kosha/shared/console-api';
import { transactionIdSchema } from '@kosha/shared/ids';
import { toMirrorTransactionId } from '@kosha/shared/links';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const RECEIVER_WALLET = '0.0.5001';
// 1 USDC from agent-resident's wallet, straight to receiver-in, at 10:20 UTC on 6 Nov 2026
const DIRECT: TokenCredit = {
  transactionId: '0.0.6001-1793960400-000000001',
  consensusTimestamp: '1793960400.000000001',
  memo: 'thanks!',
  amount: 1_000_000n,
  from: ['0.0.6001']
};

describe('watchOutsidePayments', () => {
  let handle: DbHandle;
  let seed: LedgerSeed;
  let deps: WatcherDeps;
  let credits: TokenCredit[];
  let reads: string[];
  let events: StreamEvent[];
  let mirrorDown: boolean;

  const mirror: Pick<MirrorClient, 'tokenCreditsSince'> = {
    tokenCreditsSince: async (account, _token, cursor) => {
      reads.push(`${account}@${cursor}`);
      if (mirrorDown) return { ok: false, data: { reason: 'http_error', status: 503 } };
      return { ok: true, data: { credits, cursor: credits.at(-1)?.consensusTimestamp ?? cursor } };
    }
  };

  beforeEach(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    await handle.db
      .insert(agentWallet)
      .values({ agentID: seed.agents.resident, accountID: '0.0.6001' });
    await handle.db.insert(receiverWallet).values({
      receiverID: seed.receivers.in,
      accountID: RECEIVER_WALLET,
      proofSignature: 'ff',
      verifiedAt: NOW
    });
    // Watching since before the credit
    await handle.db
      .insert(watcherCursor)
      .values({ accountID: RECEIVER_WALLET, cursor: '1793960000.000000000' });
    const fx = demoFixedFx('88.40');
    if (!fx) throw new Error('fx');
    const bus = createEventBus();
    events = [];
    bus.subscribe(seed.receivers.in, (event) => events.push(event));
    credits = [DIRECT];
    reads = [];
    mirrorDown = false;
    deps = {
      db: handle.db,
      mirror,
      settlementTokenId: '0.0.429274',
      pack: await loadTestPack(),
      fx,
      bus,
      pairSecret: 'pair-secret',
      paymentsTopicId: '0.0.7100',
      now: () => NOW
    };
  });

  afterEach(async () => {
    await handle.close();
  });

  it('flags a direct payment from a payer wallet, counts it, logs it and tells the Console', async () => {
    expect(await watchOutsidePayments(deps)).toEqual({ flagged: 1, failed: 0 });

    const [row] = await handle.db.select().from(outsidePayment);
    expect(row).toMatchObject({
      agentID: seed.agents.resident,
      fromWallet: '0.0.6001',
      transactionID: '0.0.6001@1793960400.000000001',
      valuePaise: 8_840n,
      shortfallPaise: 0n,
      classification: 'pending'
    });
    const [total] = await handle.db.select().from(aggregate);
    expect(total).toMatchObject({ fy: FY, valuePaise: 0n, outsideValuePaise: 8_840n });
    const [message] = await handle.db.select().from(hcsOutbox);
    expect(message?.payload).toMatchObject({ t: 'outside', oid: row?.id, shortfall: '0' });
    expect(events).toMatchObject([
      { type: 'outside.payment', row: { id: row?.id, classification: 'pending' } }
    ]);
  });

  it('records the TDS it should have carried when it crosses the threshold', async () => {
    // ₹9,950 so far; ₹88.40 more crosses ₹10,000, so a Kosha payment would have withheld 1%
    await handle.db.insert(aggregate).values({
      agentID: seed.agents.resident,
      receiverID: seed.receivers.in,
      fy: FY,
      valuePaise: 995_000n
    });
    await watchOutsidePayments(deps);
    const [row] = await handle.db.select().from(outsidePayment);
    expect(row?.shortfallPaise).toBe(89n);
  });

  it("leaves Kosha's own settlements and strangers' transfers alone, even with a kosha: memo", async () => {
    const paid = await addPayment(handle.db, {
      receiverId: seed.receivers.in,
      agentId: seed.agents.resident,
      at: NOW
    });
    const [settled] = await handle.db.select().from(quote).limit(1);
    const ours = toMirrorTransactionId(transactionIdSchema.parse(settled?.usedTransactionID));
    credits = [
      { ...DIRECT, transactionId: ours, memo: `kosha:${settled?.id ?? ''}` },
      { ...DIRECT, transactionId: '0.0.9999-1793960401-000000002', from: ['0.0.9999'] }
    ];
    expect(paid).toBeTruthy();
    expect(await watchOutsidePayments(deps)).toEqual({ flagged: 0, failed: 0 });

    credits = [{ ...DIRECT, memo: 'kosha:q_fake' }];
    expect(await watchOutsidePayments(deps)).toEqual({ flagged: 1, failed: 0 });
  });

  it('moves the cursor on and never flags the same transaction twice', async () => {
    await watchOutsidePayments(deps);
    await watchOutsidePayments(deps);
    expect(reads.at(-1)).toBe(`${RECEIVER_WALLET}@1793960400.000000001`);
    expect(await handle.db.select().from(outsidePayment)).toHaveLength(1);
  });

  it("starts a new wallet's watch at the current time, and keeps the cursor when the Mirror is down", async () => {
    await handle.db.delete(watcherCursor);
    credits = [];
    await watchOutsidePayments(deps);
    expect(reads).toEqual([`${RECEIVER_WALLET}@1793961000.000000000`]);

    mirrorDown = true;
    expect(await watchOutsidePayments(deps)).toEqual({ flagged: 0, failed: 1 });
    const [cursor] = await handle.db
      .select()
      .from(watcherCursor)
      .where(eq(watcherCursor.accountID, RECEIVER_WALLET));
    expect(cursor?.cursor).toBe('1793961000.000000000');
  });

  it('converts Mirror Node transaction IDs to the form Core stores', () => {
    expect(fromMirrorTransactionId('0.0.6001-1793960400-000000001')).toBe(
      '0.0.6001@1793960400.000000001'
    );
  });
});
