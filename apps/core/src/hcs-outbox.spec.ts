import type { DbHandle } from './db/client';
import { hcsOutbox, payment, quote } from './db/schema';
import { testDb } from './db/test-db';
import { publishQueued, queueRulepackOnce, startOutboxLoop } from './hcs-outbox';
import { recordSettlement } from './ledger';
import { QUOTE_ID, seedQuotedPayment } from './payment.fixture';
import type { HcsJson, Submitted } from '@kosha/hedera/hcs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TOPIC = '0.0.7100';
const TX = '0.0.4000@1794911400.000000000';

describe('HCS outbox', () => {
  let handle: DbHandle;
  let sent: { topicId: string; message: HcsJson }[];

  beforeEach(async () => {
    handle = await testDb();
    sent = [];
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
    async (topicId: string, message: HcsJson): Promise<Submitted> => {
      sent.push({ topicId, message });
      return results.shift() ?? { ok: true, data: { sequence: sent.length } };
    };

  it('publishes a queued pay message and stores its sequence on the payment', async () => {
    const report = await publishQueued({ db: handle.db, submit: submitting() });

    expect(report).toEqual({ published: 1, failed: 0 });
    expect(sent).toMatchObject([{ topicId: TOPIC, message: { t: 'pay', tx: TX } }]);
    expect(await handle.db.select().from(hcsOutbox)).toMatchObject([
      { hcsSequence: 1, attempts: 1, lastError: null }
    ]);
    expect(await handle.db.select().from(payment)).toMatchObject([{ hcsSequence: 1 }]);

    expect(await publishQueued({ db: handle.db, submit: submitting() })).toEqual({
      published: 0,
      failed: 0
    });
  });

  it('keeps a rejected message queued with its error, and publishes it on a later pass', async () => {
    const rejected: Submitted = { ok: false, data: { reason: 'rejected', status: 'BUSY' } };
    const first = await publishQueued({ db: handle.db, submit: submitting(rejected) });

    expect(first).toEqual({ published: 0, failed: 1 });
    expect(await handle.db.select().from(hcsOutbox)).toMatchObject([
      { attempts: 1, lastError: 'BUSY', publishedAt: null }
    ]);

    const second = await publishQueued({ db: handle.db, submit: submitting() });
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

    const first = await publishQueued({ db: handle.db, submit: submitting(rejected) });
    expect(first).toEqual({ published: 1, failed: 1 });
    expect(sent.map((entry) => entry.topicId)).toEqual([TOPIC, '0.0.7200']);

    sent = [];
    expect(await publishQueued({ db: handle.db, submit: submitting() })).toEqual({
      published: 2,
      failed: 0
    });
    expect(sent.map((entry) => entry.message)).toMatchObject([{ t: 'pay' }, { n: 2 }]);
  });

  it('queues the rule pack hash once', async () => {
    expect(await queueRulepackOnce(handle.db, TOPIC, 'in-2026.2', 'ab'.repeat(32))).toBe(true);
    expect(await queueRulepackOnce(handle.db, TOPIC, 'in-2026.2', 'ab'.repeat(32))).toBe(false);
    expect(await queueRulepackOnce(handle.db, TOPIC, 'in-2026.3', 'ef'.repeat(32))).toBe(true);

    const rows = await handle.db.select().from(hcsOutbox).where(eq(hcsOutbox.kind, 'rulepack'));
    expect(rows).toHaveLength(2);
  });

  it('runs on a timer until stopped', async () => {
    const stop = startOutboxLoop(
      { db: handle.db, submit: submitting() },
      { intervalMs: 5, maxIntervalMs: 20 }
    );
    await expect.poll(async () => (await handle.db.select().from(payment))[0]?.hcsSequence).toBe(1);
    await stop();
  });
});
