import type { KoshaDb } from './db/client';
import { hcsOutbox, payment } from './db/schema';
import { rulepackMessage } from './hcs-messages';
import type { HcsJson, Submitted } from '@kosha/hedera/hcs';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

// HCS writes go through an outbox (PROTOCOL design fix 6): settlement queues the message in its own
// database transaction, and this publisher submits queued rows until each one has a sequence number.

const BATCH_SIZE = 20;

export type OutboxDeps = {
  db: KoshaDb;
  submit: (topicId: string, message: HcsJson) => Promise<Submitted>;
};

export type PublishReport = { published: number; failed: number };

const describeFailure = (result: Extract<Submitted, { ok: false }>): string =>
  result.data.reason === 'too_large' ? `too_large:${result.data.bytes}` : result.data.status;

// Publishes queued rows, oldest first. A row that fails stays queued with its error, and the
// next pass tries it again. Later rows on the same topic wait for it, so each topic keeps the
// order its events happened in; other topics carry on.
export const publishQueued = async (deps: OutboxDeps): Promise<PublishReport> => {
  const queued = await deps.db
    .select()
    .from(hcsOutbox)
    .where(isNull(hcsOutbox.publishedAt))
    .orderBy(asc(hcsOutbox.createdAt))
    .limit(BATCH_SIZE);

  const report: PublishReport = { published: 0, failed: 0 };
  const held = new Set<string>();
  for (const row of queued) {
    if (held.has(row.topicID)) continue;
    try {
      const submitted = await deps.submit(row.topicID, row.payload);
      if (!submitted.ok) {
        report.failed += 1;
        held.add(row.topicID);
        await deps.db
          .update(hcsOutbox)
          .set({ attempts: row.attempts + 1, lastError: describeFailure(submitted) })
          .where(eq(hcsOutbox.id, row.id));
        continue;
      }
      await deps.db.transaction(async (tx) => {
        await tx
          .update(hcsOutbox)
          .set({
            attempts: row.attempts + 1,
            lastError: null,
            hcsSequence: submitted.data.sequence,
            publishedAt: new Date()
          })
          .where(eq(hcsOutbox.id, row.id));
        if (row.paymentID) {
          await tx
            .update(payment)
            .set({ hcsSequence: submitted.data.sequence })
            .where(eq(payment.id, row.paymentID));
        }
      });
      report.published += 1;
    } catch (error) {
      report.failed += 1;
      held.add(row.topicID);
      console.error(`[hcs-outbox]: publishing ${row.id} failed`, error);
    }
  }
  return report;
};

// Queues the active rule pack's full hash once, so every pay message's `rph` resolves on the topic
export const queueRulepackOnce = async (
  db: KoshaDb,
  topicId: string,
  rulepack: string,
  hash: string
): Promise<boolean> => {
  const [existing] = await db
    .select({ id: hcsOutbox.id })
    .from(hcsOutbox)
    .where(
      and(
        eq(hcsOutbox.kind, 'rulepack'),
        eq(hcsOutbox.topicID, topicId),
        sql`${hcsOutbox.payload}->>'hash' = ${hash}`
      )
    );
  if (existing) return false;
  await db
    .insert(hcsOutbox)
    .values({ kind: 'rulepack', topicID: topicId, payload: rulepackMessage(rulepack, hash) });
  return true;
};

export type OutboxLoopOptions = { intervalMs: number; maxIntervalMs: number };

export type StopLoop = () => Promise<void>;

// Runs a pass on a timer. After a pass with failures the wait doubles, up to the maximum, and
// drops back once a pass is clean. The stop function waits for a pass in flight, so a message
// submitted during shutdown is still recorded before the database closes.
export const startRetryLoop = (
  label: string,
  pass: () => Promise<{ failed: number }>,
  options: OutboxLoopOptions
): StopLoop => {
  let wait = options.intervalMs;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  const run = async () => {
    try {
      const report = await pass();
      wait = report.failed > 0 ? Math.min(wait * 2, options.maxIntervalMs) : options.intervalMs;
    } catch (error) {
      wait = Math.min(wait * 2, options.maxIntervalMs);
      console.error(`[${label}]: pass failed`, error);
    }
  };
  const tick = async () => {
    running = run();
    await running;
    if (!stopped) timer = setTimeout(() => void tick(), wait);
  };

  timer = setTimeout(() => void tick(), 0);
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
};

export const startOutboxLoop = (deps: OutboxDeps, options: OutboxLoopOptions): StopLoop =>
  startRetryLoop('hcs-outbox', () => publishQueued(deps), options);
