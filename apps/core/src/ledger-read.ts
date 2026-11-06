import type { KoshaDb } from './db/client';
import { agent, payment, quote } from './db/schema';
import { type LedgerPage, type LedgerRow, ledgerRowSchema } from '@kosha/shared/console-api';
import { type HederaNetwork, transactionIdSchema } from '@kosha/shared/ids';
import { hashscanTransaction } from '@kosha/shared/links';
import { and, desc, eq, gte, lt, lte, or, type SQL, sql } from 'drizzle-orm';

export type LedgerFilter = {
  receiverId?: string;
  agentId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit: number;
};

// decide() flags a payment for FEMA review exactly when either side is non-resident, so the flag
// is recomputed from the stored reason rather than stored twice
const FEMA_REASONS: ReadonlySet<string> = new Set(['receiver_non_resident', 'non_resident']);

const selection = {
  paymentId: payment.id,
  quoteId: payment.quoteID,
  transactionId: payment.transactionID,
  consensusAt: payment.consensusAt,
  createdAt: payment.createdAt,
  // Microsecond text: a Date would round the cursor to milliseconds and skip or repeat rows
  cursorAt: sql<string>`${payment.createdAt}::text`,
  receiverId: payment.receiverID,
  agentId: payment.agentID,
  agentIdentity: agent.identity,
  ownerRef: agent.ownerRef,
  scheme: quote.scheme,
  priceMicro: payment.priceMicro,
  tdsMicro: payment.tdsMicro,
  inrValuePaise: payment.inrValuePaise,
  rateBps: quote.rateBps,
  reason: quote.reason,
  reserveAccountId: payment.reserveAccountID,
  hcsSequence: payment.hcsSequence
};

const selectSettled = (db: KoshaDb, where: SQL | undefined) =>
  db
    .select(selection)
    .from(payment)
    .innerJoin(quote, eq(quote.id, payment.quoteID))
    .innerJoin(agent, eq(agent.id, payment.agentID))
    .where(and(eq(payment.status, 'settled'), where));

type Selected = Awaited<ReturnType<typeof selectSettled>>[number];

const encodeCursor = (row: Selected): string =>
  Buffer.from(JSON.stringify([row.cursorAt, row.paymentId])).toString('base64url');

const decodeCursor = (cursor: string): [string, string] | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed)) return null;
    const [at, id] = parsed as unknown[];
    return parsed.length === 2 && typeof at === 'string' && typeof id === 'string'
      ? [at, id]
      : null;
  } catch {
    return null;
  }
};

const toLedgerRow = (network: HederaNetwork, row: Selected): LedgerRow => {
  const transactionId = transactionIdSchema.parse(row.transactionId);
  return ledgerRowSchema.parse({
    paymentId: row.paymentId,
    quoteId: row.quoteId,
    transactionId,
    consensusAt: (row.consensusAt ?? row.createdAt).toISOString(),
    receiverId: row.receiverId,
    agentId: row.agentId,
    agentLabel: row.ownerRef ?? row.agentIdentity,
    mode: row.scheme === 'exact_compat' ? 'compat' : 'kosha_split',
    priceMicro: row.priceMicro.toString(),
    tdsMicro: row.tdsMicro.toString(),
    inrValuePaise: row.inrValuePaise.toString(),
    rateBps: row.rateBps,
    reason: row.reason,
    flags: FEMA_REASONS.has(row.reason) ? ['fema_review'] : [],
    reserveAccountId: row.reserveAccountId,
    hashscanUrl: hashscanTransaction(network, transactionId),
    hcsSequence: row.hcsSequence,
    // Seeded history arrives with A14's sample flag
    sample: false
  });
};

// Settled payments, newest first, one page at a time. Null when the cursor is not one Core issued.
export const readLedger = async (
  db: KoshaDb,
  network: HederaNetwork,
  filter: LedgerFilter
): Promise<LedgerPage | null> => {
  const after = filter.cursor ? decodeCursor(filter.cursor) : undefined;
  if (after === null) return null;

  const rows = await selectSettled(
    db,
    and(
      filter.receiverId ? eq(payment.receiverID, filter.receiverId) : undefined,
      filter.agentId ? eq(payment.agentID, filter.agentId) : undefined,
      filter.from ? gte(payment.createdAt, new Date(filter.from)) : undefined,
      filter.to ? lte(payment.createdAt, new Date(filter.to)) : undefined,
      after
        ? or(
            lt(payment.createdAt, sql`${after[0]}::timestamptz`),
            and(eq(payment.createdAt, sql`${after[0]}::timestamptz`), lt(payment.id, after[1]))
          )
        : undefined
    )
  )
    .orderBy(desc(payment.createdAt), desc(payment.id))
    .limit(filter.limit + 1);

  const page = rows.slice(0, filter.limit);
  const last = page.at(-1);
  return {
    rows: page.map((row) => toLedgerRow(network, row)),
    nextCursor: rows.length > filter.limit && last ? encodeCursor(last) : null
  };
};

// One settled payment as the Console shows it; the stream sends this on payment.settled
export const ledgerRowById = async (
  db: KoshaDb,
  network: HederaNetwork,
  paymentId: string
): Promise<LedgerRow | null> => {
  const [row] = await selectSettled(db, eq(payment.id, paymentId));
  return row ? toLedgerRow(network, row) : null;
};
