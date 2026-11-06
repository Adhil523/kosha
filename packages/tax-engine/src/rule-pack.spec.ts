import { type RulePackInput, rulePackSchema } from './rule-pack';
import { describe, expect, it } from 'vitest';

const VALID_PACK: RulePackInput = {
  id: 'in-2026.1',
  law: 'Income-tax Act 2025, s.393(1)',
  effectiveFrom: '2026-04-01',
  financialYearStart: '04-01',
  rates: { standardBps: 100, noPanBps: 2000 },
  thresholds: { specifiedPersonPaise: 5_000_000, otherPaise: 1_000_000 },
  crossing: 'full',
  unknownPayer: 'first_rupee_no_pan',
  funding: 'payer',
  nonResident: 'no_tds_flag_fema',
  receiverNonResident: 'no_tds_flag_fema',
  fxSource: 'demo-fixed',
  reviewedBy: null
};

describe('rulePackSchema', () => {
  it('parses a valid pack and turns thresholds into bigint paise', () => {
    const result = rulePackSchema.safeParse(VALID_PACK);

    expect(result.success).toBe(true);
    expect(result.data?.thresholds).toEqual({
      specifiedPersonPaise: 5_000_000n,
      otherPaise: 1_000_000n
    });
  });

  it.each([
    ['an unknown top-level key', { ...VALID_PACK, extra: true }],
    ['a rate above 100%', { ...VALID_PACK, rates: { standardBps: 10_001, noPanBps: 2000 } }],
    [
      'fractional paise',
      { ...VALID_PACK, thresholds: { specifiedPersonPaise: 5_000_000, otherPaise: 0.5 } }
    ],
    [
      'negative paise',
      { ...VALID_PACK, thresholds: { specifiedPersonPaise: -1, otherPaise: 1_000_000 } }
    ],
    ['a malformed id', { ...VALID_PACK, id: 'india-2026' }],
    ['a malformed financial-year start', { ...VALID_PACK, financialYearStart: '4-1' }],
    ['an unknown crossing rule', { ...VALID_PACK, crossing: 'partial' }],
    ['a missing receiver residency rule', { ...VALID_PACK, receiverNonResident: undefined }]
  ])('rejects %s', (_label, input) => {
    expect(rulePackSchema.safeParse(input).success).toBe(false);
  });
});
