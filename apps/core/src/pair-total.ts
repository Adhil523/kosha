import type { KoshaDb } from './db/client';
import { aggregate, decision, payment, quote } from './db/schema';
import { and, eq, gt, isNotNull, isNull, notExists, or, sql } from 'drizzle-orm';

export type PairKey = { agentId: string; receiverId: string; fy: string };

// The total a decision is made against (PROTOCOL design fix 1): settled value, plus payments seen
// outside Kosha, plus the value of the pair's open quotes. Counting open quotes means two
// concurrent quotes can't both slip under the threshold; an abandoned quote can only cause
// over-deduction, which is a refundable credit.
//
// A quote stays open until its payment is recorded, not just until it is claimed: settle claims
// the quote, executes on Hedera for a few seconds, and only then adds the value to the aggregate.
// A quote issued in that gap must still see the in-flight value, or it could under-deduct. A
// claimed quote counts even past expiry, since execution can outlast it.
export const pairTotalPaise = async (db: KoshaDb, pair: PairKey, now: Date): Promise<bigint> => {
  const [settled] = await db
    .select({ value: aggregate.valuePaise, outside: aggregate.outsideValuePaise })
    .from(aggregate)
    .where(
      and(
        eq(aggregate.agentID, pair.agentId),
        eq(aggregate.receiverID, pair.receiverId),
        eq(aggregate.fy, pair.fy)
      )
    );

  const [open] = await db
    .select({ value: sql<string>`coalesce(sum(${quote.inrValuePaise}), 0)::text` })
    .from(quote)
    .where(
      and(
        eq(quote.agentID, pair.agentId),
        eq(quote.receiverID, pair.receiverId),
        eq(quote.fy, pair.fy),
        notExists(db.select({ id: payment.id }).from(payment).where(eq(payment.quoteID, quote.id))),
        or(gt(quote.expiresAt, now), isNotNull(quote.usedTransactionID))
      )
    );

  // Decisions for other rails (A24) hold their value the same way until confirmed or expired
  const [deciding] = await db
    .select({ value: sql<string>`coalesce(sum(${decision.valuePaise}), 0)::text` })
    .from(decision)
    .where(
      and(
        eq(decision.agentID, pair.agentId),
        eq(decision.receiverID, pair.receiverId),
        eq(decision.fy, pair.fy),
        isNull(decision.confirmedAt),
        gt(decision.expiresAt, now)
      )
    );

  return (
    (settled?.value ?? 0n) +
    (settled?.outside ?? 0n) +
    BigInt(open?.value ?? '0') +
    BigInt(deciding?.value ?? '0')
  );
};

// Serialises quoting for one pair: the total is read and the new quote written under the same
// transaction-scoped advisory lock, so a concurrent quote waits and then sees this one as open.
export const withPairLock = async <T>(
  db: KoshaDb,
  pair: PairKey,
  work: (tx: KoshaDb) => Promise<T>
): Promise<T> =>
  db.transaction(async (tx) => {
    const key = `${pair.agentId}:${pair.receiverId}:${pair.fy}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    return work(tx);
  });
