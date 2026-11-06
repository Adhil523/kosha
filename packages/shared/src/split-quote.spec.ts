import { checkSplitQuote } from './split-quote';
import { type KoshaSplitRequirements, paymentRequiredSchema } from './x402-payment';
import { paymentRequired, splitEntry } from './x402-payment.fixture';
import { describe, expect, it } from 'vitest';

const parseSplit = (entry: unknown): KoshaSplitRequirements => {
  const parsed = paymentRequiredSchema.parse({ ...paymentRequired, accepts: [entry] });
  const [first] = parsed.accepts;
  if (first?.scheme !== 'kosha-split') throw new Error('expected a kosha-split entry');
  return first;
};

const withLegs = (transfers: unknown[], overrides: Record<string, unknown> = {}) => ({
  ...splitEntry,
  extra: {
    ...splitEntry.extra,
    kosha: { ...splitEntry.extra.kosha, transfers, ...overrides }
  }
});

describe('checkSplitQuote', () => {
  it('accepts the spec example and returns the legs as bigint', () => {
    expect(checkSplitQuote(parseSplit(splitEntry))).toEqual({
      ok: true,
      data: {
        considerationMicro: 100000n,
        reserveMicro: 1019n,
        totalMicro: 101019n,
        reserveAccount: '0.0.6101'
      }
    });
  });

  it('accepts a quote with no tax and no reserve leg', () => {
    const untaxed = withLegs([{ account: '0.0.5001', amount: '100000', leg: 'consideration' }], {
      totalMicro: '100000',
      tax: {
        ...splitEntry.extra.kosha.tax,
        tdsMicroUsdc: '0',
        rateBps: 0,
        reason: 'under_threshold'
      }
    });
    expect(checkSplitQuote(parseSplit(untaxed)).ok).toBe(true);
  });

  it.each([
    ['memo_mismatch', withLegs(splitEntry.extra.kosha.transfers, { memo: 'kosha:q_other' })],
    [
      'consideration_mismatch',
      withLegs([
        { account: '0.0.9999', amount: '100000', leg: 'consideration' },
        { account: '0.0.6101', amount: '1019', leg: 'tds_reserve' }
      ])
    ],
    [
      'tds_mismatch',
      withLegs([
        { account: '0.0.5001', amount: '100000', leg: 'consideration' },
        { account: '0.0.6101', amount: '1000', leg: 'tds_reserve' }
      ])
    ],
    ['total_mismatch', withLegs(splitEntry.extra.kosha.transfers, { totalMicro: '101020' })],
    [
      'duplicate_account',
      withLegs([
        { account: '0.0.5001', amount: '100000', leg: 'consideration' },
        { account: '0.0.5001', amount: '1019', leg: 'tds_reserve' }
      ])
    ],
    [
      'consideration_leg_count',
      withLegs([{ account: '0.0.6101', amount: '1019', leg: 'tds_reserve' }])
    ]
  ])('reports %s', (reason, entry) => {
    expect(checkSplitQuote(parseSplit(entry))).toEqual({ ok: false, data: { reason } });
  });
});
