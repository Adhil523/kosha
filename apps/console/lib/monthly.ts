import { istDateKey } from '@/lib/overview';
import { type ChallanRow, monthSchema, type ReleaseRow } from '@kosha/shared/tax-reports';
import { type z } from 'zod';

const MONTHS_PER_YEAR = 12;

export type Month = z.output<typeof monthSchema>;

// The calendar month `now` falls in, on the IST clock the TDS deadlines run on: "2026-11"
export const currentMonth = (now: Date): Month => monthSchema.parse(istDateKey(now).slice(0, 7));

// This month and the ones before it, newest first
export const recentMonths = (now: Date, count: number): Month[] => {
  const [year = 0, month = 1] = currentMonth(now).split('-').map(Number);
  const ordinal = year * MONTHS_PER_YEAR + month - 1;
  return Array.from({ length: count }, (_, back) => {
    const at = ordinal - back;
    const padded = String((at % MONTHS_PER_YEAR) + 1).padStart(2, '0');
    return monthSchema.parse(`${Math.floor(at / MONTHS_PER_YEAR)}-${padded}`);
  });
};

const MONTH_NAME = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
});

// "2026-11" → "November 2026"
export const monthLabel = (month: Month): string =>
  MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`));

export const RELEASE_STATUS_LABELS: Record<ReleaseRow['status'], string> = {
  pending: 'Being scheduled',
  scheduled: 'Waiting for the agent’s co-sign',
  executed: 'Released',
  // The schedule ran but its transfer failed (e.g. the deductor dropped the token): TDS still held
  failed: 'Transfer failed, TDS still in the reserve',
  expired: 'Expired, to be scheduled again',
  deleted: 'Cancelled'
};

// The challan recorded for a month, if any: one per receiver and month
export const challanFor = (challans: readonly ChallanRow[], month: Month): ChallanRow | null =>
  challans.find((challan) => challan.month === month) ?? null;
