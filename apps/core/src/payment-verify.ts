import { loadPolicy } from './agent-policy';
import { committedSpend } from './agent-spend';
import type { KoshaDb } from './db/client';
import { agentWallet, quote } from './db/schema';
import { type QuoteRow, verifiableQuote } from './quote-terms';
import { checkSpendPolicy } from './spend-policy';
import type { TransferTransaction } from '@hiero-ledger/sdk';
import { verifyExactTransfer } from '@kosha/hedera/exact-verifier';
import type { PayerKeyLookup } from '@kosha/hedera/payer-key';
import { verifyPayerSignature, verifyTransfer } from '@kosha/hedera/transfer-verifier';
import type { ErrorCode } from '@kosha/shared/error-codes';
import { SCHEMES } from '@kosha/shared/headers';
import { type AccountId, accountIdSchema, type QuoteId, tokenIdSchema } from '@kosha/shared/ids';
import { bigintToAmount } from '@kosha/shared/money';
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
  // payTo of the exact compatibility entry
  compatSettlementAccountId: string;
  payerKey: PayerKeyLookup;
  now?: () => Date;
};

export type VerifiedPayment = {
  quote: QuoteRow;
  // kosha-split, or exact for compatibility mode
  scheme: PaymentPayload['accepted']['scheme'];
  transaction: TransferTransaction;
  payer: AccountId;
};
export type PaymentFailure = { code: ErrorCode; quoteId: QuoteId | null };
export type PaymentCheck =
  { ok: true; data: VerifiedPayment } | { ok: false; data: PaymentFailure };

// The agent that declared this account as a wallet, if any
export const walletOwner = async (db: KoshaDb, accountId: string): Promise<string | null> => {
  const [owner] = await db
    .select({ agentID: agentWallet.agentID })
    .from(agentWallet)
    .where(eq(agentWallet.accountID, accountId));
  return owner?.agentID ?? null;
};

// Everything Core checks before it signs as fee payer: the stored quote (the receiver's own, unexpired,
// unused), the transaction against that quote, the payer as a declared wallet of the quoted agent,
// the agent's spending policy, and the payer's signature with its key from the Mirror Node.
export const verifyPayment = async (
  deps: VerifyDeps,
  receiverId: string,
  payload: PaymentPayload
): Promise<PaymentCheck> => {
  const { accepted } = payload;
  const split = accepted.scheme === SCHEMES.koshaSplit;
  // A stock exact client echoes the accepted entry verbatim, so the quote ID rides along in extra
  const quoteId = split ? accepted.extra.kosha.quoteId : (accepted.extra.kosha?.quoteId ?? null);
  if (!quoteId) return { ok: false, data: { code: 'quote_not_found', quoteId: null } };
  const fail = (code: ErrorCode): PaymentCheck => ({ ok: false, data: { code, quoteId } });

  const [row] = await deps.db
    .select()
    .from(quote)
    .where(and(eq(quote.id, quoteId), eq(quote.receiverID, receiverId)));
  if (!row) return fail('quote_not_found');
  const now = deps.now?.() ?? new Date();
  if (now > row.expiresAt) return fail('quote_expired');
  if (row.usedTransactionID) return fail('replay');
  // A quote made for an unidentified caller has only the compatibility entry
  if (split && row.scheme !== 'kosha_split') return fail('unsupported_scheme');
  // The echoed entry must carry the terms Core issued. Gate prices the route from accepted.amount,
  // so a quote for a cheaper route must not pass by raising that amount.
  const issued = split
    ? { amount: row.priceMicro, payTo: row.payToAccountID }
    : { amount: row.totalMicro, payTo: deps.compatSettlementAccountId };
  const echoed =
    accepted.amount === issued.amount.toString() &&
    accepted.payTo === issued.payTo &&
    accepted.asset === deps.settlementTokenId;
  if (!echoed) return fail('amount_mismatch');

  const window = {
    notBefore: new Date(row.createdAt.getTime() - CLOCK_SKEW_SECONDS * 1000),
    notAfter: row.expiresAt
  };
  const checked = split
    ? verifyTransfer(payload.payload.transaction, {
        requirements: verifiableQuote(row, {
          feePayer: deps.feePayer,
          asset: deps.settlementTokenId
        }),
        maxTransactionFeeHbar: deps.maxTransactionFeeHbar,
        window,
        expectedReserveAccount: accountIdSchema.nullable().parse(row.reserveAccountID)
      })
    : verifyExactTransfer(payload.payload.transaction, {
        asset: tokenIdSchema.parse(deps.settlementTokenId),
        payTo: accountIdSchema.parse(deps.compatSettlementAccountId),
        amount: bigintToAmount(row.totalMicro),
        feePayer: accountIdSchema.parse(deps.feePayer),
        maxTransactionFeeHbar: deps.maxTransactionFeeHbar,
        window
      });
  if (!checked.ok) return fail(checked.data.code);
  const { transaction, payer } = checked.data;

  const transactionId = transaction.transactionId?.toString() ?? '';
  const [spent] = await deps.db
    .select({ id: quote.id })
    .from(quote)
    .where(eq(quote.usedTransactionID, transactionId));
  if (spent) return fail('replay');

  // A quote made for an agent is paid from one of its wallets. A compatibility quote made for an
  // unidentified caller is paid by whoever signs; settle books it to that account's agent.
  if (split && !row.agentID) return fail('payer_not_declared');
  if (row.agentID) {
    const [declared] = await deps.db
      .select({ id: agentWallet.id })
      .from(agentWallet)
      .where(and(eq(agentWallet.accountID, payer), eq(agentWallet.agentID, row.agentID)));
    if (!declared) return fail('payer_not_declared');
  }
  const agentId = row.agentID ?? (await walletOwner(deps.db, payer));

  // Checked again here, so a cap the owner tightened after the quote still holds
  const rules = agentId ? await loadPolicy(deps.db, agentId) : null;
  if (rules && agentId) {
    const allowed = checkSpendPolicy({
      rules,
      resourceUrl: row.resource,
      totalMicro: row.totalMicro,
      reason: row.reason,
      spent: await committedSpend(deps.db, {
        agentId,
        fy: row.fy,
        now,
        excludeQuoteId: row.id
      })
    });
    if (!allowed.ok) return fail(allowed.data.code);
  }

  const key = await deps.payerKey(payer);
  if (!key.ok)
    return fail(key.data.reason === 'unavailable' ? 'core_unavailable' : 'bad_signature');
  const signed = verifyPayerSignature(transaction, key.data);
  if (!signed.ok) return fail(signed.data.code);

  return { ok: true, data: { quote: row, transaction, payer, scheme: accepted.scheme } };
};
