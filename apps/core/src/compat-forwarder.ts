import type { KoshaDb } from './db/client';
import { payment, quote } from './db/schema';
import {
  AccountId,
  Hbar,
  TokenId,
  type Transaction,
  TransactionId,
  TransferTransaction
} from '@hiero-ledger/sdk';
import type { Executed } from '@kosha/hedera/executor';
import { UNKNOWN_EXECUTION_STATUS } from '@kosha/hedera/executor';
import { and, eq, isNull } from 'drizzle-orm';

// Compatibility mode's second transaction (A23): from Kosha's settlement account, the price to the
// API and the TDS to the pooled reserve, booked to the payer by the payment row. The settlement
// account has Core's key, so Core signs it as fee payer and sender at once.

const BATCH_SIZE = 20;
// A Hedera transaction is valid for 180 s; an attempt the Mirror Node still doesn't know after
// this can never land, so a new one is safe
export const FORWARD_EXPIRY_MS = 240_000;

export type ForwarderDeps = {
  db: KoshaDb;
  // Core's operator client: freezes, signs and submits
  execute: (transaction: Transaction) => Promise<Executed>;
  reconcile: (transactionId: string) => Promise<'settled' | 'failed' | 'unknown'>;
  coreAccountId: string;
  compatSettlementAccountId: string;
  poolReserveAccountId: string;
  settlementTokenId: string;
  maxTransactionFeeHbar: string;
  now?: () => Date;
};

export type ForwardReport = { forwarded: number; failed: number };

type Due = {
  paymentId: string;
  quoteId: string;
  attempt: string | null;
  attemptedAt: Date;
  priceMicro: bigint;
  tdsMicro: bigint;
  apiAccountId: string;
};

export const buildForward = (deps: ForwarderDeps, due: Due): TransferTransaction => {
  const token = TokenId.fromString(deps.settlementTokenId);
  const forward = new TransferTransaction()
    .setTransactionId(TransactionId.generate(AccountId.fromString(deps.coreAccountId)))
    .setTransactionMemo(`kosha-fwd:${due.quoteId}`)
    .setMaxTransactionFee(new Hbar(deps.maxTransactionFeeHbar))
    .addTokenTransfer(token, deps.compatSettlementAccountId, -(due.priceMicro + due.tdsMicro))
    .addTokenTransfer(token, due.apiAccountId, due.priceMicro);
  return due.tdsMicro > 0n
    ? forward.addTokenTransfer(token, deps.poolReserveAccountId, due.tdsMicro)
    : forward;
};

const confirm = (db: KoshaDb, paymentId: string, at: Date) =>
  db.update(payment).set({ forwardedAt: at }).where(eq(payment.id, paymentId));

// Drops a failed or expired attempt, so the next pass builds a new transaction
const release = (db: KoshaDb, paymentId: string) =>
  db.update(payment).set({ forwardTransactionID: null }).where(eq(payment.id, paymentId));

// Settled compatibility payments not yet forwarded
const dueForwards = (db: KoshaDb): Promise<Due[]> =>
  db
    .select({
      paymentId: payment.id,
      quoteId: quote.id,
      attempt: payment.forwardTransactionID,
      attemptedAt: payment.updatedAt,
      priceMicro: payment.priceMicro,
      tdsMicro: payment.tdsMicro,
      apiAccountId: quote.payToAccountID
    })
    .from(payment)
    .innerJoin(quote, eq(quote.id, payment.quoteID))
    .where(
      and(
        eq(quote.scheme, 'exact_compat'),
        eq(payment.status, 'settled'),
        eq(payment.sample, false),
        isNull(payment.forwardedAt)
      )
    )
    .limit(BATCH_SIZE);

// One forward: an attempt in flight is resolved through the Mirror Node, never resubmitted. A new
// attempt records its transaction ID before it executes, so a crash mid-flight is found next pass.
const forwardOne = async (deps: ForwarderDeps, due: Due, now: Date): Promise<boolean> => {
  if (due.attempt) {
    const seen = await deps.reconcile(due.attempt);
    if (seen === 'settled') await confirm(deps.db, due.paymentId, now);
    const expired = now.getTime() - due.attemptedAt.getTime() > FORWARD_EXPIRY_MS;
    if (seen === 'failed' || (seen === 'unknown' && expired)) await release(deps.db, due.paymentId);
    return seen === 'settled';
  }

  const forward = buildForward(deps, due);
  const attempt = forward.transactionId?.toString() ?? '';
  const claimed = await deps.db
    .update(payment)
    .set({ forwardTransactionID: attempt, updatedAt: now })
    .where(and(eq(payment.id, due.paymentId), isNull(payment.forwardTransactionID)))
    .returning({ id: payment.id });
  if (claimed.length === 0) return false;

  const executed = await deps.execute(forward);
  if (executed.ok) {
    await confirm(deps.db, due.paymentId, now);
    return true;
  }
  // A receipt timeout may still land: leave the attempt for the Mirror Node to resolve
  if (executed.data.status !== UNKNOWN_EXECUTION_STATUS) await release(deps.db, due.paymentId);
  return false;
};

export const forwardDue = async (deps: ForwarderDeps): Promise<ForwardReport> => {
  const now = deps.now?.() ?? new Date();
  const report: ForwardReport = { forwarded: 0, failed: 0 };
  for (const due of await dueForwards(deps.db)) {
    try {
      if (await forwardOne(deps, due, now)) report.forwarded += 1;
      else report.failed += 1;
    } catch (error) {
      report.failed += 1;
      console.error(`[compat-forwarder]: payment ${due.paymentId} was not forwarded`, error);
    }
  }
  return report;
};
