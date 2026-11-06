import { ceilDiv, microUsdcToPaise, paiseToMicroUsdc } from './minor-units';
import { type RulePack, type UnverifiedPolicy } from './rule-pack';

const BPS_DENOMINATOR = 10_000n;

export type PayerResidency = 'resident' | 'non_resident' | 'unknown';
export type ReceiverResidency = 'resident' | 'non_resident';
export type ReceiverMode = 'threshold' | 'first_rupee';

export type DecisionReason =
  | 'receiver_non_resident'
  | 'non_resident'
  | 'under_threshold'
  | 'threshold_crossed'
  | 'within_tolerance'
  | 'tolerance_exceeded'
  | 'first_rupee';

export type DecisionFlag = 'fema_review';

export type DecideInput = {
  // The deductee (the agent): sets only the rate and non-resident status
  payer: { residency: PayerResidency; panOnFile: boolean };
  // The buyer and deductor (the API owner): sets the threshold, the mode and the policy for
  // unverified payers
  receiver: {
    residency: ReceiverResidency;
    specifiedPerson: boolean;
    mode: ReceiverMode;
    unverifiedPolicy: UnverifiedPolicy;
  };
  // The API's net price in micro-USDC: the tax base (pack.taxBase is "price")
  priceMicroUsdc: bigint;
  // Micro-rupees per USD, e.g. 88_400_000n = ₹88.40
  inrPerUsdMicro: bigint;
  // This payer → this receiver, this financial year, before this payment: settled value, plus
  // payments seen outside Kosha, plus the pair's open quotes. Counting open quotes means two
  // concurrent quotes can't both slip under the threshold.
  aggregatePaise: bigint;
  pack: RulePack;
};

export type Decision = {
  rulepack: string;
  applies: boolean;
  // INR value of this payment, rounded up
  valuePaise: bigint;
  tdsPaise: bigint;
  tdsMicroUsdc: bigint;
  rateBps: number;
  reason: DecisionReason;
  flags: DecisionFlag[];
};

const noTds = (
  base: Pick<Decision, 'rulepack' | 'valuePaise'>,
  reason: DecisionReason,
  flags: DecisionFlag[] = []
): Decision => ({
  ...base,
  applies: false,
  tdsPaise: 0n,
  tdsMicroUsdc: 0n,
  rateBps: 0,
  reason,
  flags
});

const minBigint = (a: bigint, b: bigint): bigint => (a < b ? a : b);

// The yearly threshold comes from the buyer (the receiver), never the payer.
const thresholdFor = ({ receiver, pack }: DecideInput, unverified: boolean): bigint => {
  const legal = receiver.specifiedPerson
    ? pack.thresholds.specifiedBuyerPaise
    : pack.thresholds.otherBuyerPaise;
  if (!unverified) {
    return legal;
  }
  return receiver.unverifiedPolicy === 'strict'
    ? 0n
    : minBigint(legal, pack.unverifiedPayer.toleranceLimitPaise);
};

// Decides the TDS on one payment. Pure: every input comes in, nothing is read or written.
// Every rounding goes up, so the result never under-deducts.
export const decide = (input: DecideInput): Decision => {
  const { payer, receiver, pack } = input;
  if (input.aggregatePaise < 0n) {
    throw new RangeError('[decide]: aggregatePaise must not be negative');
  }

  const valuePaise = microUsdcToPaise(input.priceMicroUsdc, input.inrPerUsdMicro);
  const base = { rulepack: pack.id, valuePaise };

  // A foreign API is not an Indian deductor: record the payment, withhold nothing, flag it.
  if (receiver.residency === 'non_resident') {
    return noTds(base, 'receiver_non_resident', ['fema_review']);
  }
  if (payer.residency === 'non_resident') {
    return noTds(base, 'non_resident', ['fema_review']);
  }

  // An unverified payer pays the no-PAN rate. Its threshold is the receiver's choice: none under
  // "strict", or the lower of the legal threshold and the pack's tolerance.
  const unverified = payer.residency === 'unknown';
  const rateBps = unverified || !payer.panOnFile ? pack.rates.noPanBps : pack.rates.standardBps;
  const threshold = thresholdFor(input, unverified);
  const firstRupee = receiver.mode === 'first_rupee' || threshold === 0n;
  const after = input.aggregatePaise + valuePaise;

  // "Above" the threshold: a year total exactly at it is still under.
  if (!firstRupee && after <= threshold) {
    return noTds(base, unverified ? 'within_tolerance' : 'under_threshold');
  }

  const crossesNow = input.aggregatePaise < threshold;
  const taxablePaise =
    !firstRupee && pack.crossing === 'excess' && crossesNow ? after - threshold : valuePaise;
  const tdsPaise = ceilDiv(taxablePaise * BigInt(rateBps), BPS_DENOMINATOR);

  return {
    ...base,
    applies: true,
    tdsPaise,
    tdsMicroUsdc: paiseToMicroUsdc(tdsPaise, input.inrPerUsdMicro),
    rateBps,
    reason: firstRupee ? 'first_rupee' : unverified ? 'tolerance_exceeded' : 'threshold_crossed',
    flags: []
  };
};
