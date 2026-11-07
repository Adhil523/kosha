import type { AggregateRow } from '@kosha/shared/console-api';
import { amountToBigint } from '@kosha/shared/money';

// The counter turns amber at 90% of the nearer limit (spec Component 4, widget 1)
export const NEAR_PCT = 90;
const FULL_PCT = 100;
const MICRO_PER_USD = 1_000_000n;
const FX_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

export type CounterState = {
  // Bar fill and tolerance marker, as a share of the receiver's threshold (0–100)
  fillPct: number;
  tolerancePct: number | null;
  near: boolean;
  crossed: boolean;
  // A first-rupee receiver (Kosha's default) has no threshold: every payment is taxed
  firstRupee: boolean;
  status: string;
};

// Core reports a first-rupee receiver's pairs with a zero threshold and no tolerance
export const isFirstRupee = (row: AggregateRow): boolean =>
  amountToBigint(row.thresholdPaise) === 0n;

const shareOf = (part: bigint, whole: bigint): number =>
  whole === 0n ? FULL_PCT : Math.min(FULL_PCT, Number((part * 10_000n) / whole) / 100);

// What happens after the crossing depends on the payer: a verified resident pays 1%, an
// unverified payer 20% (until Level 1), a non-resident is outside this section entirely.
const crossedStatus = (row: AggregateRow): string => {
  if (row.payerResidency === 'non_resident') return 'Non-resident: no TDS here';
  return row.agentLevel === 0 ? '20% reserved' : '1% reserved';
};

export const counterState = (row: AggregateRow): CounterState => {
  const value = amountToBigint(row.valuePaise) + amountToBigint(row.outsideValuePaise);
  const threshold = amountToBigint(row.thresholdPaise);
  const firstRupee = isFirstRupee(row);
  const near = !firstRupee && row.pct >= NEAR_PCT;
  const crossed = firstRupee || row.pct >= FULL_PCT;
  return {
    fillPct: shareOf(value, threshold),
    tolerancePct:
      row.tolerancePaise === null ? null : shareOf(amountToBigint(row.tolerancePaise), threshold),
    near,
    crossed,
    firstRupee,
    status: crossed ? crossedStatus(row) : near ? 'Nearing the limit' : 'Under the limit'
  };
};

// "88.40" (INR per USD) → 8840n paise per USD; null when the env value is malformed
export const parseFxPaisePerUsd = (inrPerUsd: string | undefined): bigint | null => {
  const match = FX_PATTERN.exec(inrPerUsd?.trim() ?? '');
  if (!match) return null;
  const [, rupees = '0', paise = ''] = match;
  return BigInt(rupees) * 100n + BigInt(paise.padEnd(2, '0'));
};

// The USDC that a rupee amount was worth at the quote's rate, rounded down
export const paiseToMicro = (paise: bigint, fxPaisePerUsd: bigint): bigint =>
  (paise * MICRO_PER_USD) / fxPaisePerUsd;
