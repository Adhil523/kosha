import { istDateKey } from '@/lib/overview';
import { topicIdSchema } from '@kosha/shared/ids';
import { amountSchema, amountToBigint, bigintToAmount } from '@kosha/shared/money';
import { quarterSchema, type TdsExportRow, tdsExportRowSchema } from '@kosha/shared/tax-reports';
import { z } from 'zod';

const FY_START_MONTH = 4;
const MONTHS_PER_QUARTER = 3;
const QUARTERS_PER_YEAR = 4;
const EXPORT_COLUMNS = Object.keys(tdsExportRowSchema.shape);
// CSV cells that hold numbers; the rest stay text
const INT_COLUMNS = new Set(['rateBps', 'hcsSequence']);

export type Quarter = z.output<typeof quarterSchema>;

// The financial-year quarter `now` falls in (IST): April–June is Q1 of the year that starts in April
export const currentQuarter = (now: Date): Quarter => {
  const [year = 0, month = 0] = istDateKey(now).split('-').map(Number);
  const fyStart = month >= FY_START_MONTH ? year : year - 1;
  const index = Math.floor(((month - FY_START_MONTH + 12) % 12) / MONTHS_PER_QUARTER) + 1;
  return quarterSchema.parse(`${fyStart}-Q${index}`);
};

// This quarter and the ones before it, newest first
export const recentQuarters = (now: Date, count: number): Quarter[] => {
  const [start = '0', q = 'Q1'] = currentQuarter(now).split('-');
  const ordinal = Number(start) * QUARTERS_PER_YEAR + Number(q.slice(1)) - 1;
  return Array.from({ length: count }, (_, back) => {
    const at = ordinal - back;
    const index = (at % QUARTERS_PER_YEAR) + 1;
    return quarterSchema.parse(`${Math.floor(at / QUARTERS_PER_YEAR)}-Q${index}`);
  });
};

// RFC 4180: quoted cells may hold commas, newlines and doubled quotes; lines end in CRLF or LF
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
};

// Core's TDS export → typed rows; null if the header or any row breaks the A15 contract
export const parseTdsExport = (csv: string): TdsExportRow[] | null => {
  const [header, ...lines] = parseCsv(csv);
  if (!header || header.join(',') !== EXPORT_COLUMNS.join(',')) return null;
  const rows: TdsExportRow[] = [];
  for (const line of lines) {
    const record = Object.fromEntries(
      header.map((column, index) => {
        const cell = line[index] ?? '';
        if (!INT_COLUMNS.has(column)) return [column, cell];
        return [column, cell === '' ? null : Number(cell)];
      })
    );
    const parsed = tdsExportRowSchema.safeParse(record);
    if (!parsed.success) return null;
    rows.push(parsed.data);
  }
  return rows;
};

const totalsSchema = z.object({
  payments: z.int().nonnegative(),
  considerationPaise: amountSchema,
  tdsPaise: amountSchema
});

// The Console's contract between /api/tax and the tax screens
export const taxReportSchema = z.object({
  quarter: quarterSchema,
  totals: totalsSchema,
  deductees: z.array(totalsSchema.extend({ deducteeRef: z.string(), rates: z.array(z.int()) })),
  rows: z.array(tdsExportRowSchema),
  // Where each row's hcsSequence lives; null when the payments topic isn't configured (or in mock
  // mode, whose sample sequences name no real message)
  hcsTopic: z.object({ mirrorUrl: z.url(), topicId: topicIdSchema }).nullable(),
  rulePack: z.object({
    id: z.string(),
    hash: z.string(),
    reviewedBy: z.string().nullable(),
    // Its HCS record on the payments topic, when the Mirror Node has it
    hcs: z.object({ sequence: z.int().positive(), url: z.url() }).nullable()
  })
});
export type TaxReport = z.output<typeof taxReportSchema>;

type Sums = { payments: number; consideration: bigint; tds: bigint; rates: Set<number> };

// Quarter totals and one line per deductee, in the export's deductee order
export const summarise = (
  rows: readonly TdsExportRow[]
): Pick<TaxReport, 'totals' | 'deductees'> => {
  const byDeductee = new Map<string, Sums>();
  const all: Sums = { payments: 0, consideration: 0n, tds: 0n, rates: new Set() };
  for (const row of rows) {
    const sums = byDeductee.get(row.deducteeRef) ?? {
      payments: 0,
      consideration: 0n,
      tds: 0n,
      rates: new Set<number>()
    };
    for (const target of [sums, all]) {
      target.payments += 1;
      target.consideration += amountToBigint(row.considerationPaise);
      target.tds += amountToBigint(row.tdsPaise);
      target.rates.add(row.rateBps);
    }
    byDeductee.set(row.deducteeRef, sums);
  }
  const toTotals = (sums: Sums) => ({
    payments: sums.payments,
    considerationPaise: bigintToAmount(sums.consideration),
    tdsPaise: bigintToAmount(sums.tds)
  });
  return {
    totals: toTotals(all),
    deductees: [...byDeductee].map(([deducteeRef, sums]) => ({
      deducteeRef,
      ...toTotals(sums),
      rates: [...sums.rates].sort((a, b) => a - b)
    }))
  };
};

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

// The export's CSV for rows the Console already holds (mock mode), in Core's format
export const toCsv = (rows: readonly TdsExportRow[]): string =>
  [
    EXPORT_COLUMNS,
    ...rows.map((row) => EXPORT_COLUMNS.map((column) => row[column as keyof TdsExportRow]))
  ]
    .map((cells) => cells.map(csvCell).join(','))
    .map((line) => `${line}\r\n`)
    .join('');
