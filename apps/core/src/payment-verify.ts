import type { KoshaDb } from './db/client';
import { agentWallet, quote } from './db/schema';
import { type QuoteRow, verifiableQuote } from './quote-terms';
import type { TransferTransaction } from '@hiero-ledger/sdk';
import type { PayerKeyLookup } from '@kosha/hedera/payer-key';
import { verifyPayerSignature, verifyTransfer } from '@kosha/hedera/transfer-verifier';
import type { ErrorCode } from '@kosha/shared/error-codes';
import { SCHEMES } from '@kosha/shared/headers';
import { type AccountId, accountIdSchema, type QuoteId } from '@kosha/shared/ids';
import type { PaymentPayload } from '@kosha/shared/x402-payment';
import { and, eq } from 'drizzle-orm';

// A payer may sign a little before Core's clock says the quote was issued
export const CLOCK_SKEW_SECONDS = 30;

export type VerifyDeps = {
  db: KoshaDb;
  // Core: fee payer of every settlement
  feePayer: string;
  settlementTokenId: string;
  maxTransactionFeeHbar: string;
  payerKey: PayerKeyLookup;
  now?: () => Date;
};

export type VerifiedPayment = {
  quote: QuoteRow;
  transaction: TransferTransaction;
  payer: AccountId;
};
export type PaymentFailure = { code: ErrorCode; quoteId: QuoteId | null };
export type PaymentCheck =
  { ok: true; data: VerifiedPayment } | { ok: false; data: PaymentFailure };

// Everything Core checks before it signs as fee payer: the stored quote (the receiver's own, unexpired,
// unused), the transaction against that quote, the payer as a declared wallet of the quoted agent,
// and the payer's signature with its key from the Mirror Node.
export const verifyPayment = async (
  deps: VerifyDeps,
  receiverId: string,
  payload: PaymentPayload
): Promise<PaymentCheck> => {
  const { accepted } = payload;
  if (accepted.scheme !== SCHEMES.koshaSplit) {
    return { ok: false, data: { code: 'unsupported_scheme', quoteId: null } };
  }
  const { quoteId } = accepted.extra.kosha;
  const fail = (code: ErrorCode): PaymentCheck => ({ ok: false, data: { code, quoteId } });

  const [row] = await deps.db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.receiverID, receiverId)));
  if (!row) return fail('quote_not_found');
  const now = deps.now?.() ?? new Date();
  if (now > row.expiresAt) return fail('quote_expired');
  if (row.usedTransactionID) return fail('replay');

  const checked = verifyTransfer(payload.payload.transaction, {
    requirements: verifiableQuote(row, {
      feePayer: deps.feePayer,
      asset: deps.settlementTokenId
    }),
    maxTransactionFeeHbar: deps.maxTransactionFeeHbar,
    window: {
      notBefore: new Date(row.createdAt.getTime() - CLOCK_SKEW_SECONDS * 1000),
      notAfter: row.expiresAt
    },
    expectedReserveAccount: accountIdSchema.nullable().parse(row.reserveAccountID)
  });
  if (!checked.ok) return fail(checked.data.code);
  const { transaction, payer } = checked.data;

  const transactionId = transaction.transactionId?.toString() ?? '';
  const [spent] = await deps.db
    .select({ id: quote.id })
    .from(quote)
    .where(eq(quote.usedTransactionID, transactionId));
  if (spent) return fail('replay');

  if (!row.agentID) return fail('payer_not_declared');
  const [declared] = await deps.db
    .select({ id: agentWallet.id })
    .from(agentWallet)
    .where(and(eq(agentWallet.accountID, payer), eq(agentWallet.agentID, row.agentID)));
  if (!declared) return fail('payer_not_declared');

  const key = await deps.payerKey(payer);
  if (!key.ok)
    return fail(key.data.reason === 'unavailable' ? 'core_unavailable' : 'bad_signature');
  const signed = verifyPayerSignature(transaction, key.data);
  if (!signed.ok) return fail(signed.data.code);

  return { ok: true, data: { quote: row, transaction, payer } };
};
