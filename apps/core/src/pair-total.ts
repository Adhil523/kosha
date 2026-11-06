import type { KoshaDb } from './db/client';
import { aggregate, quote } from './db/schema';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

export type PairKey = { agentId: string; receiverId: string; fy: string };

// The total a decision is made against (PROTOCOL design fix 1): settled value, plus payments seen
// outside Kosha, plus the value of the pair's open quotes (not expired, not used). Counting open
// quotes means two concurrent quotes can't both slip under the threshold; an abandoned quote can
// only cause over-deduction, which is a refundable credit.
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
        isNull(quote.usedTransactionID),
        gt(quote.expiresAt, now)
      )
    );

  return (settled?.value ?? 0n) + (settled?.outside ?? 0n) + BigInt(open?.value ?? '0');
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
