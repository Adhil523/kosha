import {
  AccountId,
  Hbar,
  Timestamp,
  TokenId,
  TransactionId,
  TransferTransaction
} from '@hiero-ledger/sdk';
import type { AccountId as AccountIdString } from '@kosha/shared/ids';
import { amountToBigint, USDC_DECIMALS } from '@kosha/shared/money';
import { checkSplitQuote, type SplitQuoteProblem } from '@kosha/shared/split-quote';
import type { KoshaSplitRequirements } from '@kosha/shared/x402-payment';

const HBAR_AMOUNT_PATTERN = /^\d+(\.\d{1,8})?$/;
const NANOS_PER_MILLISECOND = 1_000_000;

// Every transaction ID shares Core's account, so two payers signing in the same millisecond would
// collide. Random nanoseconds inside that millisecond keep IDs apart without moving the valid start.
// Web Crypto, so the builder runs wherever Kosha Pay does (Node or a browser)
const jittered = (validStart: Date): Timestamp => {
  const [random = 0] = crypto.getRandomValues(new Uint32Array(1));
  return Timestamp.fromDate(validStart).plusNanos(random % NANOS_PER_MILLISECOND);
};

export type QuotedTransferOptions = {
  // MAX_TX_FEE_HBAR: the most Core, as fee payer, will pay for this transaction
  maxTransactionFeeHbar: string;
  // Tests pin this; in use it is the moment the payer signs
  validStart?: Date;
};

export type QuotedTransferProblem = SplitQuoteProblem | 'payer_is_recipient' | 'invalid_fee_cap';

export type QuotedTransfer =
  { ok: true; data: TransferTransaction } | { ok: false; data: { reason: QuotedTransferProblem } };

// Builds, and freezes, the one transaction a kosha-split quote describes: the payer is debited the
// total and each leg is credited, Core is the fee payer (its account is in the transaction ID),
// and the body is frozen for every quoted node. Kosha Pay signs exactly this; the verifier checks
// a signed transaction against the same quote.
export const buildQuotedTransfer = (
  requirements: KoshaSplitRequirements,
  payerAccountId: AccountIdString,
  { maxTransactionFeeHbar, validStart = new Date() }: QuotedTransferOptions
): QuotedTransfer => {
  const split = checkSplitQuote(requirements);
  if (!split.ok) return split;

  const { memo, nodeAccountIds, transfers } = requirements.extra.kosha;
  if (transfers.some((leg) => leg.account === payerAccountId)) {
    return { ok: false, data: { reason: 'payer_is_recipient' } };
  }
  if (!HBAR_AMOUNT_PATTERN.test(maxTransactionFeeHbar) || Number(maxTransactionFeeHbar) <= 0) {
    return { ok: false, data: { reason: 'invalid_fee_cap' } };
  }

  const token = TokenId.fromString(requirements.asset);
  const transaction = new TransferTransaction()
    .setTransactionId(
      TransactionId.withValidStart(
        AccountId.fromString(requirements.extra.feePayer),
        jittered(validStart)
      )
    )
    .setNodeAccountIds(nodeAccountIds.map((node) => AccountId.fromString(node)))
    .setTransactionMemo(memo)
    .setMaxTransactionFee(new Hbar(maxTransactionFeeHbar))
    .addTokenTransferWithDecimals(
      token,
      AccountId.fromString(payerAccountId),
      -split.data.totalMicro,
      USDC_DECIMALS
    );

  for (const leg of transfers) {
    transaction.addTokenTransferWithDecimals(
      token,
      AccountId.fromString(leg.account),
      amountToBigint(leg.amount),
      USDC_DECIMALS
    );
  }

  return { ok: true, data: transaction.freeze() };
};
