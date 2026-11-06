import { applyFunding } from './apply-funding';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('applyFunding (mode C: payer-funded, own reserve)', () => {
  it('gives the API its full price and sends the TDS to the reserve (spec example)', () => {
    expect(applyFunding({ priceMicroUsdc: 100_000n, tdsMicroUsdc: 1_019n })).toEqual({
      receiverMicro: 100_000n,
      reserveMicro: 1_019n,
      payerTotalMicro: 101_019n
    });
  });

  it('charges just the price when there is no TDS', () => {
    expect(applyFunding({ priceMicroUsdc: 50_000n, tdsMicroUsdc: 0n })).toEqual({
      receiverMicro: 50_000n,
      reserveMicro: 0n,
      payerTotalMicro: 50_000n
    });
  });

  it('handles TDS larger than a tiny price', () => {
    expect(applyFunding({ priceMicroUsdc: 1n, tdsMicroUsdc: 114n })).toEqual({
      receiverMicro: 1n,
      reserveMicro: 114n,
      payerTotalMicro: 115n
    });
  });

  it.each([
    ['price', { priceMicroUsdc: -1n, tdsMicroUsdc: 0n }],
    ['TDS', { priceMicroUsdc: 0n, tdsMicroUsdc: -1n }]
  ])('rejects a negative %s', (_label, input) => {
    expect(() => applyFunding(input)).toThrow(RangeError);
  });

  it('always balances, and the API always gets exactly its price', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        fc.bigInt({ min: 0n, max: 10n ** 15n }),
        (priceMicroUsdc, tdsMicroUsdc) => {
          const { receiverMicro, reserveMicro, payerTotalMicro } = applyFunding({
            priceMicroUsdc,
            tdsMicroUsdc
          });

          expect(receiverMicro + reserveMicro).toBe(payerTotalMicro);
          expect(receiverMicro).toBe(priceMicroUsdc);
          expect(reserveMicro).toBe(tdsMicroUsdc);
        }
      )
    );
  });
});
