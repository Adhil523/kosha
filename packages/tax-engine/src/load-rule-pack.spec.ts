import { loadBuiltInRulePack, loadRulePack } from './load-rule-pack';
import { describe, expect, it } from 'vitest';

describe('loadBuiltInRulePack', () => {
  it('loads and validates in-2026.2', () => {
    const result = loadBuiltInRulePack('in-2026.2');

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: 'in-2026.2',
        rates: { standardBps: 100, noPanBps: 2000 },
        supersedes: 'in-2026.1',
        taxBase: 'price',
        thresholds: {
          keyedTo: 'buyer',
          specifiedBuyerPaise: 5_000_000n,
          otherBuyerPaise: 1_000_000n
        },
        crossing: 'full',
        unverifiedPayer: { defaultPolicy: 'threshold_tolerant', toleranceLimitPaise: 500_000n },
        funding: 'payer_reserve',
        reviewedBy: null
      }
    });
  });

  it('reports an unknown id', () => {
    expect(loadBuiltInRulePack('in-1999.1')).toEqual({
      ok: false,
      data: { reason: 'unknown_rule_pack', id: 'in-1999.1' }
    });
  });
});

describe('loadRulePack', () => {
  it('lists the path of every invalid field', () => {
    const result = loadRulePack({ id: 'in-2026.2', crossing: 'partial' });

    expect(result.ok).toBe(false);
    if (result.ok || result.data.reason !== 'invalid_rule_pack') {
      throw new Error('expected invalid_rule_pack');
    }
    expect(result.data.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^crossing: /),
        expect.stringMatching(/^law: /)
      ])
    );
  });
});
