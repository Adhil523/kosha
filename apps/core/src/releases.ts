import type { KoshaDb } from './db/client';
import { challan, release } from './db/schema';
import { Hbar, type Key, TokenId, TransferTransaction } from '@hiero-ledger/sdk';
import type { Executor } from '@kosha/hedera/executor';
import type { MirrorClient } from '@kosha/hedera/mirror';
import { createScheduledTransfer } from '@kosha/hedera/schedule';
import { type ReleaseRow, releaseRowSchema } from '@kosha/shared/tax-reports';
import { and, asc, eq } from 'drizzle-orm';

// Reserve releases (A20): once the deductor has paid the month's challan, each payer's TDS goes
// back from its 2-of-2 reserve to the deductor's wallet through a scheduled transfer. Core's
// signature lands at creation; the agent operator's co-sign runs it (waitForExpiry false).

// A release lives 7 days (spec): time to co-sign, well under the network's 62-day cap
export const RELEASE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type ReleaseDeps = {
  db: KoshaDb;
  // Core's operator: ScheduleCreate's payer, and the inner transfer's fee payer
  execute: Executor;
  mirror: Pick<MirrorClient, 'scheduleStatus'>;
  coreAccountId: string;
  // Admin key on every schedule, so Core can delete a bad one
  coreKey: Key;
  settlementTokenId: string;
  maxTransactionFeeHbar: string;
  now?: () => Date;
};

export type ReleaseFilter = { challanId?: string; receiverId?: string };
export type ReleaseReport = { changed: number; failed: number };

type ReleaseRecord = typeof release.$inferSelect;
type Due = ReleaseRecord & { month: string };

export const releaseMemo = (month: string, agentId: string): string =>
  `kosha-release:${month}:${agentId}`;

// The inner transfer: reserve → deductor, the month's TDS, with the memo HashScan will show
export const buildReleaseTransfer = (deps: ReleaseDeps, due: Due): TransferTransaction => {
  const token = TokenId.fromString(deps.settlementTokenId);
  return new TransferTransaction()
    .setTransactionMemo(releaseMemo(due.month, due.agentID))
    .setMaxTransactionFee(new Hbar(deps.maxTransactionFeeHbar))
    .addTokenTransfer(token, due.reserveAccountID, -due.micro)
    .addTokenTransfer(token, due.toAccountID, due.micro);
};

const matching = (db: KoshaDb, filter: ReleaseFilter, status?: ReleaseRecord['status']) =>
  db
    .select({ row: release, month: challan.month })
    .from(release)
    .innerJoin(challan, eq(challan.id, release.challanID))
    .where(
      and(
        filter.challanId ? eq(release.challanID, filter.challanId) : undefined,
        filter.receiverId ? eq(challan.receiverID, filter.receiverId) : undefined,
        status ? eq(release.status, status) : undefined
      )
    )
    .orderBy(asc(release.createdAt), asc(release.id));

const setStatus = (db: KoshaDb, id: string, fields: Partial<ReleaseRecord>) =>
  db.update(release).set(fields).where(eq(release.id, id));

// Creates the schedule for every pending release. Idempotent: the memo and the stored expiry make
// a retried create identical, so the network hands back the existing schedule ID.
export const scheduleDue = async (
  deps: ReleaseDeps,
  filter: ReleaseFilter
): Promise<ReleaseReport> => {
  const report: ReleaseReport = { changed: 0, failed: 0 };
  for (const { row, month } of await matching(deps.db, filter, 'pending')) {
    const due = { ...row, month };
    try {
      const scheduled = await createScheduledTransfer(deps.execute, {
        transfer: buildReleaseTransfer(deps, due),
        memo: releaseMemo(month, row.agentID),
        expiresAt: row.expiresAt,
        payerAccountId: deps.coreAccountId,
        adminKey: deps.coreKey,
        now: deps.now?.()
      });
      if (scheduled.ok) {
        await setStatus(deps.db, row.id, {
          status: 'scheduled',
          scheduleID: scheduled.data.scheduleId
        });
        report.changed += 1;
        continue;
      }
      if (scheduled.data.reason === 'expiry_out_of_range') {
        await setStatus(deps.db, row.id, { status: 'expired' });
        report.changed += 1;
        continue;
      }
      report.failed += 1;
      console.error(`[releases]: schedule for ${row.id} rejected: ${scheduled.data.status}`);
    } catch (error) {
      report.failed += 1;
      console.error(`[releases]: schedule for ${row.id} failed`, error);
    }
  }
  return report;
};

// Reads each scheduled release's fate from the Mirror Node: executed, deleted, or expired unsigned
export const refreshReleases = async (
  deps: ReleaseDeps,
  filter: ReleaseFilter
): Promise<ReleaseReport> => {
  const report: ReleaseReport = { changed: 0, failed: 0 };
  const now = deps.now?.() ?? new Date();
  for (const { row } of await matching(deps.db, filter, 'scheduled')) {
    if (!row.scheduleID) continue;
    const seen = await deps.mirror.scheduleStatus(row.scheduleID);
    if (!seen.ok) {
      // A schedule the Mirror Node doesn't know yet is still fresh
      if (seen.data.reason !== 'not_found') report.failed += 1;
      continue;
    }
    const { status, executedAt } = seen.data;
    if (status === 'executed') {
      const at = executedAt ? new Date(Number(executedAt) * 1000) : now;
      await setStatus(deps.db, row.id, { status: 'executed', executedAt: at });
      report.changed += 1;
    } else if (status === 'deleted') {
      await setStatus(deps.db, row.id, { status: 'deleted' });
      report.changed += 1;
    } else if (now.getTime() >= row.expiresAt.getTime()) {
      await setStatus(deps.db, row.id, { status: 'expired' });
      report.changed += 1;
    }
  }
  return report;
};

export const toReleaseRow = (row: ReleaseRecord): ReleaseRow =>
  releaseRowSchema.parse({
    id: row.id,
    challanId: row.challanID,
    agentId: row.agentID,
    reserveAccountId: row.reserveAccountID,
    micro: row.micro.toString(),
    scheduleId: row.scheduleID,
    status: row.status,
    cosignedBy: row.cosignedBy
  });

export const listReleases = async (db: KoshaDb, filter: ReleaseFilter): Promise<ReleaseRow[]> =>
  (await matching(db, filter)).map(({ row }) => toReleaseRow(row));
