import type { ReceiverRow } from './auth';
import { pairLimits } from './pair-limits';
import { SCHEMES, X402_NETWORKS } from '@kosha/shared/headers';
import type { HederaNetwork } from '@kosha/shared/ids';
import { type ExactRequirements, exactRequirementsSchema } from '@kosha/shared/x402-payment';
import { decide, type Decision } from '@kosha/tax-engine/decide';
import type { RulePack } from '@kosha/tax-engine/rule-pack';

// Compatibility mode (A23): the plain `exact` entry any x402 v2 client can pay. It pays the
// all-in total to Kosha's settlement account; Core then forwards the price to the API and the
// TDS to the pooled reserve, booked to the payer.

export type CompatEntryInput = {
  quoteId: string;
  totalMicro: bigint;
  network: HederaNetwork;
  asset: string;
  feePayer: string;
  compatSettlementAccountId: string;
  maxTimeoutSeconds: number;
};

export const compatEntry = (input: CompatEntryInput): ExactRequirements =>
  exactRequirementsSchema.parse({
    scheme: SCHEMES.exact,
    network: X402_NETWORKS[input.network],
    asset: input.asset,
    payTo: input.compatSettlementAccountId,
    amount: input.totalMicro.toString(),
    maxTimeoutSeconds: input.maxTimeoutSeconds,
    extra: {
      feePayer: input.feePayer,
      kosha: { quoteId: input.quoteId, mode: 'compat' }
    }
  });

// A caller with no X-KOSHA-AGENT is unverified, so the receiver's unverified-payer policy prices
// it (spec Component 1). Core can't see that payer's year total until the transaction names it, so
// it never assumes the payer is still inside a tolerance: under threshold_tolerant the tolerance
// counts as used, and the payment is taxed at the no-PAN rate. That can over-deduct (a refundable
// credit in the pooled reserve) but never under-deduct. `strict` is 20% from the first rupee
// anyway, and a foreign receiver withholds nothing.
export const decideUnidentified = (
  pack: RulePack,
  receiver: ReceiverRow,
  priceMicroUsdc: bigint,
  inrPerUsdMicro: bigint
): Decision => {
  const { tolerancePaise } = pairLimits(pack, receiver, 'unknown');
  return decide({
    payer: { residency: 'unknown', panOnFile: false },
    receiver,
    priceMicroUsdc,
    inrPerUsdMicro,
    aggregatePaise: tolerancePaise ?? 0n,
    pack
  });
};
