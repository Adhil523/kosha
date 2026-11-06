import { amountSchema, amountToBigint, bigintToAmount, formatInr, formatUsdc } from './money';
import { describe, expect, it } from 'vitest';

describe('amountSchema', () => {
  it.each(['0', '1', '101019', '9007199254740993'])('accepts %s', (value) => {
    expect(amountSchema.safeParse(value).success).toBe(true);
  });

  it.each(['', '-1', '01', '1.5', '1e6', ' 1'])('rejects %j', (value) => {
    expect(amountSchema.safeParse(value).success).toBe(false);
  });

  it('round-trips through bigint beyond the float-safe range', () => {
    const big = 2n ** 64n + 1n;
    expect(amountToBigint(bigintToAmount(big))).toBe(big);
  });

  it('refuses a negative bigint', () => {
    expect(() => bigintToAmount(-1n)).toThrow(RangeError);
  });
});

describe('formatUsdc', () => {
  it.each([
    [0n, '0.00'],
    [1n, '0.000001'],
    [100000n, '0.10'],
    [101019n, '0.101019'],
    [2500000n, '2.50'],
    [1234567890000n, '1,234,567.89']
  ])('formats %s micro-USDC as %s', (micro, text) => {
    expect(formatUsdc(micro)).toBe(text);
  });
});

describe('formatInr', () => {
  it.each([
    [0n, '₹0.00'],
    [9n, '₹0.09'],
    [884n, '₹8.84'],
    [1000000n, '₹10,000.00'],
    [10000000n, '₹1,00,000.00']
  ])('formats %s paise as %s', (paise, text) => {
    expect(formatInr(paise)).toBe(text);
  });
});
