import type { DbHandle } from './db/client';
import { hcsOutbox, payment, quote } from './db/schema';
import { testDb } from './db/test-db';
import { type OutboxDeps, publishQueued, queueRulepackOnce, startOutboxLoop } from './hcs-outbox';
import type { PriorSubmission } from './hcs-submission-lookup';
import { recordSettlement } from './ledger';
import { QUOTE_ID, seedQuotedPayment } from './payment.fixture';
import { UNKNOWN_EXECUTION_STATUS } from '@kosha/hedera/executor';
import type { HcsJson, Submitted } from '@kosha/hedera/hcs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TOPIC = '0.0.7100';
const TX = '0.0.4000@1794911400.000000000';

describe('HCS outbox', () => {
  let handle: DbHandle;
  let sent: { topicId: string; message: HcsJson; transactionId: string }[];
  let issued: number;

  beforeEach(async () => {
    handle = await testDb();
    sent = [];
    issued = 0;
    await seedQuotedPayment(handle.db);
    const [row] = await handle.db.select().from(quote).where(eq(quote.id, QUOTE_ID));
    if (!row) throw new Error('fixture quote missing');
    const ledger = { pairSecret: 's', rulepackHash: 'cd'.repeat(32), paymentsTopicId: TOPIC };
    await recordSettlement(handle.db, ledger, row, TX, 'settled');
  });

  afterEach(async () => {
    await handle.close();
  });

  const submitting =
    (...results: Submitted[]) =>
    async (topicId: string, message: HcsJson, transactionId: string): Promise<Submitted> => {
      sent.push({ topicId, message, transactionId });
      return results.shift() ?? { ok: true, data: { sequence: sent.length } };
    };

  const outbox = (
    submit: OutboxDeps['submit'],
    lookup: (transactionId: string) => Promise<PriorSubmission> = async () => ({ state: 'absent' })
  ): OutboxDeps => ({
    db: handle.db,
    submit,
    newTransactionId: () => `0.0.4000@1794911400.00000000${(issued += 1)}`,
    lookup
  });

  it('publishes a queued pay message and stores its sequence on the payment', async () => {
    const report = await publishQueued(outbox(submitting()));

    expect(report).toEqual({ published: 1, failed: 0 });
    expect(sent).toMatchObject([{ topicId: TOPIC, message: { t: 'pay', tx: TX } }]);
    expect(await handle.db.select().from(hcsOutbox)).toMatchObject([
      { hcsSequence: 1, attempts: 1, lastError: null }
    ]);
    expect(await handle.db.select().from(payment)).toMatchObject([{ hcsSequence: 1 }]);

    expect(await publishQueued(outbox(submitting()))).toEqual({
      published: 0,
      failed: 0
    });
  });

  it('keeps a rejected message queued with its error, and publishes it on a later pass', async () => {
    const rejected: Submitted = { ok: false, data: { reason: 'rejected', status: 'BUSY' } };
    const first = await publishQueued(outbox(submitting(rejected)));

    expect(first).toEqual({ published: 0, failed: 1 });
    expect(await handle.db.select().from(hcsOutbox)).toMatchObject([
      { attempts: 1, lastError: 'BUSY', publishedAt: null }
    ]);

    const second = await publishQueued(outbox(submitting()));
    expect(second).toEqual({ published: 1, failed: 0 });
  });

  it('holds later messages on a topic behind a failed one, so the topic keeps its order', async () => {
    await handle.db
      .insert(hcsOutbox)
      .values({ kind: 'rulepack', topicID: TOPIC, payload: { t: 'rulepack', n: 2 } });
    await handle.db
      .insert(hcsOutbox)
      .values({ kind: 'rulepack', topicID: '0.0.7200', payload: { t: 'rulepack', n: 3 } });
    const rejected: Submitted = { ok: false, data: { reason: 'rejected', status: 'BUSY' } };

    const first = await publishQueued(outbox(submitting(rejected)));
    expect(first).toEqual({ published: 1, failed: 1 });
    expect(sent.map((entry) => entry.topicId)).toEqual([TOPIC, '0.0.7200']);

    sent = [];
    expect(await publishQueued(outbox(submitting()))).toEqual({
      published: 2,
      failed: 0
    });
    expect(sent.map((entry) => entry.message)).toMatchObject([{ t: 'pay' }, { n: 2 }]);
  });

  it('asks the Mirror Node before posting again after an unknown outcome, so it never posts twice', async () => {
    const unknown: Submitted = {
      ok: false,
      data: { reason: 'rejected', status: UNKNOWN_EXECUTION_STATUS }
    };
    await publishQueued(outbox(submitting(unknown)));
    const [pending] = await handle.db.select().from(hcsOutbox);
    expect(pending?.transactionID).toBe('0.0.4000@1794911400.000000001');

    const waiting = await publishQueued(outbox(submitting(), async () => ({ state: 'unknown' })));
    expect(waiting).toEqual({ published: 0, failed: 1 });
    expect(sent).toHaveLength(1);

    const asked: string[] = [];
    const found = await publishQueued(
      outbox(submitting(), async (transactionId) => {
        asked.push(transactionId);
        return { state: 'published', sequence: 9 };
      })
    );
    expect(found).toEqual({ published: 1, failed: 0 });
    expect(asked).toEqual(['0.0.4000@1794911400.000000001']);
    expect(sent).toHaveLength(1);
    expect(await handle.db.select().from(payment)).toMatchObject([{ hcsSequence: 9 }]);
  });

  it('posts again under a new transaction ID once the earlier one is known not to have landed', async () => {
    const busy: Submitted = { ok: false, data: { reason: 'rejected', status: 'BUSY' } };
    await publishQueued(outbox(submitting(busy)));
    const [cleared] = await handle.db.select().from(hcsOutbox);
    expect(cleared?.transactionID).toBeNull();

    await publishQueued(outbox(submitting()));
    expect(sent.map((entry) => entry.transactionId)).toEqual([
      '0.0.4000@1794911400.000000001',
      '0.0.4000@1794911400.000000002'
    ]);
  });

  it('sets aside a message too large to publish, so it never blocks the queue', async () => {
    const tooLarge: Submitted = { ok: false, data: { reason: 'too_large', bytes: 2048 } };
    expect(await publishQueued(outbox(submitting(tooLarge)))).toEqual({ published: 0, failed: 1 });
    expect(await handle.db.select().from(hcsOutbox)).toMatchObject([
      { lastError: 'too_large:2048', publishedAt: null }
    ]);
    const [row] = await handle.db.select().from(hcsOutbox);
    expect(row?.abandonedAt).toBeInstanceOf(Date);

    expect(await publishQueued(outbox(submitting()))).toEqual({ published: 0, failed: 0 });
  });

  it('queues the rule pack hash once', async () => {
    expect(await queueRulepackOnce(handle.db, TOPIC, 'in-2026.2', 'ab'.repeat(32))).toBe(true);
    expect(await queueRulepackOnce(handle.db, TOPIC, 'in-2026.2', 'ab'.repeat(32))).toBe(false);
    expect(await queueRulepackOnce(handle.db, TOPIC, 'in-2026.3', 'ef'.repeat(32))).toBe(true);

    const rows = await handle.db.select().from(hcsOutbox).where(eq(hcsOutbox.kind, 'rulepack'));
    expect(rows).toHaveLength(2);
  });

  it('runs on a timer until stopped', async () => {
    const stop = startOutboxLoop(outbox(submitting()), { intervalMs: 5, maxIntervalMs: 20 });
    await expect.poll(async () => (await handle.db.select().from(payment))[0]?.hcsSequence).toBe(1);
    await stop();
  });
});
