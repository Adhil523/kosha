import { z } from 'zod';

// Money is always an integer count of minor units: micro-USDC (6 decimals) or paise (1/100 rupee).
// It crosses the wire as a decimal string and lives in code as bigint. It is never a float.
const MINOR_UNITS_PATTERN = /^(0|[1-9]\d*)$/;
const MICRO_PER_USDC = 1_000_000n;
const PAISE_PER_RUPEE = 100n;
const MIN_USDC_DECIMALS = 2;
const USDC_DECIMALS = 6;

export const amountSchema = z
  .string()
  .regex(MINOR_UNITS_PATTERN, 'expected a non-negative integer count of minor units')
  .brand<'Amount'>();

export type Amount = z.output<typeof amountSchema>;

// A gain or loss, which can be negative; only for reports, never for a transfer amount
export const signedAmountSchema = z
  .string()
  .regex(/^(0|-?[1-9]\d*)$/, 'expected an integer count of minor units')
  .brand<'SignedAmount'>();

export const amountToBigint = (amount: Amount): bigint => BigInt(amount);

export const bigintToAmount = (value: bigint): Amount => {
  if (value < 0n) {
    throw new RangeError('[money]: an amount must not be negative');
  }
  return amountSchema.parse(value.toString());
};

const groupDigits = (whole: bigint, locale: 'en-US' | 'en-IN'): string =>
  new Intl.NumberFormat(locale).format(whole);

// 100000n → "0.10", 101019n → "0.101019", 2500000n → "2.50"
export const formatUsdc = (microUsdc: bigint): string => {
  const whole = microUsdc / MICRO_PER_USDC;
  const fraction = (microUsdc % MICRO_PER_USDC)
    .toString()
    .padStart(USDC_DECIMALS, '0')
    .replace(/0+$/, '')
    .padEnd(MIN_USDC_DECIMALS, '0');
  return `${groupDigits(whole, 'en-US')}.${fraction}`;
};

// 884n → "₹8.84", 1000000n → "₹10,000.00", 10000000n → "₹1,00,000.00" (Indian digit grouping)
export const formatInr = (paise: bigint): string => {
  const whole = paise / PAISE_PER_RUPEE;
  const fraction = (paise % PAISE_PER_RUPEE).toString().padStart(2, '0');
  return `₹${groupDigits(whole, 'en-IN')}.${fraction}`;
};
