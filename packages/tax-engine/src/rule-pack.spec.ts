import { type RulePackInput, rulePackSchema } from './rule-pack';
import { describe, expect, it } from 'vitest';

const VALID_PACK: RulePackInput = {
  id: 'in-2026.2',
  supersedes: 'in-2026.1',
  law: 'Income-tax Act 2025, s.393(1)',
  effectiveFrom: '2026-04-01',
  financialYearStart: '04-01',
  taxBase: 'price',
  rates: { standardBps: 100, noPanBps: 2000 },
  thresholds: { keyedTo: 'buyer', specifiedBuyerPaise: 5_000_000, otherBuyerPaise: 1_000_000 },
  crossing: 'full',
  unverifiedPayer: { defaultPolicy: 'threshold_tolerant', toleranceLimitPaise: 500_000 },
  funding: 'payer_reserve',
  nonResidentPayer: 'no_tds_flag_fema',
  nonResidentReceiver: 'no_tds_flag_fema',
  fxSource: 'demo-fixed',
  reviewedBy: null
};

describe('rulePackSchema', () => {
  it('parses a valid pack and turns every paise amount into bigint', () => {
    const result = rulePackSchema.safeParse(VALID_PACK);

    expect(result.success).toBe(true);
    expect(result.data?.thresholds).toEqual({
      keyedTo: 'buyer',
      specifiedBuyerPaise: 5_000_000n,
      otherBuyerPaise: 1_000_000n
    });
    expect(result.data?.unverifiedPayer.toleranceLimitPaise).toBe(500_000n);
  });

  it('accepts a first pack that supersedes nothing', () => {
    expect(rulePackSchema.safeParse({ ...VALID_PACK, supersedes: null }).success).toBe(true);
  });

  it.each([
    ['an unknown top-level key', { ...VALID_PACK, extra: true }],
    ['a rate above 100%', { ...VALID_PACK, rates: { standardBps: 10_001, noPanBps: 2000 } }],
    [
      'fractional paise',
      { ...VALID_PACK, thresholds: { ...VALID_PACK.thresholds, otherBuyerPaise: 0.5 } }
    ],
    [
      'negative paise',
      { ...VALID_PACK, thresholds: { ...VALID_PACK.thresholds, specifiedBuyerPaise: -1 } }
    ],
    [
      'a threshold keyed to the payer',
      { ...VALID_PACK, thresholds: { ...VALID_PACK.thresholds, keyedTo: 'payer' } }
    ],
    ['a malformed id', { ...VALID_PACK, id: 'india-2026' }],
    ['a malformed supersedes id', { ...VALID_PACK, supersedes: 'v1' }],
    ['a malformed financial-year start', { ...VALID_PACK, financialYearStart: '4-1' }],
    ['a tax base other than the price', { ...VALID_PACK, taxBase: 'total' }],
    ['an unknown crossing rule', { ...VALID_PACK, crossing: 'partial' }],
    ['the removed price-inclusive funding', { ...VALID_PACK, funding: 'price_inclusive' }],
    [
      'an unknown unverified-payer policy',
      { ...VALID_PACK, unverifiedPayer: { defaultPolicy: 'lenient', toleranceLimitPaise: 0 } }
    ],
    ['a missing receiver residency rule', { ...VALID_PACK, nonResidentReceiver: undefined }]
  ])('rejects %s', (_label, input) => {
    expect(rulePackSchema.safeParse(input).success).toBe(false);
  });
});
