import { type Funding } from './rule-pack';

export type FundingSplit = {
  // credited to the API's account
  receiverMicro: bigint;
  // credited to the TDS escrow account
  escrowMicro: bigint;
  // debited from the payer: always receiverMicro + escrowMicro
  payerTotalMicro: bigint;
};

export type ApplyFundingResult =
  | { ok: true; data: FundingSplit }
  | {
      ok: false;
      data: { reason: 'tds_not_below_price'; priceMicroUsdc: bigint; tdsMicroUsdc: bigint };
    };

// Splits one payment between the API and escrow.
// - "payer": the API gets its full price; the payer pays price + TDS (credited to the payer's PAN).
// - "price_inclusive": the API absorbs the TDS and gets price − TDS; the payer pays the price.
export const applyFunding = ({
  funding,
  priceMicroUsdc,
  tdsMicroUsdc
}: {
  funding: Funding;
  priceMicroUsdc: bigint;
  tdsMicroUsdc: bigint;
}): ApplyFundingResult => {
  if (priceMicroUsdc < 0n || tdsMicroUsdc < 0n) {
    throw new RangeError('[apply-funding]: amounts must not be negative');
  }

  if (funding === 'payer') {
    return {
      ok: true,
      data: {
        receiverMicro: priceMicroUsdc,
        escrowMicro: tdsMicroUsdc,
        payerTotalMicro: priceMicroUsdc + tdsMicroUsdc
      }
    };
  }

  // Rounding up can make the TDS on a tiny price exceed the price itself. Shrinking the TDS
  // would under-deduct, so refuse instead; the quote can fall back to payer funding.
  if (tdsMicroUsdc > 0n && tdsMicroUsdc >= priceMicroUsdc) {
    return { ok: false, data: { reason: 'tds_not_below_price', priceMicroUsdc, tdsMicroUsdc } };
  }
  return {
    ok: true,
    data: {
      receiverMicro: priceMicroUsdc - tdsMicroUsdc,
      escrowMicro: tdsMicroUsdc,
      payerTotalMicro: priceMicroUsdc
    }
  };
};
