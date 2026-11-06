import type { KoshaDb } from './db/client';
import {
  agent,
  agentWallet,
  hcsOutbox,
  outsidePayment,
  quote,
  receiver,
  receiverWallet,
  watcherCursor
} from './db/schema';
import type { EventBus } from './event-bus';
import type { FxSource } from './fx';
import { HCS_MESSAGE_VERSION, pairId } from './hcs-messages';
import { addOutsideToAggregate } from './ledger';
import { pairTotalPaise, withPairLock } from './pair-total';
import type { HcsJson } from '@kosha/hedera/hcs';
import type { MirrorClient, TokenCredit } from '@kosha/hedera/mirror';
import { type OutsidePaymentRow, outsidePaymentRowSchema } from '@kosha/shared/console-api';
import { decide } from '@kosha/tax-engine/decide';
import { financialYear } from '@kosha/tax-engine/ist-calendar';
import { microUsdcToPaise } from '@kosha/tax-engine/minor-units';
import type { RulePack } from '@kosha/tax-engine/rule-pack';
import { and, eq, inArray, sql } from 'drizzle-orm';

// The outside-payment watcher (A19): payers can still pay an API directly, outside Kosha. Each
// receiver wallet's token credits are read from the Mirror Node; a credit from a declared payer
// wallet that Core did not settle is flagged. Core never withholds on it: it counts the value
// toward the pair, records the TDS it should have carried as a shortfall, tells the Console and
// logs it to HCS. The owner then classifies it.

export type WatcherDeps = {
  db: KoshaDb;
  mirror: Pick<MirrorClient, 'tokenCreditsSince'>;
  settlementTokenId: string;
  pack: RulePack;
  fx: FxSource;
  bus: EventBus;
  pairSecret: string;
  paymentsTopicId: string;
  now?: () => Date;
};

export type WatchReport = { flagged: number; failed: number };

type OutsideRow = typeof outsidePayment.$inferSelect;

// "0.0.4000-1762425000-123456789" (Mirror Node) → "0.0.4000@1762425000.123456789" (SDK, Core)
export const fromMirrorTransactionId = (mirrorId: string): string => {
  const [payer = '', seconds = '', nanos = ''] = mirrorId.split('-');
  return `${payer}@${seconds}.${nanos}`;
};

// A wallet seen for the first time is watched from now on: its earlier history is not flagged
const cursorFromDate = (date: Date): string => `${Math.floor(date.getTime() / 1000)}.000000000`;
const consensusDate = (timestamp: string): Date =>
  new Date(Number(timestamp.split('.')[0] ?? '0') * 1000);

export const toOutsideRow = (row: OutsideRow, hcsSequence: number | null): OutsidePaymentRow =>
  outsidePaymentRowSchema.parse({
    id: row.id,
    receiverId: row.receiverID,
    fromWallet: row.fromWallet,
    transactionId: row.transactionID,
    seenAt: row.consensusAt.toISOString(),
    valuePaise: row.valuePaise.toString(),
    shortfallPaise: row.shortfallPaise.toString(),
    classification: row.classification,
    note: row.note,
    hcsSequence
  });

export const outsideMessage = (
  kind: 'outside' | 'outside_resolved',
  row: OutsideRow,
  pair: string
): HcsJson => ({
  v: HCS_MESSAGE_VERSION,
  t: kind,
  oid: row.id,
  tx: row.transactionID,
  pair,
  fy: row.fy,
  value: row.valuePaise.toString(),
  ...(kind === 'outside'
    ? { shortfall: row.shortfallPaise.toString() }
    : { cls: row.classification })
});

// The declared payer wallet among the credit's senders, and its agent
const payingAgent = async (db: KoshaDb, senders: string[]) => {
  if (senders.length === 0) return null;
  const [owner] = await db
    .select({ wallet: agentWallet.accountID, agent })
    .from(agentWallet)
    .innerJoin(agent, eq(agent.id, agentWallet.agentID))
    .where(inArray(agentWallet.accountID, senders));
  return owner ?? null;
};

// Core's own settlements: a quote claims its transaction before it executes, so a payment still in
// flight is recognised too. The memo is not trusted, because anyone can write `kosha:` in one.
const settledByKosha = async (db: KoshaDb, transactionId: string): Promise<boolean> => {
  const [claimed] = await db
    .select({ id: quote.id })
    .from(quote)
    .where(eq(quote.usedTransactionID, transactionId));
  return Boolean(claimed);
};

