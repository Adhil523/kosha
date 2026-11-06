import type { quote } from './db/schema';
import type { VerifiableQuote } from '@kosha/hedera/transfer-verifier';
import { accountIdSchema, tokenIdSchema } from '@kosha/shared/ids';
import { amountSchema } from '@kosha/shared/money';
import { quoteMemo, type QuoteTransfer, quoteTransferSchema } from '@kosha/shared/x402-payment';

export type QuoteRow = typeof quote.$inferSelect;

// The legs a quote asks the payer to sign: the price to the API and, when TDS applies, the TDS to
// the payer's own reserve (mode C). /v1/quote shows them and /v1/verify checks against them.
export const quoteTransfers = (
  row: Pick<QuoteRow, 'payToAccountID' | 'reserveAccountID' | 'priceMicro' | 'tdsMicro'>
): QuoteTransfer[] => {
  const consideration = quoteTransferSchema.parse({
    account: row.payToAccountID,
    amount: row.priceMicro.toString(),
    leg: 'consideration'
  });
  if (row.tdsMicro === 0n) return [consideration];
  if (!row.reserveAccountID) throw new Error('[quote]: a quote with TDS has no reserve account');
  return [
    consideration,
    quoteTransferSchema.parse({
      account: row.reserveAccountID,
      amount: row.tdsMicro.toString(),
      leg: 'tds_reserve'
    })
  ];
};

// What the verifier checks, rebuilt from Core's own record of the quote. The request's
// paymentRequirements are the client's copy and are never trusted.
export const verifiableQuote = (
  row: QuoteRow,
  settlement: { feePayer: string; asset: string }
): VerifiableQuote => ({
  asset: tokenIdSchema.parse(settlement.asset),
  extra: {
    feePayer: accountIdSchema.parse(settlement.feePayer),
    kosha: {
      memo: quoteMemo(row.id),
      nodeAccountIds: row.nodeAccountIDs.map((id) => accountIdSchema.parse(id)),
      totalMicro: amountSchema.parse(row.totalMicro.toString()),
      transfers: quoteTransfers(row)
    }
  }
});
