import type { ReceiverMode } from '@kosha/tax-engine/decide';
import type { RulePack, UnverifiedPolicy } from '@kosha/tax-engine/rule-pack';

export type PairLimits = {
  // The receiver's yearly threshold: ₹50,000 for a specified person, ₹10,000 otherwise
  thresholdPaise: bigint;
  // An unverified payer under a threshold-tolerant receiver pays no tax up to this, then 20%
  tolerancePaise: bigint | null;
};

const PERCENT_SCALE = 10_000n;

// The limits decide() applies to one pair, for the Console's threshold counter. Same rules as
// decide(): the threshold comes from the receiver, and only an unverified payer has a tolerance.
// A first-rupee receiver has neither: every payment is taxed from the first rupee.
export const pairLimits = (
  pack: RulePack,
  receiver: { mode: ReceiverMode; specifiedPerson: boolean; unverifiedPolicy: UnverifiedPolicy },
  payerResidency: 'resident' | 'non_resident' | 'unknown'
): PairLimits => {
  if (receiver.mode === 'first_rupee') return { thresholdPaise: 0n, tolerancePaise: null };
  const thresholdPaise = receiver.specifiedPerson
    ? pack.thresholds.specifiedBuyerPaise
    : pack.thresholds.otherBuyerPaise;
  const tolerant =
    payerResidency === 'unknown' && receiver.unverifiedPolicy === 'threshold_tolerant';
  const tolerance = pack.unverifiedPayer.toleranceLimitPaise;
  return {
    thresholdPaise,
    tolerancePaise: tolerant ? (tolerance < thresholdPaise ? tolerance : thresholdPaise) : null
  };
};

// Share of the nearer limit reached, to two decimals. Display only: never feeds a tax decision.
export const pctOfLimit = (totalPaise: bigint, limits: PairLimits): number => {
  const limit = limits.tolerancePaise ?? limits.thresholdPaise;
  if (limit === 0n) return 100;
  return Number((totalPaise * PERCENT_SCALE) / limit) / 100;
};
