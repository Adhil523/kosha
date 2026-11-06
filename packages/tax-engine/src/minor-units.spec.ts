import { ceilDiv, microUsdcToPaise, paiseToMicroUsdc } from './minor-units';
import { describe, expect, it } from 'vitest';

const INR_88_40 = 88_400_000n;

describe('ceilDiv', () => {
  it.each([
    [0n, 7n, 0n],
    [1n, 7n, 1n],
    [7n, 7n, 1n],
    [8n, 7n, 2n],
    [14n, 7n, 2n],
    [10n ** 30n + 1n, 10n ** 15n, 10n ** 15n + 1n]
  ])('ceilDiv(%s, %s) = %s', (a, b, expected) => {
    expect(ceilDiv(a, b)).toBe(expected);
  });

  it('rejects a zero or negative divisor', () => {
    expect(() => ceilDiv(1n, 0n)).toThrow(RangeError);
    expect(() => ceilDiv(1n, -1n)).toThrow(RangeError);
  });

  it('rejects a negative dividend', () => {
    expect(() => ceilDiv(-1n, 7n)).toThrow(RangeError);
  });
});

describe('microUsdcToPaise', () => {
  it('values 0.10 USDC at ₹88.40 as 884 paise (spec example)', () => {
    expect(microUsdcToPaise(100_000n, INR_88_40)).toBe(884n);
  });

  it('is exact when it divides evenly', () => {
    expect(microUsdcToPaise(1_000_000n, INR_88_40)).toBe(8_840n);
  });

  it('rounds a 1-micro payment up to 1 paisa', () => {
    expect(microUsdcToPaise(1n, INR_88_40)).toBe(1n);
  });

  it('values zero as zero', () => {
    expect(microUsdcToPaise(0n, INR_88_40)).toBe(0n);
  });

  it('rejects a non-positive FX rate', () => {
    expect(() => microUsdcToPaise(1n, 0n)).toThrow(RangeError);
  });
});

describe('paiseToMicroUsdc', () => {
  it('converts 9 paise at ₹88.40 to 1019 micro-USDC (spec example)', () => {
    expect(paiseToMicroUsdc(9n, INR_88_40)).toBe(1_019n);
  });

  it('is exact when it divides evenly', () => {
    expect(paiseToMicroUsdc(8_840n, INR_88_40)).toBe(1_000_000n);
  });

  it('never understates: converting back covers at least the original paise', () => {
    for (let paise = 0n; paise <= 5_000n; paise += 1n) {
      const micro = paiseToMicroUsdc(paise, INR_88_40);
      expect(micro * INR_88_40 * 100n).toBeGreaterThanOrEqual(paise * 10n ** 12n);
      // and by less than one micro-unit
      expect((micro - 1n) * INR_88_40 * 100n).toBeLessThan(paise * 10n ** 12n);
    }
  });

  it('rejects a non-positive FX rate', () => {
    expect(() => paiseToMicroUsdc(1n, -1n)).toThrow(RangeError);
  });
});
