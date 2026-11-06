import type { KoshaDb } from './db/client';
import { receiver } from './db/schema';
import { closeRows, monthBounds, previousMonthKey, totalTdsPaise } from './monthly-close';
import { refreshReleases, type ReleaseDeps, type ReleaseReport, scheduleDue } from './releases';
import { formatInr } from '@kosha/shared/money';

// What the monthly job does on the 1st (A20): totals each receiver's TDS for the month that just
// ended, so the deductor sees its payment summary, and settles the fate of earlier releases.

export type PrepareDeps = { db: KoshaDb; releases: ReleaseDeps; now?: () => Date };

export type PrepareReport = {
  month: string;
  receivers: number;
  // Receivers that withheld TDS in the month, so a challan is due
  awaitingChallan: number;
  scheduled: ReleaseReport;
  refreshed: ReleaseReport;
};

export const prepareMonthlyClose = async (deps: PrepareDeps): Promise<PrepareReport> => {
  const now = deps.now?.() ?? new Date();
  const month = previousMonthKey(now);
  const bounds = monthBounds(month);
  if (!bounds) throw new Error(`[monthly-close]: ${month} is not a month`);

  const receivers = await deps.db.select({ id: receiver.id }).from(receiver);
  let awaitingChallan = 0;
  for (const { id } of receivers) {
    const rows = await closeRows(deps.db, id, bounds);
    const total = totalTdsPaise(rows);
    if (total === 0n) continue;
    awaitingChallan += 1;
    console.info(
      `[monthly-close]: ${month} ${id}: ${formatInr(total)} of TDS across ${rows.length} payer reserve(s) awaits its challan`
    );
  }

  // Earlier closes: a refused schedule is retried, a co-signed or lapsed one is recorded
  const scheduled = await scheduleDue(deps.releases, {});
  const refreshed = await refreshReleases(deps.releases, {});
  return { month, receivers: receivers.length, awaitingChallan, scheduled, refreshed };
};
