import { istDateKey } from '@/lib/overview';
import type { LedgerRow } from '@kosha/shared/console-api';
import { amountSchema, amountToBigint, bigintToAmount } from '@kosha/shared/money';
import { z } from 'zod';

// Indian financial years start on 1 April
const FY_START_MONTH = 4;

const spendLineSchema = z.object({
  key: z.string(),
  payments: z.int().nonnegative(),
  priceMicro: amountSchema,
  tdsMicro: amountSchema
});

// The Console's contract between /api/agents/:id/spend and the spend view. Budget fields are null
// when the agent has no policy, and so no yearly budget.
export const spendSummarySchema = z.object({
  fyStart: z.iso.datetime(),
  priceMicro: amountSchema,
  tdsMicro: amountSchema,
  budgetMicro: amountSchema.nullable(),
  budgetLeftMicro: amountSchema.nullable(),
  byApi: z.array(spendLineSchema),
  byDay: z.array(spendLineSchema)
});
export type SpendSummary = z.output<typeof spendSummarySchema>;
type SpendLine = z.output<typeof spendLineSchema>;

// The first instant of the Indian financial year that `now` falls in (1 April, IST)
export const istFinancialYearStart = (now: Date): Date => {
  const [year = 0, month = 0] = istDateKey(now).split('-').map(Number);
  const startYear = month >= FY_START_MONTH ? year : year - 1;
  return new Date(`${startYear}-04-01T00:00:00+05:30`);
};

type Totals = { payments: number; price: bigint; tds: bigint };

const addRow = (groups: Map<string, Totals>, key: string, row: LedgerRow): void => {
  const totals = groups.get(key) ?? { payments: 0, price: 0n, tds: 0n };
  groups.set(key, {
    payments: totals.payments + 1,
    price: totals.price + amountToBigint(row.priceMicro),
    tds: totals.tds + amountToBigint(row.tdsMicro)
  });
};

const toLines = (groups: Map<string, Totals>): SpendLine[] =>
  [...groups].map(([key, totals]) => ({
    key,
    payments: totals.payments,
    priceMicro: bigintToAmount(totals.price),
    tdsMicro: bigintToAmount(totals.tds)
  }));

// One agent's spend this financial year: the price paid to each API, the TDS reserved on top, and
// what is left of the yearly budget, which counts the all-in total like Pay and Core do
export const spendSummary = (
  rows: LedgerRow[],
  { now, fyBudgetMicro }: { now: Date; fyBudgetMicro: bigint | null }
): SpendSummary => {
  const fyStart = istFinancialYearStart(now);
  const byApi = new Map<string, Totals>();
  const byDay = new Map<string, Totals>();
  let price = 0n;
  let tds = 0n;

  for (const row of rows) {
    const at = new Date(row.consensusAt);
    if (at < fyStart || at > now) continue;
    price += amountToBigint(row.priceMicro);
    tds += amountToBigint(row.tdsMicro);
    addRow(byApi, row.receiverId, row);
    addRow(byDay, istDateKey(at), row);
  }

  const spent = price + tds;
  const left = fyBudgetMicro === null ? null : fyBudgetMicro > spent ? fyBudgetMicro - spent : 0n;
  return {
    fyStart: fyStart.toISOString(),
    priceMicro: bigintToAmount(price),
    tdsMicro: bigintToAmount(tds),
    budgetMicro: fyBudgetMicro === null ? null : bigintToAmount(fyBudgetMicro),
    budgetLeftMicro: left === null ? null : bigintToAmount(left),
    byApi: toLines(byApi).sort((a, b) => a.key.localeCompare(b.key)),
    byDay: toLines(byDay).sort((a, b) => b.key.localeCompare(a.key))
  };
};
