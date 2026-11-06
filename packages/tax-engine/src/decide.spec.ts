import { decide } from './decide';
import { decideInput, OTHER_THRESHOLD } from './decide.fixture';
import { describe, expect, it } from 'vitest';

describe('decide', () => {
  it('matches the spec example: 0.10 USDC crossing ₹10,000 withholds 9 paise as 1019 micro-USDC', () => {
    const decision = decide(decideInput({ aggregatePaise: OTHER_THRESHOLD - 100n }));

    expect(decision).toEqual({
      rulepack: 'in-2026.1',
      applies: true,
      valuePaise: 884n,
      tdsPaise: 9n,
      tdsMicroUsdc: 1_019n,
      rateBps: 100,
      reason: 'threshold_crossed',
      flags: []
    });
  });

  it('rejects a negative aggregate', () => {
    expect(() => decide(decideInput({ aggregatePaise: -1n }))).toThrow(RangeError);
  });
});
