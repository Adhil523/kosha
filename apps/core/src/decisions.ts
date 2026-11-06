import { findAgentByIdentity } from './agent-identity';
import type { ReceiverRow } from './auth';
import { bookCompatPayer } from './compat-payer';
import type { KoshaDb } from './db/client';
import { decision, hcsOutbox } from './db/schema';
import type { FxSource } from './fx';
import { decisionConfirmedMessage, decisionMessage, pairId } from './hcs-messages';
import { addToAggregate } from './ledger';
import { pairTotalPaise, withPairLock } from './pair-total';
import type { ErrorCode } from '@kosha/shared/error-codes';
import {
  type DecideRequest,
  type DecideResponse,
  decideResponseSchema,
  type DecisionConfirm
} from '@kosha/shared/facilitator-api';
import { caip10AccountSchema, type HederaNetwork } from '@kosha/shared/ids';
import { decide } from '@kosha/tax-engine/decide';
import { financialYear } from '@kosha/tax-engine/ist-calendar';
import type { RulePack } from '@kosha/tax-engine/rule-pack';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

// Kosha's tax engine for facilitators that settle elsewhere (A24): decide on a payment, then
// confirm it once it settles on its own rail. Core never sees or signs that payment.

// Long enough for a payment on a slower rail to settle and be confirmed
export const DECISION_TTL_SECONDS = 900;

export type DecisionDeps = {
  db: KoshaDb;
  pack: RulePack;
  rulepackHash: string;
  fx: FxSource;
  network: HederaNetwork;
  pairSecret: string;
  paymentsTopicId: string;
  now?: () => Date;
};

export type DecisionResult =
  | { ok: true; data: DecideResponse }
  | { ok: false; data: { status: 400 | 404 | 409; code: ErrorCode; message: string } };

type DecisionPayer =
  | { agentId: string; residency: 'resident' | 'non_resident' | 'unknown'; panOnFile: boolean }
  | { reference: string; residency: 'resident' | 'non_resident' | 'unknown'; panOnFile: boolean };

type DecisionRow = typeof decision.$inferSelect;

const refuse = (status: 400 | 404 | 409, code: ErrorCode, message: string): DecisionResult => ({
  ok: false,
  data: { status, code, message }
});

const toResponse = (row: DecisionRow, hcsSequence: number | null): DecideResponse =>
  decideResponseSchema.parse({
    decisionId: row.id,
    rulepack: row.rulepack,
    rateBps: row.rateBps,
    valuePaise: row.valuePaise.toString(),
    tdsPaise: row.tdsPaise.toString(),
    tdsMicroUsdc: row.tdsMicro.toString(),
    reason: row.reason,
    flags: row.flags,
    hcsSequence
  });

// A Kosha agent by identity (an unknown CAIP-10 account becomes a Level 0 agent, as at quote), or
// the calling facilitator's own payer, known only by its reference and claims
const resolvePayer = async (
  deps: DecisionDeps,
  payer: DecideRequest['payer']
): Promise<DecisionPayer | null> => {
  if ('reference' in payer) return { reference: payer.reference, ...payer.claims };
  const known = await findAgentByIdentity(deps.db, payer.identity);
  if (known) return { agentId: known.id, residency: known.residency, panOnFile: known.panOnFile };
  const caip10 = caip10AccountSchema.safeParse(payer.identity);
  if (!caip10.success) return null;
  const account = caip10.data.split(':').at(-1) ?? '';
  const agentId = await bookCompatPayer(deps.db, deps.network, null, account);
  return { agentId, residency: 'unknown', panOnFile: false };
};

// A reference payer's year so far: its confirmed and still-open decisions with this receiver
const referenceTotalPaise = async (
  tx: KoshaDb,
  receiverId: string,
  reference: string,
  fy: string,
  now: Date
): Promise<bigint> => {
  const [row] = await tx
    .select({ value: sql<string>`coalesce(sum(${decision.valuePaise}), 0)::text` })
    .from(decision)
    .where(
      and(
        eq(decision.receiverID, receiverId),
        eq(decision.payerReference, reference),
        eq(decision.fy, fy),
        or(sql`${decision.confirmedAt} is not null`, gt(decision.expiresAt, now))
      )
    );
  return BigInt(row?.value ?? '0');
};

// Serialises a reference payer's decisions, as withPairLock does for an agent's
const withReferenceLock = <T>(db: KoshaDb, key: string, work: (tx: KoshaDb) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ref:${key}`}))`);
    return work(tx);
  });

