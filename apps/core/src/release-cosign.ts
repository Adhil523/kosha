import { challan, release } from './db/schema';
import { refreshReleases, type ReleaseDeps, type ReleaseFilter, toReleaseRow } from './releases';
import { ScheduleSignTransaction, Transaction } from '@hiero-ledger/sdk';
import type { ReleaseCosign, ReleaseRow } from '@kosha/shared/tax-reports';
import { and, eq } from 'drizzle-orm';

// The agent operator's half of a release (A20): a ScheduleSignTransaction it froze and signed
// itself, which Core relays. With it the schedule has both keys of the reserve, so the transfer
// runs in the same transaction. Core never holds an agent key.

export type CosignResult =
  | { ok: true; data: ReleaseRow }
  | { ok: false; data: { status: 400 | 404 | 409 | 502; message: string } };

const fail = (status: 400 | 404 | 409 | 502, message: string): CosignResult => ({
  ok: false,
  data: { status, message }
});

const parseScheduleSign = (base64: string): ScheduleSignTransaction | null => {
  try {
    const parsed = Transaction.fromBytes(Buffer.from(base64, 'base64'));
    return parsed instanceof ScheduleSignTransaction ? parsed : null;
  } catch {
    return null;
  }
};

export const cosignRelease = async (
  deps: ReleaseDeps,
  filter: ReleaseFilter,
  id: string,
  body: ReleaseCosign
): Promise<CosignResult> => {
  const [row] = await deps.db.select().from(release).where(eq(release.id, id));
  if (!row) return fail(404, 'no such release');
  if (filter.receiverId) {
    const [own] = await deps.db
      .select({ id: challan.id })
      .from(challan)
      .where(and(eq(challan.id, row.challanID), eq(challan.receiverID, filter.receiverId)));
    if (!own) return fail(404, 'no such release');
  }
  if (row.status !== 'scheduled' || !row.scheduleID) {
    return fail(409, `the release is ${row.status}`);
  }

  const signed = parseScheduleSign(body.transaction);
  if (!signed) return fail(400, 'transaction is not a serialized ScheduleSignTransaction');
  if (signed.scheduleId?.toString() !== row.scheduleID) {
    return fail(400, `the transaction signs ${signed.scheduleId?.toString() ?? 'no schedule'}`);
  }

  const executed = await deps.execute(signed);
  if (!executed.ok) {
    return fail(502, `the network refused the signature: ${executed.data.status}`);
  }
  await deps.db
    .update(release)
    .set({ cosignedBy: signed.transactionId?.accountId?.toString() ?? 'unknown' })
    .where(eq(release.id, row.id));
  // With both signatures the transfer runs at once; the Mirror Node shows it a few seconds later
  await refreshReleases(deps, { challanId: row.challanID });
  const [current] = await deps.db.select().from(release).where(eq(release.id, row.id));
  return current ? { ok: true, data: toReleaseRow(current) } : fail(404, 'no such release');
};
