// The INR value of a payment decides the tax, so the rate is an exact integer: micro-rupees per USD
// (₹88.40 → 88_400_000n). Sources are pluggable; the rule pack names which one applies.
const MICRO = 1_000_000n;
const RATE_PATTERN = /^(\d+)(?:\.(\d{1,6}))?$/;

export type FxRate = { inrPerUsdMicro: bigint; asOf: Date; source: string };

export type FxSource = { current: () => Promise<FxRate> };

export type ParsedRate =
  { ok: true; data: bigint } | { ok: false; data: { reason: 'invalid_rate' } };

// "88.40" → 88_400_000n. Up to six decimals; never through a float.
export const parseInrPerUsd = (text: string): ParsedRate => {
  const match = RATE_PATTERN.exec(text.trim());
  if (!match) return { ok: false, data: { reason: 'invalid_rate' } };
  const [, whole = '0', fraction = ''] = match;
  const micro = BigInt(whole) * MICRO + BigInt(fraction.padEnd(6, '0'));
  return micro > 0n ? { ok: true, data: micro } : { ok: false, data: { reason: 'invalid_rate' } };
};

export const DEMO_FIXED_SOURCE = 'demo-fixed';

// FX_SOURCE=demo-fixed: one configured rate (FX_DEMO_INR_PER_USD), stamped with the time it's read
export const demoFixedFx = (
  rateText: string,
  now: () => Date = () => new Date()
): FxSource | null => {
  const rate = parseInrPerUsd(rateText);
  if (!rate.ok) return null;
  return {
    current: async () => ({ inrPerUsdMicro: rate.data, asOf: now(), source: DEMO_FIXED_SOURCE })
  };
};
