import type { KoshaDb } from './db/client';
import { agent, payment, quote } from './db/schema';
import { TDS_SECTION, type TdsExportRow, tdsExportRowSchema } from '@kosha/shared/tax-reports';
import { istDayKey } from '@kosha/tax-engine/ist-calendar';
import { and, asc, eq, gt, gte, lt } from 'drizzle-orm';

const QUARTER_PATTERN = /^(\d{4})-Q([1-4])$/;
const MONTHS_PER_QUARTER = 3;
// IST is UTC+05:30 all year
const IST_OFFSET_MS = 19_800_000;
// micro-USDC × micro-rupees-per-USD ÷ this = paise
const MICRO_RATE_PER_PAISE = 10_000_000_000n;
// The statutory code a TDS statement uses for a deductee with no PAN
export const NO_PAN = 'PANNOTAVBL';

export const TDS_EXPORT_COLUMNS = Object.keys(tdsExportRowSchema.shape) as (keyof TdsExportRow)[];

// "2026-Q3" with an April start → [1 Oct 2026 00:00 IST, 1 Jan 2027 00:00 IST)
export const quarterBounds = (
  key: string,
  financialYearStart: string
): { start: Date; end: Date } | null => {
  const match = QUARTER_PATTERN.exec(key);
  const startMonth = Number(financialYearStart.slice(0, 2));
  if (!match?.[1] || !match[2] || !startMonth) return null;
  const firstMonth = startMonth - 1 + (Number(match[2]) - 1) * MONTHS_PER_QUARTER;
  const istMidnight = (monthIndex: number) =>
    new Date(Date.UTC(Number(match[1]), monthIndex, 1) - IST_OFFSET_MS);
  return { start: istMidnight(firstMonth), end: istMidnight(firstMonth + MONTHS_PER_QUARTER) };
};

// The TDS decide() computed, in paise. Only micro-USDC is stored, but decide() rounds the paise
// up and then the micro-USDC up, so flooring the conversion back recovers the paise exactly
// while a rupee is worth more than a micro-USDC (any rate under ₹10,000 per USD).
export const tdsPaiseOf = (tdsMicro: bigint, inrPerUsdMicro: bigint): bigint =>
  (tdsMicro * inrPerUsdMicro) / MICRO_RATE_PER_PAISE;

// Core never holds an agent's PAN, so the deductee is named by its masked account; a payer with
// no PAN on file carries the statutory PANNOTAVBL
export const deducteeRef = (identity: string, panOnFile: boolean): string => {
  const account = identity.split(':').at(-1) ?? identity;
  const masked = account.length > 4 ? `${account.slice(0, -3)}***` : '***';
  return panOnFile ? masked : `${NO_PAN} ${masked}`;
};

// Deductee-wise rows for one receiver's quarter: settled live payments that withheld TDS. Sample
// history is left out; it is not a real deduction.
export const readTdsExport = async (
  db: KoshaDb,
  receiverId: string,
  bounds: { start: Date; end: Date }
): Promise<TdsExportRow[]> => {
  const rows = await db
    .select({
      identity: agent.identity,
      panOnFile: agent.panOnFile,
      considerationPaise: payment.inrValuePaise,
      tdsMicro: payment.tdsMicro,
      inrPerUsdMicro: quote.inrPerUsdMicro,
      rateBps: quote.rateBps,
      at: payment.createdAt,
      consensusAt: payment.consensusAt,
      hcsSequence: payment.hcsSequence,
      transactionId: payment.transactionID
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
        gte(payment.createdAt, bounds.start),
        lt(payment.createdAt, bounds.end)
      )
    )
    .orderBy(asc(agent.identity), asc(payment.createdAt), asc(payment.id));

  return rows.map((row) => {
    // One atomic transaction pays the price and the TDS, so payment and deduction share a date
    const date = istDayKey(row.consensusAt ?? row.at);
    return tdsExportRowSchema.parse({
      deducteeRef: deducteeRef(row.identity, row.panOnFile),
      considerationPaise: row.considerationPaise.toString(),
      tdsPaise: tdsPaiseOf(row.tdsMicro, row.inrPerUsdMicro).toString(),
      rateBps: row.rateBps,
      fundedBy: 'deductee_reserve',
      paymentDate: date,
      deductionDate: date,
      section: TDS_SECTION,
      hcsSequence: row.hcsSequence,
      transactionId: row.transactionId
    });
  });
};

const csvCell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

// Header from the schema's keys, in order, then one line per row; CRLF line ends, as RFC 4180 has
export const toTdsCsv = (rows: TdsExportRow[]): string =>
  [TDS_EXPORT_COLUMNS, ...rows.map((row) => TDS_EXPORT_COLUMNS.map((column) => row[column]))]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n')
    .concat('\r\n');
