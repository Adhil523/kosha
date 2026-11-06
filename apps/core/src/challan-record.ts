import type { KoshaDb } from './db/client';
import { challan, hcsOutbox, receiver, receiverWallet, release } from './db/schema';
import { challanMessage, receiverRef } from './hcs-messages';
import { closeRows, monthBounds, totalTdsPaise } from './monthly-close';
import { listReleases, RELEASE_WINDOW_MS, type ReleaseDeps, scheduleDue } from './releases';
import {
  type ChallanRecord,
  type ChallanRow,
  challanRowSchema,
  type ReleaseRow
} from '@kosha/shared/tax-reports';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

// Recording the challan (A20): the deductor paid the month's TDS in INR on the income-tax portal.
// Core keeps a hash of the reference, logs it to HCS, and opens one reserve release per payer.

export type ChallanDeps = {
  db: KoshaDb;
  pairSecret: string;
  paymentsTopicId: string;
  releases: ReleaseDeps;
};

export type Recorded = { challan: ChallanRow; releases: ReleaseRow[] };
export type RecordResult =
  { ok: true; data: Recorded } | { ok: false; data: { status: 400 | 404 | 409; message: string } };

type ChallanRecordRow = typeof challan.$inferSelect;

// Plain SHA-256, so the deductor can later prove which reference the hash stands for
export const hashChallanRef = (challanRef: string): string =>
  createHash('sha256').update(challanRef).digest('hex');

// The HCS sequence of the challan's message, once the outbox has published it
const challanSequence = async (db: KoshaDb, id: string): Promise<number | null> => {
  const [row] = await db
    .select({ sequence: hcsOutbox.hcsSequence })
    .from(hcsOutbox)
    .where(and(eq(hcsOutbox.kind, 'challan'), sql`${hcsOutbox.payload}->>'cid' = ${id}`));
  return row?.sequence ?? null;
};

const toChallanRow = (row: ChallanRecordRow, hcsSequence: number | null): ChallanRow =>
  challanRowSchema.parse({
    id: row.id,
    receiverId: row.receiverID,
    month: row.month,
    tdsPaise: row.tdsPaise.toString(),
    recordedAt: row.recordedAt.toISOString(),
    hcsSequence
  });

// A receiver's challans, newest month first (admin: any receiver, or all of them)
export const listChallans = async (
  db: KoshaDb,
  receiverId: string | undefined
): Promise<ChallanRow[]> => {
  const rows = await db
    .select()
    .from(challan)
    .where(receiverId ? eq(challan.receiverID, receiverId) : undefined)
    .orderBy(desc(challan.month), asc(challan.receiverID));
  return Promise.all(rows.map(async (row) => toChallanRow(row, await challanSequence(db, row.id))));
};

export const recordChallan = async (
  deps: ChallanDeps,
  body: ChallanRecord,
  now = new Date()
): Promise<RecordResult> => {
  const bounds = monthBounds(body.month);
  if (!bounds) return { ok: false, data: { status: 400, message: 'month must be YYYY-MM' } };
  const [deductor] = await deps.db
    .select({ id: receiver.id, wallet: receiverWallet.accountID })
    .from(receiver)
    .leftJoin(receiverWallet, eq(receiverWallet.receiverID, receiver.id))
    .where(eq(receiver.id, body.receiverId))
    .orderBy(asc(receiverWallet.createdAt));
  if (!deductor) return { ok: false, data: { status: 404, message: 'no such receiver' } };
  if (!deductor.wallet) {
    return {
      ok: false,
      data: { status: 400, message: 'the receiver has no wallet to release to' }
    };
  }
  const [existing] = await deps.db
    .select({ id: challan.id })
    .from(challan)
    .where(and(eq(challan.receiverID, body.receiverId), eq(challan.month, body.month)));
  if (existing) {
    return { ok: false, data: { status: 409, message: `${body.month} is already closed` } };
  }
  const rows = await closeRows(deps.db, body.receiverId, bounds);
  if (rows.length === 0) {
    return { ok: false, data: { status: 400, message: `no TDS was withheld in ${body.month}` } };
  }

  const toAccountID = deductor.wallet;
  const recorded = await deps.db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(challan)
      .values({
        receiverID: body.receiverId,
        month: body.month,
        tdsPaise: totalTdsPaise(rows),
        challanRefHash: hashChallanRef(body.challanRef),
        recordedAt: now
      })
      .returning();
    if (!saved) throw new Error('[challan]: the challan row was not saved');
    await tx.insert(release).values(
      rows.map((row) => ({
        challanID: saved.id,
        agentID: row.agentId,
        reserveAccountID: row.reserveAccountId,
        toAccountID,
        micro: row.tdsMicro,
        expiresAt: new Date(now.getTime() + RELEASE_WINDOW_MS)
      }))
    );
    await tx.insert(hcsOutbox).values({
      kind: 'challan',
      topicID: deps.paymentsTopicId,
      payload: challanMessage({
        challanId: saved.id,
        receiver: receiverRef(deps.pairSecret, saved.receiverID),
        month: saved.month,
        tdsPaise: saved.tdsPaise,
        challanRefHash: saved.challanRefHash
      })
    });
    return saved;
  });

  // The schedules go on chain after the rows are safe; a refused one is retried on the next read
  await scheduleDue(deps.releases, { challanId: recorded.id });
  return {
    ok: true,
    data: {
      challan: toChallanRow(recorded, null),
      releases: await listReleases(deps.db, { challanId: recorded.id })
    }
  };
};
