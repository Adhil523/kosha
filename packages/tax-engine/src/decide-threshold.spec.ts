import { decide } from './decide';
import {
  decideInput,
  IN_2026_2,
  OTHER_THRESHOLD,
  SPECIFIED_THRESHOLD,
  TEN_CENTS
} from './decide.fixture';
import { describe, expect, it } from 'vitest';

// Each 0.10 USDC payment is worth 884 paise at ₹88.40.
const VALUE = 884n;
const EXCESS_PACK = { ...IN_2026_2, crossing: 'excess' as const };

describe('decide: thresholds (₹10,000 other, ₹50,000 specified person)', () => {
  it.each([
    ['the first payment of the year', 0n],
    ['a total landing exactly on ₹10,000', OTHER_THRESHOLD - VALUE],
    ['a total 1 paisa short of ₹10,000', OTHER_THRESHOLD - VALUE - 1n]
  ])('withholds nothing for %s', (_label, aggregatePaise) => {
    const decision = decide(decideInput({ aggregatePaise }));

    expect(decision).toMatchObject({
      applies: false,
      tdsPaise: 0n,
      tdsMicroUsdc: 0n,
      rateBps: 0,
      reason: 'under_threshold'
    });
  });

  it.each([
    ['crosses by 1 paisa', OTHER_THRESHOLD - VALUE + 1n],
    ['starts exactly at the threshold', OTHER_THRESHOLD],
    ['is long past the threshold', OTHER_THRESHOLD * 3n]
  ])('withholds 1%% of the whole payment when the total %s', (_label, aggregatePaise) => {
    const decision = decide(decideInput({ aggregatePaise }));

    expect(decision).toMatchObject({
      applies: true,
      tdsPaise: 9n,
      rateBps: 100,
      reason: 'threshold_crossed'
    });
  });

  it.each([
    ['under ₹50,000', OTHER_THRESHOLD, false],
    ['landing exactly on ₹50,000', SPECIFIED_THRESHOLD - VALUE, false],
    ['crossing ₹50,000 by 1 paisa', SPECIFIED_THRESHOLD - VALUE + 1n, true]
  ])('uses the ₹50,000 threshold for a specified person: %s', (_label, aggregatePaise, applies) => {
    const decision = decide(decideInput({ aggregatePaise, payer: { specifiedPerson: true } }));

    expect(decision.applies).toBe(applies);
  });
});

describe('decide: crossing rule', () => {
  it.each([
    // crossing payment worth 884 paise; "full" taxes 884, "excess" taxes only what's above ₹10,000
    ['full', 1n, 9n],
    ['excess', 1n, 1n],
    ['full', 100n, 9n],
    ['excess', 100n, 1n],
    ['excess', 884n, 9n]
  ] as const)('%s crossing by %s paise withholds %s paise', (crossing, overBy, tdsPaise) => {
    const pack = { ...IN_2026_2, crossing };
    const decision = decide(
      decideInput({ pack, aggregatePaise: OTHER_THRESHOLD - VALUE + overBy })
    );

    expect(decision.tdsPaise).toBe(tdsPaise);
    expect(decision.reason).toBe('threshold_crossed');
  });

  it('taxes the whole value under "excess" once the total is already past the threshold', () => {
    const decision = decide(decideInput({ pack: EXCESS_PACK, aggregatePaise: OTHER_THRESHOLD }));

    expect(decision.tdsPaise).toBe(9n);
  });

  it('applies "excess" to a large crossing payment', () => {
    // 10 USDC = ₹884.00; ₹4 of it sits under the threshold, so ₹880 is taxable
    const input = { priceMicroUsdc: TEN_CENTS * 100n, aggregatePaise: OTHER_THRESHOLD - 400n };

    expect(decide(decideInput({ ...input, pack: EXCESS_PACK })).tdsPaise).toBe(880n);
    expect(decide(decideInput(input)).tdsPaise).toBe(884n);
  });

  it('applies "excess" to the specified-person threshold', () => {
    const decision = decide(
      decideInput({
        pack: EXCESS_PACK,
        payer: { specifiedPerson: true },
        aggregatePaise: SPECIFIED_THRESHOLD - VALUE + 1n
      })
    );

    expect(decision.tdsPaise).toBe(1n);
  });

  it('converts a 1-paisa withholding to 114 micro-USDC, rounding up', () => {
    const decision = decide(
      decideInput({ pack: EXCESS_PACK, aggregatePaise: OTHER_THRESHOLD - VALUE + 1n })
    );

    // 1 paisa at ₹88.40 is 113.12 micro-USDC
    expect(decision.tdsMicroUsdc).toBe(114n);
  });
});
