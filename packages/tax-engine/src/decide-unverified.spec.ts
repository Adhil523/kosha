import { decide, type DecideInput } from './decide';
import { decideInput, IN_2026_2, OTHER_THRESHOLD, TOLERANCE } from './decide.fixture';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

// Each 0.10 USDC payment is worth 884 paise: 20% is 177 paise (= 20,023 micro-USDC).
const VALUE = 884n;
const UNVERIFIED = { residency: 'unknown' } as const;
const EXCESS_PACK = { ...IN_2026_2, crossing: 'excess' as const };
const withTolerance = (toleranceLimitPaise: bigint) => ({
  ...IN_2026_2,
  unverifiedPayer: { defaultPolicy: 'threshold_tolerant' as const, toleranceLimitPaise }
});

describe('decide: unverified payer, threshold-tolerant receiver (₹5,000 tolerance)', () => {
  it.each([
    ['the first payment of the year', 0n],
    ['a total 1 paisa short of the tolerance', TOLERANCE - VALUE - 1n],
    ['a total landing exactly on the tolerance', TOLERANCE - VALUE]
  ])('withholds nothing for %s', (_label, aggregatePaise) => {
    const decision = decide(decideInput({ aggregatePaise, payer: UNVERIFIED }));

    expect(decision).toMatchObject({
      applies: false,
      tdsPaise: 0n,
      rateBps: 0,
      reason: 'within_tolerance',
      flags: []
    });
  });

  it.each([
    ['crosses the tolerance by 1 paisa', TOLERANCE - VALUE + 1n],
    ['starts exactly at the tolerance', TOLERANCE],
    ['is past the legal threshold too', OTHER_THRESHOLD * 2n]
  ])('withholds 20%% of the whole payment when the total %s', (_label, aggregatePaise) => {
    const decision = decide(decideInput({ aggregatePaise, payer: UNVERIFIED }));

    expect(decision).toMatchObject({
      applies: true,
      rateBps: 2000,
      tdsPaise: 177n,
      tdsMicroUsdc: 20_023n,
      reason: 'tolerance_exceeded'
    });
  });

  it('withholds 20% of only the excess over the tolerance under "excess" crossing', () => {
    // 100 paise above ₹5,000 → 20 paise
    const decision = decide(
      decideInput({
        pack: EXCESS_PACK,
        aggregatePaise: TOLERANCE - VALUE + 100n,
        payer: UNVERIFIED
      })
    );

    expect(decision).toMatchObject({ tdsPaise: 20n, reason: 'tolerance_exceeded' });
  });

  it('uses the same ₹5,000 tolerance for a specified-person receiver', () => {
    const receiver = { specifiedPerson: true };
    const under = decide(
      decideInput({ aggregatePaise: TOLERANCE - VALUE, payer: UNVERIFIED, receiver })
    );
    const over = decide(decideInput({ aggregatePaise: TOLERANCE, payer: UNVERIFIED, receiver }));

    expect(under.reason).toBe('within_tolerance');
    expect(over.reason).toBe('tolerance_exceeded');
  });

  it('caps the tolerance at the legal threshold when the pack sets it higher', () => {
    const pack = withTolerance(OTHER_THRESHOLD * 3n);
    const other = decide(decideInput({ pack, aggregatePaise: OTHER_THRESHOLD, payer: UNVERIFIED }));
    const specified = decide(
      decideInput({
        pack,
        aggregatePaise: OTHER_THRESHOLD,
        payer: UNVERIFIED,
        receiver: { specifiedPerson: true }
      })
    );

    // ₹10,000 caps the ₹30,000 tolerance; a ₹50,000 buyer still allows up to ₹30,000
    expect(other).toMatchObject({ applies: true, reason: 'tolerance_exceeded' });
    expect(specified).toMatchObject({ applies: false, reason: 'within_tolerance' });
  });

  it('withholds from the first rupee when the pack sets a zero tolerance', () => {
    const decision = decide(decideInput({ pack: withTolerance(0n), payer: UNVERIFIED }));

    expect(decision).toMatchObject({ tdsPaise: 177n, reason: 'first_rupee' });
  });

  it('withholds from the first rupee for a first-rupee receiver', () => {
    const decision = decide(decideInput({ payer: UNVERIFIED, receiver: { mode: 'first_rupee' } }));

    expect(decision).toMatchObject({ rateBps: 2000, tdsPaise: 177n, reason: 'first_rupee' });
  });
});

describe('decide: the unverified-payer policy affects only unverified payers', () => {
  it.each([
    ['a resident with a PAN', { panOnFile: true }],
    ['a resident without a PAN', { panOnFile: false }]
  ])('keeps the legal threshold for %s at a strict receiver', (_label, payer) => {
    const decision = decide(
      decideInput({
        aggregatePaise: TOLERANCE,
        payer,
        receiver: { unverifiedPolicy: 'strict' }
      })
    );

    expect(decision).toMatchObject({ applies: false, reason: 'under_threshold' });
  });

  it('lets a non-resident receiver override a strict policy', () => {
    const decision = decide(
      decideInput({
        payer: UNVERIFIED,
        receiver: { residency: 'non_resident', unverifiedPolicy: 'strict' }
      })
    );

    expect(decision).toMatchObject({ applies: false, reason: 'receiver_non_resident' });
  });
});

const policyInputArb = fc.record({
  priceMicroUsdc: fc.bigInt({ min: 1n, max: 10n ** 12n }),
  aggregatePaise: fc.bigInt({ min: 0n, max: 100_000_000n }),
  specifiedPerson: fc.boolean(),
  crossing: fc.constantFrom('full', 'excess'),
  toleranceLimitPaise: fc.bigInt({ min: 0n, max: 10_000_000n })
});

type PolicyInput = typeof policyInputArb extends fc.Arbitrary<infer T> ? T : never;

const policyInput = (
  generated: PolicyInput,
  payer: Partial<DecideInput['payer']>,
  unverifiedPolicy: DecideInput['receiver']['unverifiedPolicy']
): DecideInput =>
  decideInput({
    priceMicroUsdc: generated.priceMicroUsdc,
    aggregatePaise: generated.aggregatePaise,
    pack: {
      ...withTolerance(generated.toleranceLimitPaise),
      crossing: generated.crossing
    },
    payer,
    receiver: { specifiedPerson: generated.specifiedPerson, unverifiedPolicy }
  });

describe('decide: being unverified never lowers the TDS', () => {
  it('an unverified payer withholds at least as much as a known resident without a PAN', () => {
    fc.assert(
      fc.property(
        policyInputArb,
        fc.constantFrom('strict', 'threshold_tolerant'),
        (generated, unverifiedPolicy) => {
          const unverified = decide(policyInput(generated, UNVERIFIED, unverifiedPolicy));
          const noPan = decide(
            policyInput(generated, { residency: 'resident', panOnFile: false }, unverifiedPolicy)
          );

          expect(unverified.tdsMicroUsdc).toBeGreaterThanOrEqual(noPan.tdsMicroUsdc);
        }
      )
    );
  });

  it('a strict receiver withholds at least as much as a tolerant one', () => {
    fc.assert(
      fc.property(policyInputArb, (generated) => {
        const strict = decide(policyInput(generated, UNVERIFIED, 'strict'));
        const tolerant = decide(policyInput(generated, UNVERIFIED, 'threshold_tolerant'));

        expect(strict.tdsMicroUsdc).toBeGreaterThanOrEqual(tolerant.tdsMicroUsdc);
      })
    );
  });
});