export const decidePayment = async (
  deps: DecisionDeps,
  receiver: ReceiverRow,
  request: DecideRequest
): Promise<DecisionResult> => {
  const payer = await resolvePayer(deps, request.payer);
  if (!payer) {
    return refuse(400, 'payer_not_declared', 'unknown agent: register it with POST /v1/agents');
  }
  const now = deps.now?.() ?? new Date();
  const fy = financialYear(now, deps.pack.financialYearStart);
  const inrPerUsdMicro = request.inrPerUsdMicro
    ? BigInt(request.inrPerUsdMicro)
    : (await deps.fx.current()).inrPerUsdMicro;
  const price = BigInt(request.priceMicroUsdc);
  const pairKey = 'agentId' in payer ? payer.agentId : `ref:${payer.reference}`;

  const work = async (tx: KoshaDb, totalPaise: bigint) => {
    const decided = decide({
      payer,
      receiver,
      priceMicroUsdc: price,
      inrPerUsdMicro,
      aggregatePaise: totalPaise,
      pack: deps.pack
    });
    const [row] = await tx
      .insert(decision)
      .values({
        receiverID: receiver.id,
        agentID: 'agentId' in payer ? payer.agentId : null,
        payerReference: 'reference' in payer ? payer.reference : null,
        chain: request.chain,
        resource: request.resource ?? null,
        priceMicro: price,
        inrPerUsdMicro,
        valuePaise: decided.valuePaise,
        tdsPaise: decided.tdsPaise,
        tdsMicro: decided.tdsMicroUsdc,
        rateBps: decided.rateBps,
        reason: decided.reason,
        flags: decided.flags,
        rulepack: decided.rulepack,
        fy,
        expiresAt: new Date(now.getTime() + DECISION_TTL_SECONDS * 1000)
      })
      .returning();
    if (!row) throw new Error('[decisions]: the decision was not saved');
    await tx.insert(hcsOutbox).values({
      kind: 'decision',
      topicID: deps.paymentsTopicId,
      payload: decisionMessage({
        decisionId: row.id,
        chain: row.chain,
        rulepack: row.rulepack,
        rulepackHash: deps.rulepackHash,
        priceMicro: row.priceMicro,
        tdsMicro: row.tdsMicro,
        rateBps: row.rateBps,
        pair: pairId(deps.pairSecret, pairKey, receiver.id),
        fy,
        aggregatePaise: totalPaise + row.valuePaise
      })
    });
    return row;
  };

  const row =
    'agentId' in payer
      ? await withPairLock(
          deps.db,
          { agentId: payer.agentId, receiverId: receiver.id, fy },
          async (tx) =>
            work(
              tx,
              await pairTotalPaise(tx, { agentId: payer.agentId, receiverId: receiver.id, fy }, now)
            )
        )
      : await withReferenceLock(deps.db, `${payer.reference}:${receiver.id}:${fy}`, async (tx) =>
          work(tx, await referenceTotalPaise(tx, receiver.id, payer.reference, fy, now))
        );
  return { ok: true, data: toResponse(row, null) };
};

// The decision message's sequence, once the outbox has published it
const decisionSequence = async (db: KoshaDb, decisionId: string): Promise<number | null> => {
  const [row] = await db
    .select({ sequence: hcsOutbox.hcsSequence })
    .from(hcsOutbox)
    .where(and(eq(hcsOutbox.kind, 'decision'), sql`${hcsOutbox.payload}->>'did' = ${decisionId}`));
  return row?.sequence ?? null;
};

// The decided payment settled on its rail: its value joins the pair's total for good. Confirming
// again with the same reference answers the same decision; another reference is a conflict.
export const confirmDecision = async (
  deps: DecisionDeps,
  receiverId: string,
  decisionId: string,
  confirm: DecisionConfirm
): Promise<DecisionResult> => {
  const [row] = await deps.db
    .select()
    .from(decision)
    .where(and(eq(decision.id, decisionId), eq(decision.receiverID, receiverId)));
  if (!row) return refuse(404, 'not_found', 'no such decision for this receiver');
  if (confirm.chain !== row.chain) {
    return refuse(400, 'invalid_payload', `the decision was made for ${row.chain}`);
  }
  if (row.confirmedAt) {
    return row.transactionRef === confirm.transactionRef
      ? { ok: true, data: toResponse(row, await decisionSequence(deps.db, row.id)) }
      : refuse(409, 'replay', 'the decision was already confirmed with another transaction');
  }

  const now = deps.now?.() ?? new Date();
  const confirmOnce = async (tx: KoshaDb) => {
    const [updated] = await tx
      .update(decision)
      .set({ confirmedAt: now, transactionRef: confirm.transactionRef })
      .where(and(eq(decision.id, row.id), isNull(decision.confirmedAt)))
      .returning();
    if (!updated) return null;
    if (updated.agentID) {
      await addToAggregate(
        tx,
        { agentId: updated.agentID, receiverId, fy: updated.fy },
        updated.valuePaise
      );
    }
    await tx.insert(hcsOutbox).values({
      kind: 'decision_confirmed',
      topicID: deps.paymentsTopicId,
      payload: decisionConfirmedMessage({
        decisionId: updated.id,
        chain: updated.chain,
        transactionRef: confirm.transactionRef
      })
    });
    return updated;
  };
  const updated = row.agentID
    ? await withPairLock(deps.db, { agentId: row.agentID, receiverId, fy: row.fy }, confirmOnce)
    : await deps.db.transaction(confirmOnce);
  if (!updated) return refuse(409, 'replay', 'the decision was confirmed by another request');
  return { ok: true, data: toResponse(updated, await decisionSequence(deps.db, updated.id)) };
};
