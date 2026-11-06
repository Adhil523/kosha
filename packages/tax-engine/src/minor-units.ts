// Money is integer minor units: micro-USDC (6 decimals) and paise (1/100 rupee). FX rates are
// micro-rupees per USD, e.g. 88_400_000n is ₹88.40. Every conversion rounds up, so a value or a
// tax amount is never understated.
const MICRO_PER_UNIT = 1_000_000n;
const PAISE_PER_RUPEE = 100n;
const MICRO_USDC_TIMES_MICRO_RATE_PER_PAISE = (MICRO_PER_UNIT * MICRO_PER_UNIT) / PAISE_PER_RUPEE;

// ⌈a / b⌉ for a ≥ 0 and b > 0.
export const ceilDiv = (a: bigint, b: bigint): bigint => {
  if (b <= 0n) {
    throw new RangeError('[minor-units]: divisor must be positive');
  }
  if (a < 0n) {
    throw new RangeError('[minor-units]: dividend must not be negative');
  }
  return (a + b - 1n) / b;
};

const assertRate = (inrPerUsdMicro: bigint): void => {
  if (inrPerUsdMicro <= 0n) {
    throw new RangeError('[minor-units]: FX rate must be positive');
  }
};

// micro-USDC → paise, rounded up: the INR value of a payment.
export const microUsdcToPaise = (microUsdc: bigint, inrPerUsdMicro: bigint): bigint => {
  assertRate(inrPerUsdMicro);
  return ceilDiv(microUsdc * inrPerUsdMicro, MICRO_USDC_TIMES_MICRO_RATE_PER_PAISE);
};

// paise → micro-USDC, rounded up: the USDC to withhold for a tax amount in rupees.
export const paiseToMicroUsdc = (paise: bigint, inrPerUsdMicro: bigint): bigint => {
  assertRate(inrPerUsdMicro);
  return ceilDiv(paise * MICRO_USDC_TIMES_MICRO_RATE_PER_PAISE, inrPerUsdMicro);
};
