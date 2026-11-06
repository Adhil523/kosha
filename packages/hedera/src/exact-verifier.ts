import {
  checkTransferLegs,
  checkTransferLimits,
  decodeSignedTransfer,
  type VerifiedTransfer
} from './transfer-verifier';
import type { ErrorCode } from '@kosha/shared/error-codes';
import type { AccountId, TokenId } from '@kosha/shared/ids';
import type { Amount } from '@kosha/shared/money';

// The official x402 `exact` scheme on Hedera, as Core settles it in compatibility mode (A23). Any
// standard client builds this transaction, so unlike kosha-split there is no memo or node list to
// bind it to a quote: the payload's accepted entry carries the quote ID, and Core binds the
// transaction ID when it claims the quote.
export type ExactTerms = {
  asset: TokenId;
  // Kosha's compat settlement account
  payTo: AccountId;
  // The all-in total: price plus TDS
  amount: Amount;
  // Core
  feePayer: AccountId;
  maxTransactionFeeHbar: string;
  window: { notBefore: Date; notAfter: Date };
};

const failure = (code: ErrorCode) => ({ ok: false as const, data: { code } });

// Checks a signed exact payment: Core is the fee payer and moves nothing itself, the fee and
// valid start are inside Core's limits, and the only token movement is one payer debiting
// `amount` of the asset to payTo. The payer is whoever debits; Core identifies it afterwards.
export const verifyExactTransfer = (base64: string, terms: ExactTerms): VerifiedTransfer => {
  const decoded = decodeSignedTransfer(base64);
  if (!decoded.ok) return decoded;
  const { transaction } = decoded.data;

  if (transaction.transactionId?.accountId?.toString() !== terms.feePayer) {
    return failure('wrong_fee_payer');
  }
  const limits = checkTransferLimits(decoded.data, terms);
  if (!limits.ok) return limits;

  const legs = checkTransferLegs(transaction, {
    requirements: {
      asset: terms.asset,
      extra: {
        kosha: {
          totalMicro: terms.amount,
          transfers: [{ account: terms.payTo, amount: terms.amount, leg: 'consideration' }]
        }
      }
    },
    expectedReserveAccount: null
  });
  if (!legs.ok) return legs;
  if (legs.data.payer === terms.feePayer) return failure('fee_payer_transferring');
  return { ok: true, data: { transaction, payer: legs.data.payer } };
};
