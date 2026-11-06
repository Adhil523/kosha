import type { KoshaDb } from './db/client';
import { hcsOutbox, outsidePayment } from './db/schema';
import { pairId } from './hcs-messages';
import { addOutsideToAggregate } from './ledger';
import { outsideMessage, outsideSequence, toOutsideRow } from './outside-watcher';
import { withPairLock } from './pair-total';
import type { OutsidePaymentRow } from '@kosha/shared/console-api';
import type { OutsideClassify } from '@kosha/shared/tax-reports';
import { and, desc, eq } from 'drizzle-orm';

export type ClassifyDeps = { db: KoshaDb; pairSecret: string; paymentsTopicId: string };

export type ClassifyResult =
  | { ok: true; data: OutsidePaymentRow }
  | { ok: false; data: { status: 404 | 409; message: string } };

// A receiver's flagged payments, newest first (admin: any receiver, or all of them)
export const listOutsidePayments = async (
  db: KoshaDb,
  receiverId: string | undefined
): Promise<OutsidePaymentRow[]> => {
  const rows = await db
    .select()
    .from(outsidePayment)
    .where(receiverId ? eq(outsidePayment.receiverID, receiverId) : undefined)
    .orderBy(desc(outsidePayment.consensusAt));
  return Promise.all(rows.map(async (row) => toOutsideRow(row, await outsideSequence(db, row.id))));
};

// The owner says what a flagged payment was. Consideration keeps counting toward the threshold; a
// gift (with a note) leaves the count. Either way the decision is logged to HCS. Once only.
export const classifyOutside = async (
  deps: ClassifyDeps,
  scope: { receiverId: string | undefined },
  id: string,
  body: OutsideClassify
): Promise<ClassifyResult> => {
  const [row] = await deps.db
    .select()
    .from(outsidePayment)
    .where(
      and(
        eq(outsidePayment.id, id),
        scope.receiverId ? eq(outsidePayment.receiverID, scope.receiverId) : undefined
      )
    );
  if (!row) return { ok: false, data: { status: 404, message: 'no such outside payment' } };
  if (row.classification !== 'pending') {
    return {
      ok: false,
      data: { status: 409, message: `already classified as ${row.classification}` }
    };
  }

  const pair = { agentId: row.agentID, receiverId: row.receiverID, fy: row.fy };
  const updated = await withPairLock(deps.db, pair, async (tx) => {
    const [saved] = await tx
      .update(outsidePayment)
      .set({
        classification: body.classification,
        note: body.note ?? null,
        classifiedAt: new Date()
      })
      .where(and(eq(outsidePayment.id, row.id), eq(outsidePayment.classification, 'pending')))
      .returning();
    if (!saved) return null;
    if (saved.classification === 'not_consideration_gift') {
      await addOutsideToAggregate(tx, pair, -saved.valuePaise);
    }
    await tx.insert(hcsOutbox).values({
      kind: 'outside_resolved',
      topicID: deps.paymentsTopicId,
      payload: outsideMessage(
        'outside_resolved',
        saved,
        pairId(deps.pairSecret, pair.agentId, pair.receiverId)
      )
    });
    return saved;
  });
  if (!updated)
    return { ok: false, data: { status: 409, message: 'classified by another request' } };
  return { ok: true, data: toOutsideRow(updated, await outsideSequence(deps.db, updated.id)) };
};
