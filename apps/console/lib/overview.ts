import type { LedgerRow } from '@kosha/shared/console-api';
import { amountSchema, amountToBigint, bigintToAmount } from '@kosha/shared/money';
import { z } from 'zod';

const RATE_WINDOW_MS = 60_000;

// The Console's own contract between /api/overview and the overview cards
export const overviewSchema = z.object({
  todayMicro: amountSchema,
  monthMicro: amountSchema,
  tdsMonthMicro: amountSchema,
  paymentsLastMinute: z.int().nonnegative()
});
export type Overview = z.output<typeof overviewSchema>;

// "2026-11-06" in IST: tax days and months run on Indian time, not the server's
const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
export const istDateKey = (date: Date): string => IST_DATE.format(date);

// The first instant of the IST month that `now` falls in, for the ledger's `from` filter
export const istMonthStart = (now: Date): Date =>
  new Date(`${istDateKey(now).slice(0, 7)}-01T00:00:00+05:30`);

// API-owner earnings are the price received; the TDS sits in each payer's own reserve
export const overviewStats = (rows: LedgerRow[], now: Date): Overview => {
  const today = istDateKey(now);
  const month = today.slice(0, 7);
  let todayMicro = 0n;
  let monthMicro = 0n;
  let tdsMonthMicro = 0n;
  let paymentsLastMinute = 0;

  for (const row of rows) {
    const at = new Date(row.consensusAt);
    const day = istDateKey(at);
    if (day.startsWith(month)) {
      monthMicro += amountToBigint(row.priceMicro);
      tdsMonthMicro += amountToBigint(row.tdsMicro);
    }
    if (day === today) todayMicro += amountToBigint(row.priceMicro);
    const age = now.getTime() - at.getTime();
    if (age >= 0 && age < RATE_WINDOW_MS) paymentsLastMinute += 1;
  }

  return {
    todayMicro: bigintToAmount(todayMicro),
    monthMicro: bigintToAmount(monthMicro),
    tdsMonthMicro: bigintToAmount(tdsMonthMicro),
    paymentsLastMinute
  };
};
