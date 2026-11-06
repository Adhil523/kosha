import { decide } from './decide';
import { decideInput, IN_2026_1, OTHER_THRESHOLD } from './decide.fixture';
import { describe, expect, it } from 'vitest';

// Each 0.10 USDC payment is worth 884 paise: 1% is 9 paise, 20% is 177 paise (= 20,023 micro-USDC).
const PAST_THRESHOLD = OTHER_THRESHOLD;
const EXCESS_PACK = { ...IN_2026_1, crossing: 'excess' as const };

describe('decide: rates', () => {
  it('withholds 1% from a resident with a PAN', () => {
    const decision = decide(decideInput({ aggregatePaise: PAST_THRESHOLD }));

    expect(decision).toMatchObject({ rateBps: 100, tdsPaise: 9n, tdsMicroUsdc: 1_019n });
  });

  it('withholds 20% from a resident without a PAN', () => {
    const decision = decide(
      decideInput({ aggregatePaise: PAST_THRESHOLD, payer: { panOnFile: false } })
    );

    expect(decision).toMatchObject({ rateBps: 2000, tdsPaise: 177n, reason: 'threshold_crossed' });
  });

  it('still applies the threshold to a known resident without a PAN', () => {
    const decision = decide(decideInput({ payer: { panOnFile: false } }));

    expect(decision).toMatchObject({ applies: false, reason: 'under_threshold' });
  });

  it('uses the rates from the rule pack', () => {
    const pack = { ...IN_2026_1, rates: { standardBps: 200, noPanBps: 3000 } };

    expect(decide(decideInput({ pack, aggregatePaise: PAST_THRESHOLD })).tdsPaise).toBe(18n);
  });
});

describe('decide: unknown payer (20% from the first rupee)', () => {
  it.each([
    ['at the start of the year', { payer: { residency: 'unknown' } }],
    ['even with a PAN claimed', { payer: { residency: 'unknown', panOnFile: true } }],
    ['even as a specified person', { payer: { residency: 'unknown', specifiedPerson: true } }],
    [
      'ignoring an "excess" crossing rule',
      { pack: EXCESS_PACK, aggregatePaise: 999_500n, payer: { residency: 'unknown' } }
    ]
  ] as const)('withholds 20%% of the whole payment %s', (_label, overrides) => {
    const decision = decide(decideInput(overrides));

    expect(decision).toMatchObject({
      applies: true,
      rateBps: 2000,
      tdsPaise: 177n,
      tdsMicroUsdc: 20_023n,
      reason: 'first_rupee',
      flags: []
    });
  });
});

describe('decide: non-resident payer', () => {
  it.each([
    ['under the threshold', 0n, 'threshold'],
    ['past the threshold', PAST_THRESHOLD * 10n, 'threshold'],
    ['for a first-rupee receiver', 0n, 'first_rupee']
  ] as const)('withholds nothing and flags FEMA review %s', (_label, aggregatePaise, mode) => {
    const decision = decide(
      decideInput({ aggregatePaise, mode, payer: { residency: 'non_resident' } })
    );

    expect(decision).toMatchObject({
      applies: false,
      tdsMicroUsdc: 0n,
      rateBps: 0,
      reason: 'non_resident',
      flags: ['fema_review']
    });
  });
});

describe('decide: non-resident receiver (a foreign API)', () => {
  it.each([
    ['a resident payer past the threshold', { residency: 'resident' }, PAST_THRESHOLD],
    ['an unknown payer', { residency: 'unknown' }, 0n],
    ['a non-resident payer', { residency: 'non_resident' }, 0n]
  ] as const)('withholds nothing and flags FEMA review for %s', (_label, payer, aggregatePaise) => {
    const decision = decide(
      decideInput({ aggregatePaise, payer, receiver: { residency: 'non_resident' } })
    );

    expect(decision).toMatchObject({
      applies: false,
      tdsMicroUsdc: 0n,
      reason: 'receiver_non_resident',
      flags: ['fema_review']
    });
  });

  it('still reports the INR value and rule pack', () => {
    const decision = decide(decideInput({ receiver: { residency: 'non_resident' } }));

    expect(decision).toMatchObject({ valuePaise: 884n, rulepack: 'in-2026.1' });
  });
});

describe('decide: first-rupee receiver mode', () => {
  it.each([
    ['a resident with a PAN', { panOnFile: true }, 100, 9n],
    ['a resident without a PAN', { panOnFile: false }, 2000, 177n],
    ['a specified person', { specifiedPerson: true }, 100, 9n]
  ] as const)('withholds from the first payment of %s', (_label, payer, rateBps, tdsPaise) => {
    const decision = decide(decideInput({ mode: 'first_rupee', payer }));

    expect(decision).toMatchObject({ applies: true, rateBps, tdsPaise, reason: 'first_rupee' });
  });

  it('taxes the whole value even when the pack crosses on the excess', () => {
    const decision = decide(decideInput({ mode: 'first_rupee', pack: EXCESS_PACK }));

    expect(decision.tdsPaise).toBe(9n);
  });
});
