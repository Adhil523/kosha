import type { KoshaDb } from './db/client';
import { agent, payment, quote, receiver } from './db/schema';
import { deducteeRef, IST_OFFSET_MS, istMonthStart, tdsPaiseOf } from './tds-export';
import { type MonthlyClose, monthlyCloseSchema, TDS_SECTION } from '@kosha/shared/tax-reports';
import { and, asc, eq, gt, gte, isNotNull, lt } from 'drizzle-orm';

// The monthly close (A20): what the deductor pays on the income-tax portal for one month, TDS per
// payer. Months are IST calendar months, like the quarters of the TDS export.

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const TAN_PREFIX_LENGTH = 4;
const TAN_SUFFIX_LENGTH = 1;
// The deductor's reference when it has no TAN on file: the portal needs one before it can pay
export const NO_TAN = 'TAN not on file';

export type MonthBounds = { start: Date; end: Date };

// "2026-11" → [1 Nov 2026 00:00 IST, 1 Dec 2026 00:00 IST)
export const monthBounds = (month: string): MonthBounds | null => {
  const match = MONTH_PATTERN.exec(month);
  if (!match?.[1] || !match[2]) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return { start: istMonthStart(year, monthIndex), end: istMonthStart(year, monthIndex + 1) };
};

// The IST calendar month before the one `now` falls in: what the job closes on the 1st
export const previousMonthKey = (now: Date): string => {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const previous = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
};

// "MUMD12345E" → "MUMD*****E"; the deductor is named on the portal by its TAN
export const deductorRef = (tan: string | null): string => {
  if (!tan) return NO_TAN;
  if (tan.length <= TAN_PREFIX_LENGTH + TAN_SUFFIX_LENGTH) return '*'.repeat(tan.length);
  const hidden = tan.length - TAN_PREFIX_LENGTH - TAN_SUFFIX_LENGTH;
  return `${tan.slice(0, TAN_PREFIX_LENGTH)}${'*'.repeat(hidden)}${tan.slice(-TAN_SUFFIX_LENGTH)}`;
};

export type CloseRow = {
  agentId: string;
  deducteeRef: string;
  tdsPaise: bigint;
  tdsMicro: bigint;
  reserveAccountId: string;
};

// TDS withheld per payer reserve in the month: settled live payments only, sample history left
// out. Grouped by agent and reserve, because the release moves funds from that reserve.
export const closeRows = async (
  db: KoshaDb,
  receiverId: string,
  bounds: MonthBounds
): Promise<CloseRow[]> => {
  const rows = await db
    .select({
      agentId: agent.id,
      identity: agent.identity,
      panOnFile: agent.panOnFile,
      reserveAccountId: payment.reserveAccountID,
      tdsMicro: payment.tdsMicro,
      inrPerUsdMicro: quote.inrPerUsdMicro
    })
    .from(payment)
    .innerJoin(quote, eq(quote.id, payment.quoteID))
    .innerJoin(agent, eq(agent.id, payment.agentID))
    .where(
      and(
        eq(payment.receiverID, receiverId),
        eq(payment.status, 'settled'),
        eq(payment.sample, false),
        gt(payment.tdsMicro, 0n),
        isNotNull(payment.reserveAccountID),
        gte(payment.createdAt, bounds.start),
        lt(payment.createdAt, bounds.end)
      )
    )
    .orderBy(asc(agent.identity), asc(payment.createdAt), asc(payment.id));

  const grouped = new Map<string, CloseRow>();
  for (const row of rows) {
    if (!row.reserveAccountId) continue;
    const key = `${row.agentId}:${row.reserveAccountId}`;
    const current = grouped.get(key) ?? {
      agentId: row.agentId,
      deducteeRef: deducteeRef(row.identity, row.panOnFile),
      tdsPaise: 0n,
      tdsMicro: 0n,
      reserveAccountId: row.reserveAccountId
    };
    current.tdsPaise += tdsPaiseOf(row.tdsMicro, row.inrPerUsdMicro);
    current.tdsMicro += row.tdsMicro;
    grouped.set(key, current);
  }
  return [...grouped.values()];
};

export const totalTdsPaise = (rows: CloseRow[]): bigint =>
  rows.reduce((sum, row) => sum + row.tdsPaise, 0n);

// The payment summary for GET /v1/close; null when the receiver does not exist
export const readMonthlyClose = async (
  db: KoshaDb,
  receiverId: string,
  month: string,
  bounds: MonthBounds
): Promise<MonthlyClose | null> => {
  const [deductor] = await db
    .select({ tan: receiver.tan })
    .from(receiver)
    .where(eq(receiver.id, receiverId));
  if (!deductor) return null;
  const rows = await closeRows(db, receiverId, bounds);
  return monthlyCloseSchema.parse({
    receiverId,
    month,
    section: TDS_SECTION,
    deductorRef: deductorRef(deductor.tan),
    totalTdsPaise: totalTdsPaise(rows).toString(),
    rows: rows.map((row) => ({
      agentId: row.agentId,
      deducteeRef: row.deducteeRef,
      tdsPaise: row.tdsPaise.toString(),
      tdsMicro: row.tdsMicro.toString(),
      reserveAccountId: row.reserveAccountId
    }))
  });
};
