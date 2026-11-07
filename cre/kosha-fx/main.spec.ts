import { deviationBps, inrPerUsdMicroFromFeed, parseRateMicro } from './main';
import { describe, expect, test } from 'bun:test';

describe('inrPerUsdMicroFromFeed', () => {
  test('inverts the USD-per-INR answer into micro-rupees per USD', () => {
    // 0.0125 USD per INR at 8 decimals is exactly ₹80 per USD
    expect(inrPerUsdMicroFromFeed(1_250_000n, 8)).toBe(80_000_000n);
  });

  test('rounds up, so a payment is never under-valued in rupees', () => {
    // The answer read on 2026-11-07: 1e14 / 1_058_300 = 94_491_165.0…, rounded up
    expect(inrPerUsdMicroFromFeed(1_058_300n, 8)).toBe(94_491_166n);
  });
});

describe('parseRateMicro', () => {
  test('reads decimal text without a float', () => {
    expect(parseRateMicro('93.92')).toBe(93_920_000n);
    expect(parseRateMicro('94')).toBe(94_000_000n);
  });

  test('refuses anything that is not a plain decimal', () => {
    expect(() => parseRateMicro('9.4e1')).toThrow();
    expect(() => parseRateMicro('93.1234567')).toThrow();
  });
});

describe('deviationBps', () => {
  test('is symmetric and measured against the reference', () => {
    expect(deviationBps(94_491_166n, 93_920_000n)).toBe(60n);
    expect(deviationBps(93_920_000n, 94_491_166n)).toBe(60n);
  });
});
