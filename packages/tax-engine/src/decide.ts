import { ceilDiv, microUsdcToPaise, paiseToMicroUsdc } from './minor-units';
import { type RulePack } from './rule-pack';

const BPS_DENOMINATOR = 10_000n;

export type PayerResidency = 'resident' | 'non_resident' | 'unknown';
export type ReceiverResidency = 'resident' | 'non_resident';
export type ReceiverMode = 'threshold' | 'first_rupee';

export type DecisionReason =
  | 'receiver_non_resident'
  | 'non_resident'
  | 'under_threshold'
  | 'threshold_crossed'
  | 'first_rupee';

export type DecisionFlag = 'fema_review';

export type DecideInput = {
  payer: { residency: PayerResidency; panOnFile: boolean; specifiedPerson: boolean };
  receiver: { residency: ReceiverResidency };
  // What the API charges, in micro-USDC
  priceMicroUsdc: bigint;
  // Micro-rupees per USD, e.g. 88_400_000n = ₹88.40
  inrPerUsdMicro: bigint;
  // This payer → this receiver, this financial year, before this payment: settled value, plus
  // payments seen outside Kosha, plus the pair's open quotes. Counting open quotes means two
  // concurrent quotes can't both slip under the threshold.
  aggregatePaise: bigint;
  mode: ReceiverMode;
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

  // An unverified payer is a resident with no PAN, from the first rupee (pack.unknownPayer).
  const unknown = payer.residency === 'unknown';
  const rateBps = unknown || !payer.panOnFile ? pack.rates.noPanBps : pack.rates.standardBps;
  const firstRupee = unknown || input.mode === 'first_rupee';
  const threshold = payer.specifiedPerson
    ? pack.thresholds.specifiedBuyerPaise
    : pack.thresholds.otherBuyerPaise;
  const after = input.aggregatePaise + valuePaise;

  // "Above" the threshold: a year total exactly at it is still under.
  if (!firstRupee && after <= threshold) {
    return noTds(base, 'under_threshold');
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
    reason: firstRupee ? 'first_rupee' : 'threshold_crossed',
    flags: []
  };
};
