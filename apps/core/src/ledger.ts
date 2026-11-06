import type { KoshaDb } from './db/client';
import { aggregate, hcsOutbox, payment } from './db/schema';
import { pairId, payMessage } from './hcs-messages';
import { type PairKey, withPairLock } from './pair-total';
import type { QuoteRow } from './quote-terms';
import { sql } from 'drizzle-orm';

export type LedgerContext = {
  pairSecret: string;
  rulepackHash: string;
  // HCS_PAYMENTS_TOPIC
  paymentsTopicId: string;
};

export type RecordedPayment = { paymentId: string; aggregatePaise: bigint };

// What the network said about an executed settlement. `pending` means it was submitted but no
// receipt or Mirror record confirms it yet: it may still settle, so Core never resubmits it.
export type SettlementOutcome = 'settled' | 'pending' | 'failed';

const agentOf = (row: QuoteRow): string => {
  if (!row.agentID) throw new Error(`[ledger]: quote ${row.id} has no agent`);
  return row.agentID;
};

// Adds one payment to its pair's year total and returns the new total, outside payments included.
// Call it inside the pair's lock (withPairLock).
export const addToAggregate = async (
  tx: KoshaDb,
  pair: PairKey,
  valuePaise: bigint
): Promise<bigint> => {
  const [total] = await tx
    .insert(aggregate)
    .values({
      agentID: pair.agentId,
      receiverID: pair.receiverId,
      fy: pair.fy,
      valuePaise,
      paymentsCount: 1
    })
    .onConflictDoUpdate({
      target: [aggregate.agentID, aggregate.receiverID, aggregate.fy],
      set: {
        valuePaise: sql`${aggregate.valuePaise} + excluded."valuePaise"`,
        paymentsCount: sql`${aggregate.paymentsCount} + 1`,
        updatedAt: sql`now()`
      }
    })
    .returning({ value: aggregate.valuePaise, outside: aggregate.outsideValuePaise });
  if (!total) throw new Error('[ledger]: the aggregate was not updated');
  return total.value + total.outside;
};

// Moves a pair's outside value (payments seen outside Kosha, A19): up when one is flagged, down
// when the owner marks it a gift. Call it inside the pair's lock.
export const addOutsideToAggregate = async (
  tx: KoshaDb,
  pair: PairKey,
  deltaPaise: bigint
): Promise<void> => {
  await tx
    .insert(aggregate)
    .values({
      agentID: pair.agentId,
      receiverID: pair.receiverId,
      fy: pair.fy,
      outsideValuePaise: deltaPaise
    })
    .onConflictDoUpdate({
      target: [aggregate.agentID, aggregate.receiverID, aggregate.fy],
      set: {
        outsideValuePaise: sql`${aggregate.outsideValuePaise} + excluded."outsideValuePaise"`,
        updatedAt: sql`now()`
      }
    });
};

// Records an executed settlement in one database transaction, under the pair's lock so a
// concurrent quote for the pair waits and then sees the new total:
// - settled: the payment, its value added to the pair's aggregate, and the HCS pay message queued
// - pending: the payment and its value too (never under-deduct), but no HCS message until confirmed
// - failed: the payment only; the quote stays used, so the payer asks for a new one
export const recordSettlement = async (
  db: KoshaDb,
  context: LedgerContext,
  row: QuoteRow,
  transactionId: string,
  outcome: SettlementOutcome
): Promise<RecordedPayment> => {
  const agentId = agentOf(row);
  return withPairLock(db, { agentId, receiverId: row.receiverID, fy: row.fy }, async (tx) => {
    const [saved] = await tx
      .insert(payment)
      .values({
        quoteID: row.id,
        transactionID: transactionId,
        receiverID: row.receiverID,
        agentID: agentId,
        priceMicro: row.priceMicro,
        tdsMicro: row.tdsMicro,
        reserveAccountID: row.reserveAccountID,
        inrValuePaise: row.inrValuePaise,
        fy: row.fy,
        status: outcome
      })
      .returning({ id: payment.id });
    if (!saved) throw new Error('[ledger]: the payment was not saved');
    if (outcome === 'failed') return { paymentId: saved.id, aggregatePaise: 0n };

    const aggregatePaise = await addToAggregate(
      tx,
      { agentId, receiverId: row.receiverID, fy: row.fy },
      row.inrValuePaise
    );

    if (outcome === 'settled') {
      await tx.insert(hcsOutbox).values({
        kind: 'pay',
        topicID: context.paymentsTopicId,
        paymentID: saved.id,
        payload: payMessage({
          paymentId: saved.id,
          transactionId,
          rulepack: row.rulepack,
          rulepackHash: context.rulepackHash,
          priceMicro: row.priceMicro,
          tdsMicro: row.tdsMicro,
          rateBps: row.rateBps,
          pair: pairId(context.pairSecret, agentId, row.receiverID),
          fy: row.fy,
          aggregatePaise,
          compat: row.scheme === 'exact_compat'
        })
      });
    }
    return { paymentId: saved.id, aggregatePaise };
  });
};
