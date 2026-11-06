export type FundingSplit = {
  // credited to the API's account: exactly its net price
  receiverMicro: bigint;
  // credited to the payer's own 2-of-2 reserve account, held in the payer's name
  reserveMicro: bigint;
  // debited from the payer: always receiverMicro + reserveMicro
  payerTotalMicro: bigint;
};

// Splits one payment the way the rule pack's `funding: "payer_reserve"` (mode C) says: the API
// gets exactly its price and the payer funds its own TDS into its own reserve. The API never
// absorbs the tax, so the tax base stays the price and there is no tax on tax.
export const applyFunding = ({
  priceMicroUsdc,
  tdsMicroUsdc
}: {
  priceMicroUsdc: bigint;
  tdsMicroUsdc: bigint;
}): FundingSplit => {
  if (priceMicroUsdc < 0n || tdsMicroUsdc < 0n) {
    throw new RangeError('[apply-funding]: amounts must not be negative');
  }

  return {
    receiverMicro: priceMicroUsdc,
    reserveMicro: tdsMicroUsdc,
    payerTotalMicro: priceMicroUsdc + tdsMicroUsdc
  };
};