const flag = async (
  deps: WatcherDeps,
  receiverRow: typeof receiver.$inferSelect,
  toWallet: string,
  credit: TokenCredit,
  rate: bigint
): Promise<OutsideRow | null> => {
  const transactionId = fromMirrorTransactionId(credit.transactionId);
  if (await settledByKosha(deps.db, transactionId)) return null;
  const payer = await payingAgent(deps.db, credit.from);
  if (!payer) return null;

  const now = deps.now?.() ?? new Date();
  const consensusAt = consensusDate(credit.consensusTimestamp);
  const pair = {
    agentId: payer.agent.id,
    receiverId: receiverRow.id,
    fy: financialYear(consensusAt, deps.pack.financialYearStart)
  };
  return withPairLock(deps.db, pair, async (tx) => {
    // What a Kosha payment of this size would have withheld, against the pair's total so far
    const missed = decide({
      payer: { residency: payer.agent.residency, panOnFile: payer.agent.panOnFile },
      receiver: receiverRow,
      priceMicroUsdc: credit.amount,
      inrPerUsdMicro: rate,
      aggregatePaise: await pairTotalPaise(tx, pair, now),
      pack: deps.pack
    });
    const [row] = await tx
      .insert(outsidePayment)
      .values({
        receiverID: receiverRow.id,
        agentID: payer.agent.id,
        fromWallet: payer.wallet,
        toWallet,
        transactionID: transactionId,
        consensusAt,
        amountMicro: credit.amount,
        valuePaise: microUsdcToPaise(credit.amount, rate),
        shortfallPaise: missed.tdsPaise,
        fy: pair.fy
      })
      .onConflictDoNothing({ target: outsidePayment.transactionID })
      .returning();
    if (!row) return null;
    await addOutsideToAggregate(tx, pair, row.valuePaise);
    await tx.insert(hcsOutbox).values({
      kind: 'outside',
      topicID: deps.paymentsTopicId,
      payload: outsideMessage(
        'outside',
        row,
        pairId(deps.pairSecret, pair.agentId, pair.receiverId)
      )
    });
    return row;
  });
};

// One pass over every receiver wallet. A wallet whose Mirror read fails keeps its cursor and is
// retried on the next pass; the others carry on.
export const watchOutsidePayments = async (deps: WatcherDeps): Promise<WatchReport> => {
  const now = deps.now?.() ?? new Date();
  const report: WatchReport = { flagged: 0, failed: 0 };
  const wallets = await deps.db
    .select({ accountID: receiverWallet.accountID, receiver })
    .from(receiverWallet)
    .innerJoin(receiver, eq(receiver.id, receiverWallet.receiverID));
  const rate = wallets.length > 0 ? (await deps.fx.current()).inrPerUsdMicro : 0n;

  for (const wallet of wallets) {
    try {
      const [saved] = await deps.db
        .select({ cursor: watcherCursor.cursor })
        .from(watcherCursor)
        .where(eq(watcherCursor.accountID, wallet.accountID));
      const cursor = saved?.cursor ?? cursorFromDate(now);
      const read = await deps.mirror.tokenCreditsSince(
        wallet.accountID,
        deps.settlementTokenId,
        cursor
      );
      if (!read.ok) {
        report.failed += 1;
        continue;
      }
      for (const credit of read.data.credits) {
        const row = await flag(deps, wallet.receiver, wallet.accountID, credit, rate);
        if (!row) continue;
        report.flagged += 1;
        deps.bus.publish(row.receiverID, { type: 'outside.payment', row: toOutsideRow(row, null) });
      }
      await deps.db
        .insert(watcherCursor)
        .values({ accountID: wallet.accountID, cursor: read.data.cursor })
        .onConflictDoUpdate({
          target: watcherCursor.accountID,
          set: { cursor: read.data.cursor, updatedAt: sql`now()` }
        });
    } catch (error) {
      report.failed += 1;
      console.error(`[outside-watcher]: wallet ${wallet.accountID} was not checked`, error);
    }
  }
  return report;
};

// The HCS sequence of an outside payment's first message, once the outbox has published it
export const outsideSequence = async (db: KoshaDb, id: string): Promise<number | null> => {
  const [row] = await db
    .select({ sequence: hcsOutbox.hcsSequence })
    .from(hcsOutbox)
    .where(and(eq(hcsOutbox.kind, 'outside'), sql`${hcsOutbox.payload}->>'oid' = ${id}`));
  return row?.sequence ?? null;
};
