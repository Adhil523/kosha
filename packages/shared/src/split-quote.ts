import type { AccountId } from './ids';
import { amountToBigint } from './money';
import { type KoshaSplitRequirements, quoteMemo } from './x402-payment';

export type SplitQuoteProblem =
  | 'memo_mismatch'
  | 'consideration_leg_count'
  | 'consideration_mismatch'
  | 'reserve_leg_count'
  | 'tds_mismatch'
  | 'total_mismatch'
  | 'duplicate_account'
  | 'zero_amount';

export type SplitQuoteCheck =
  | {
      ok: true;
      data: {
        considerationMicro: bigint;
        reserveMicro: bigint;
        totalMicro: bigint;
        reserveAccount: AccountId | null;
      };
    }
  | { ok: false; data: { reason: SplitQuoteProblem } };

const fail = (reason: SplitQuoteProblem): SplitQuoteCheck => ({ ok: false, data: { reason } });

// The invariants every kosha-split quote must hold. Kosha Pay runs this before signing and Core
// runs it before issuing a quote, so both sides agree on what a well-formed split is.
export const checkSplitQuote = (requirements: KoshaSplitRequirements): SplitQuoteCheck => {
  const { quoteId, memo, transfers, tax, totalMicro } = requirements.extra.kosha;

  if (memo !== quoteMemo(quoteId)) return fail('memo_mismatch');
  if (new Set(transfers.map((leg) => leg.account)).size !== transfers.length) {
    return fail('duplicate_account');
  }
  if (transfers.some((leg) => amountToBigint(leg.amount) === 0n)) return fail('zero_amount');

  const consideration = transfers.filter((leg) => leg.leg === 'consideration');
  const reserve = transfers.filter((leg) => leg.leg === 'tds_reserve');
  const [considerationLeg] = consideration;
  if (consideration.length !== 1 || !considerationLeg) return fail('consideration_leg_count');
  if (
    considerationLeg.account !== requirements.payTo ||
    considerationLeg.amount !== requirements.amount
  ) {
    return fail('consideration_mismatch');
  }
  if (reserve.length > 1) return fail('reserve_leg_count');

  const [reserveLeg] = reserve;
  const reserveMicro = reserveLeg ? amountToBigint(reserveLeg.amount) : 0n;
  if (reserveMicro !== amountToBigint(tax.tdsMicroUsdc)) return fail('tds_mismatch');

  const considerationMicro = amountToBigint(considerationLeg.amount);
  const total = considerationMicro + reserveMicro;
  if (total !== amountToBigint(totalMicro)) return fail('total_mismatch');

  return {
    ok: true,
    data: {
      considerationMicro,
      reserveMicro,
      totalMicro: total,
      reserveAccount: reserveLeg?.account ?? null
    }
  };
};
