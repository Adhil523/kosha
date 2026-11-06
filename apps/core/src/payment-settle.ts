import { bookCompatPayer } from './compat-payer';
import type { KoshaDb } from './db/client';
import { quote } from './db/schema';
import { type LedgerContext, recordSettlement, type SettlementOutcome } from './ledger';
import { type PaymentFailure, type VerifyDeps, verifyPayment } from './payment-verify';
import type { QuoteRow } from './quote-terms';
import type { TransferTransaction } from '@hiero-ledger/sdk';
import { type Executed, UNKNOWN_EXECUTION_STATUS } from '@kosha/hedera/executor';
import type { ErrorCode } from '@kosha/shared/error-codes';
import { SCHEMES } from '@kosha/shared/headers';
import { type AccountId, type HederaNetwork, quoteIdSchema } from '@kosha/shared/ids';
import type { PaymentPayload } from '@kosha/shared/x402-payment';
import { and, eq, isNull } from 'drizzle-orm';

const UNIQUE_VIOLATION = '23505';

export type SettleDeps = VerifyDeps & {
  network: HederaNetwork;
  // Where compatibility-mode TDS is held, booked to the payer (2-of-2 Core and compliance)
  poolReserveAccountId: string;
  ledger: LedgerContext;
  // Adds Core's signature as fee payer, submits, and waits for the receipt
  execute: (transaction: TransferTransaction) => Promise<Executed>;
  // After a receipt timeout: what the Mirror Node knows about the transaction
  reconcile: (transactionId: string) => Promise<'settled' | 'failed' | 'unknown'>;
};

export type SettledPayment = {
  quote: QuoteRow;
  payer: AccountId;
  transactionId: string;
  paymentId: string;
  // The pair's total for the year right after this payment, read under the pair's lock
  aggregatePaise: bigint;
};
export type SettleFailure = PaymentFailure & { transactionId?: string; status?: string };
export type SettleResult = { ok: true; data: SettledPayment } | { ok: false; data: SettleFailure };

const isUniqueViolation = (error: unknown): boolean => {
  const codeOf = (value: unknown): unknown =>
    typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined;
  const cause =
    typeof error === 'object' && error !== null && 'cause' in error ? error.cause : null;
  return codeOf(error) === UNIQUE_VIOLATION || codeOf(cause) === UNIQUE_VIOLATION;
};

// Marks the quote used by this transaction before anything executes, so a retried or concurrent
// settle can't spend it twice. False when another settle got there first, for this quote or with
// this transaction on another quote.
const claimQuote = async (
  db: KoshaDb,
  quoteId: string,
  transactionId: string,
  // A compatibility payment also books the quote to its payer, with the TDS pooled
  compat?: { agentID: string; reserveAccountID: string }
) => {
  try {
    const claimed = await db
      .update(quote)
      .set({
        usedTransactionID: transactionId,
        ...(compat ? { ...compat, scheme: 'exact_compat' as const } : {})
      })
      .where(and(eq(quote.id, quoteId), isNull(quote.usedTransactionID)))
      .returning({ id: quote.id });
    return claimed.length === 1;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
};

// Executes exactly once. A receipt that never arrived is resolved through the Mirror Node, never
// by submitting again.
const executeOnce = async (
  deps: SettleDeps,
  transaction: TransferTransaction,
  transactionId: string
): Promise<{ outcome: SettlementOutcome; status?: string }> => {
  const executed = await deps.execute(transaction);
  if (executed.ok) return { outcome: 'settled' };
  if (executed.data.status !== UNKNOWN_EXECUTION_STATUS) {
    return { outcome: 'failed', status: executed.data.status };
  }
  const seen = await deps.reconcile(transactionId);
  return { outcome: seen === 'unknown' ? 'pending' : seen, status: executed.data.status };
};

export const settlePayment = async (
  deps: SettleDeps,
  receiverId: string,
  payload: PaymentPayload
): Promise<SettleResult> => {
  const verified = await verifyPayment(deps, receiverId, payload);
  if (!verified.ok) return verified;
  const { quote: row, transaction, payer } = verified.data;
  const transactionId = transaction.transactionId?.toString() ?? '';
  const fail = (code: ErrorCode, status?: string): SettleResult => ({
    ok: false,
    data: { code, quoteId: quoteIdSchema.parse(row.id), transactionId, status }
  });

  const compat =
    verified.data.scheme === SCHEMES.exact
      ? {
          agentID: await bookCompatPayer(deps.db, deps.network, row.agentID, payer),
          reserveAccountID: deps.poolReserveAccountId
        }
      : undefined;
  if (!(await claimQuote(deps.db, row.id, transactionId, compat))) return fail('replay');
  const booked = compat ? { ...row, ...compat, scheme: 'exact_compat' as const } : row;

  const { outcome, status } = await executeOnce(deps, transaction, transactionId);
  const recorded = await recordSettlement(deps.db, deps.ledger, booked, transactionId, outcome);
  if (outcome === 'failed') return fail('settlement_failed', status);
  if (outcome === 'pending') return fail('settlement_pending', status);
  return {
    ok: true,
    data: {
      quote: booked,
      payer,
      transactionId,
      paymentId: recorded.paymentId,
      aggregatePaise: recorded.aggregatePaise
    }
  };
};
