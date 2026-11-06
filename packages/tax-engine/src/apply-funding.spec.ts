import { applyFunding } from './apply-funding';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('applyFunding', () => {
  it('payer funding: the API gets its full price and the payer adds the TDS (spec example)', () => {
    expect(
      applyFunding({ funding: 'payer', priceMicroUsdc: 100_000n, tdsMicroUsdc: 1_019n })
    ).toEqual({
      ok: true,
      data: { receiverMicro: 100_000n, escrowMicro: 1_019n, payerTotalMicro: 101_019n }
    });
  });

  it('price-inclusive funding: the API absorbs the TDS', () => {
    expect(
      applyFunding({ funding: 'price_inclusive', priceMicroUsdc: 100_000n, tdsMicroUsdc: 1_019n })
    ).toEqual({
      ok: true,
      data: { receiverMicro: 98_981n, escrowMicro: 1_019n, payerTotalMicro: 100_000n }
    });
  });

  it.each(['payer', 'price_inclusive'] as const)(
    '%s funding with no TDS pays the price',
    (funding) => {
      expect(applyFunding({ funding, priceMicroUsdc: 50_000n, tdsMicroUsdc: 0n })).toEqual({
        ok: true,
        data: { receiverMicro: 50_000n, escrowMicro: 0n, payerTotalMicro: 50_000n }
      });
    }
  );

  it('payer funding handles TDS larger than a tiny price', () => {
    const result = applyFunding({ funding: 'payer', priceMicroUsdc: 1n, tdsMicroUsdc: 114n });

    expect(result).toEqual({
      ok: true,
      data: { receiverMicro: 1n, escrowMicro: 114n, payerTotalMicro: 115n }
    });
  });

  it.each([
    ['exceeds', 1n, 114n],
    ['equals', 114n, 114n]
  ])('price-inclusive funding refuses when the TDS %s the price', (_label, price, tds) => {
    expect(
      applyFunding({ funding: 'price_inclusive', priceMicroUsdc: price, tdsMicroUsdc: tds })
    ).toEqual({
      ok: false,
      data: { reason: 'tds_not_below_price', priceMicroUsdc: price, tdsMicroUsdc: tds }
    });
  });

  it('rejects negative amounts', () => {
    expect(() => applyFunding({ funding: 'payer', priceMicroUsdc: -1n, tdsMicroUsdc: 0n })).toThrow(
      RangeError
    );
  });

  it('always balances: the payer pays exactly what the API and escrow receive', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('payer', 'price_inclusive'),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        (funding, priceMicroUsdc, tdsMicroUsdc) => {
          const result = applyFunding({ funding, priceMicroUsdc, tdsMicroUsdc });
          if (!result.ok) {
            return;
          }
          const { receiverMicro, escrowMicro, payerTotalMicro } = result.data;

          expect(receiverMicro + escrowMicro).toBe(payerTotalMicro);
          expect(escrowMicro).toBe(tdsMicroUsdc);
          expect(receiverMicro).toBeGreaterThanOrEqual(0n);
        }
      )
    );
  });
});
