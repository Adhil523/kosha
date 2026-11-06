import { decide, type DecideInput } from './decide';
import { IN_2026_2 } from './decide.fixture';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

const BPS = 10_000n;
const MICRO_RATE_SCALE = 10n ** 12n; // micro-USDC × micro-rupee rate → paise needs ÷ 10^12, × 100

// From 1 micro-USDC up to a billion USDC, with the edges always tried
const priceArb = fc.oneof(
  fc.constant(1n),
  fc.bigInt({ min: 1n, max: 1_000_000n }),
  fc.bigInt({ min: 1n, max: 10n ** 15n })
);
// ₹1 to ₹1,000 per USD
const fxArb = fc.bigInt({ min: 1_000_000n, max: 1_000_000_000n });
const aggregateArb = fc.bigInt({ min: 0n, max: 100_000_000n });
const payerArb = fc.record({
  residency: fc.constantFrom('resident', 'unknown', 'non_resident'),
  panOnFile: fc.boolean(),
  specifiedPerson: fc.boolean()
});
const inputArb = (crossing: 'full' | 'excess') =>
  fc.record({
    payer: payerArb,
    receiver: fc.constant({ residency: 'resident' as const }),
    priceMicroUsdc: priceArb,
    inrPerUsdMicro: fxArb,
    aggregatePaise: aggregateArb,
    mode: fc.constantFrom('threshold', 'first_rupee'),
    pack: fc.constant({ ...IN_2026_2, crossing })
  }) satisfies fc.Arbitrary<DecideInput>;

const thresholdOf = (input: DecideInput): bigint =>
  input.payer.specifiedPerson
    ? input.pack.thresholds.specifiedBuyerPaise
    : input.pack.thresholds.otherBuyerPaise;

describe('decide: rounding never under-deducts', () => {
  it('withholds at least the exact rate × price, in USDC, whenever the whole payment is taxed', () => {
    fc.assert(
      fc.property(inputArb('full'), (input) => {
        const decision = decide(input);
        if (!decision.applies) {
          return;
        }
        // tds ≥ price × rate, independent of the FX rate and both roundings
        expect(decision.tdsMicroUsdc * BPS).toBeGreaterThanOrEqual(
          input.priceMicroUsdc * BigInt(decision.rateBps)
        );
      })
    );
  });

  it('withholds at least the exact rate × excess when only the excess is taxed', () => {
    fc.assert(
      fc.property(inputArb('excess'), (input) => {
        const decision = decide(input);
        if (!decision.applies) {
          return;
        }
        // In paise × 10^12: the exact value above the threshold, or the whole value once past it
        const exactValue = input.priceMicroUsdc * input.inrPerUsdMicro * 100n;
        const exactAfter = input.aggregatePaise * MICRO_RATE_SCALE + exactValue;
        const thresholdScaled = thresholdOf(input) * MICRO_RATE_SCALE;
        const exactTaxable =
          decision.reason === 'threshold_crossed' && input.aggregatePaise < thresholdOf(input)
            ? exactAfter - thresholdScaled
            : exactValue;
        const withheld = decision.tdsMicroUsdc * input.inrPerUsdMicro * 100n * BPS;

        expect(withheld).toBeGreaterThanOrEqual(exactTaxable * BigInt(decision.rateBps));
      })
    );
  });

  it('over-deducts by less than 2 paise plus 1 micro-USDC', () => {
    fc.assert(
      fc.property(inputArb('full'), (input) => {
        const decision = decide(input);
        const exactTds =
          input.priceMicroUsdc * input.inrPerUsdMicro * 100n * BigInt(decision.rateBps);
        const slack = 2n * MICRO_RATE_SCALE * BPS + input.inrPerUsdMicro * 100n * BPS;
        const withheld = decision.tdsMicroUsdc * input.inrPerUsdMicro * 100n * BPS;

        expect(withheld).toBeLessThan(exactTds + slack);
      })
    );
  });
});

describe('decide: TDS never decreases as value rises', () => {
  it.each(['full', 'excess'] as const)('for a higher price (%s crossing)', (crossing) => {
    fc.assert(
      fc.property(inputArb(crossing), priceArb, (input, extra) => {
        const lower = decide(input);
        const higher = decide({ ...input, priceMicroUsdc: input.priceMicroUsdc + extra });

        expect(higher.tdsMicroUsdc).toBeGreaterThanOrEqual(lower.tdsMicroUsdc);
      })
    );
  });

  it.each(['full', 'excess'] as const)('for a higher year total (%s crossing)', (crossing) => {
    fc.assert(
      fc.property(inputArb(crossing), aggregateArb, (input, extra) => {
        const lower = decide(input);
        const higher = decide({ ...input, aggregatePaise: input.aggregatePaise + extra });

        expect(higher.tdsMicroUsdc).toBeGreaterThanOrEqual(lower.tdsMicroUsdc);
      })
    );
  });
});

describe('decide: tiny prices', () => {
  it('withholds from a 1-micro payment by an unknown payer', () => {
    const decision = decide({
      payer: { residency: 'unknown', panOnFile: false, specifiedPerson: false },
      receiver: { residency: 'resident' },
      priceMicroUsdc: 1n,
      inrPerUsdMicro: 88_400_000n,
      aggregatePaise: 0n,
      mode: 'threshold',
      pack: IN_2026_2
    });

    // 1 micro is worth 0.00884 paise → 1 paisa; 20% → 1 paisa → 114 micro-USDC
    expect(decision).toMatchObject({ valuePaise: 1n, tdsPaise: 1n, tdsMicroUsdc: 114n });
  });
});
