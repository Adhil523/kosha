import type { KoshaDb } from './db/client';
import { payment, quote } from './db/schema';
import type { SpendTotals } from './spend-policy';
import { istDayKey } from '@kosha/tax-engine/ist-calendar';
import { and, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';

export type SpendWindow = {
  agentId: string;
  fy: string;
  now: Date;
  // At verify, the quote being paid is counted by the caller, so it is left out here
  excludeQuoteId?: string;
};

// Midnight IST of the day containing `date`. Daily caps reset here.
export const istDayStart = (date: Date): Date => new Date(`${istDayKey(date)}T00:00:00+05:30`);

// What the agent has committed, all-in, today (IST) and this financial year: payments that settled
// or are still in flight, plus open quotes. Counting open quotes keeps two concurrent quotes from
// both fitting under a cap; an abandoned quote holds its share only until it expires. A failed
// payment counts for nothing.
export const committedSpend = async (db: KoshaDb, window: SpendWindow): Promise<SpendTotals> => {
  const dayStart = istDayStart(window.now);
  const [row] = await db
    .select({
      dayMicro: sql<string>`coalesce(sum(${quote.totalMicro}) filter (where ${quote.createdAt} >= ${dayStart}), 0)::text`,
      fyMicro: sql<string>`coalesce(sum(${quote.totalMicro}), 0)::text`
    })
    .from(quote)
    .leftJoin(payment, eq(payment.quoteID, quote.id))
    .where(
      and(
        eq(quote.agentID, window.agentId),
        eq(quote.fy, window.fy),
        window.excludeQuoteId ? ne(quote.id, window.excludeQuoteId) : undefined,
        or(
          inArray(payment.status, ['settled', 'pending']),
          and(
            isNull(payment.id),
            or(gt(quote.expiresAt, window.now), isNotNull(quote.usedTransactionID))
          )
        )
      )
    );
  return { dayMicro: BigInt(row?.dayMicro ?? '0'), fyMicro: BigInt(row?.fyMicro ?? '0') };
};

// Serialises policy checks for one agent across receivers: the totals are read and the new quote
// written under the same transaction-scoped lock, so a concurrent quote sees this one as open.
// Callers that also hold a pair lock take it first, so the order is always pair, then agent.
export const lockAgentSpend = async (tx: KoshaDb, agentId: string): Promise<void> => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`spend:${agentId}`}))`);
};
