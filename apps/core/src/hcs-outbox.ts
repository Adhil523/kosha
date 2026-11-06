import type { KoshaDb } from './db/client';
import { hcsOutbox, payment } from './db/schema';
import { rulepackMessage } from './hcs-messages';
import type { PriorSubmission } from './hcs-submission-lookup';
import { UNKNOWN_EXECUTION_STATUS } from '@kosha/hedera/executor';
import { type HcsJson, NO_SEQUENCE_STATUS, type Submitted } from '@kosha/hedera/hcs';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

// HCS writes go through an outbox (PROTOCOL design fix 6): settlement queues the message in its own
// database transaction, and this publisher submits queued rows until each one has a sequence number.

const BATCH_SIZE = 20;

export type OutboxDeps = {
  db: KoshaDb;
  submit: (topicId: string, message: HcsJson, transactionId: string) => Promise<Submitted>;
  newTransactionId: () => string;
  lookup: (transactionId: string) => Promise<PriorSubmission>;
};

export type PublishReport = { published: number; failed: number };

type OutboxRow = typeof hcsOutbox.$inferSelect;
type RowOutcome = 'published' | 'held' | 'abandoned';

// While the Mirror Node can't say whether the last submission landed
const AWAITING_MIRROR = 'awaiting_mirror';

const describeFailure = (result: Extract<Submitted, { ok: false }>): string =>
  result.data.reason === 'too_large' ? `too_large:${result.data.bytes}` : result.data.status;

// Only these outcomes may have reached consensus; any other failure never posted the message
const mayHaveLanded = (result: Extract<Submitted, { ok: false }>): boolean =>
  result.data.reason === 'rejected' &&
  (result.data.status === UNKNOWN_EXECUTION_STATUS || result.data.status === NO_SEQUENCE_STATUS);

const recordPublished = async (db: KoshaDb, row: OutboxRow, sequence: number) => {
  await db.transaction(async (tx) => {
    await tx
      .update(hcsOutbox)
      .set({
        attempts: row.attempts + 1,
        lastError: null,
        hcsSequence: sequence,
        publishedAt: new Date()
      })
      .where(eq(hcsOutbox.id, row.id));
    if (row.paymentID) {
      await tx.update(payment).set({ hcsSequence: sequence }).where(eq(payment.id, row.paymentID));
    }
  });
};

// One row. A row with a stored transaction ID was submitted before with an unknown outcome, so the
// Mirror Node is asked first and the message is posted again only if that submission never landed.
const publishOne = async (deps: OutboxDeps, row: OutboxRow): Promise<RowOutcome> => {
  const prior: PriorSubmission = row.transactionID
    ? await deps.lookup(row.transactionID)
    : { state: 'absent' };
  if (prior.state === 'published') {
    await recordPublished(deps.db, row, prior.sequence);
    return 'published';
  }
  if (prior.state === 'unknown') {
    await deps.db
      .update(hcsOutbox)
      .set({ lastError: AWAITING_MIRROR })
      .where(eq(hcsOutbox.id, row.id));
    return 'held';
  }

  const transactionId = deps.newTransactionId();
  await deps.db
    .update(hcsOutbox)
    .set({ transactionID: transactionId })
    .where(eq(hcsOutbox.id, row.id));
  const submitted = await deps.submit(row.topicID, row.payload, transactionId);
  if (submitted.ok) {
    await recordPublished(deps.db, row, submitted.data.sequence);
    return 'published';
  }

  const lastError = describeFailure(submitted);
  const abandoned = submitted.data.reason === 'too_large';
  await deps.db
    .update(hcsOutbox)
    .set({
      attempts: row.attempts + 1,
      lastError,
      transactionID: mayHaveLanded(submitted) ? transactionId : null,
      abandonedAt: abandoned ? new Date() : null
    })
    .where(eq(hcsOutbox.id, row.id));
  if (!abandoned) return 'held';
  console.error(`[hcs-outbox]: ${row.id} can never be published (${lastError}); skipping it`);
  return 'abandoned';
};

// Publishes queued rows, oldest first. A row that fails stays queued with its error, and the
// next pass tries it again. Later rows on the same topic wait for it, so each topic keeps the
// order its events happened in; other topics carry on.
export const publishQueued = async (deps: OutboxDeps): Promise<PublishReport> => {
  const queued = await deps.db
    .select()
    .from(hcsOutbox)
    .where(and(isNull(hcsOutbox.publishedAt), isNull(hcsOutbox.abandonedAt)))
    .orderBy(asc(hcsOutbox.createdAt))
    .limit(BATCH_SIZE);

  const report: PublishReport = { published: 0, failed: 0 };
  const held = new Set<string>();
  for (const row of queued) {
    if (held.has(row.topicID)) continue;
    try {
      const outcome = await publishOne(deps, row);
      if (outcome === 'published') {
        report.published += 1;
        continue;
      }
      report.failed += 1;
      if (outcome === 'held') held.add(row.topicID);
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
