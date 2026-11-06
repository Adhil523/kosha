import { type SpendPolicy } from './spend-policy';
import { type SpendTotals } from './spend-store';
import { type ErrorCode } from '@kosha/shared/error-codes';
import { type KoshaSplitRequirements, type TaxReason } from '@kosha/shared/x402-payment';
import { rulepackMatches } from '@kosha/tax-engine/rule-pack-match';

// Core re-checks the same rules server-side with these codes; the rule-pack check is Pay's own
export type PolicyBlockReason =
  | Extract<
      ErrorCode,
      | 'policy_allowlist'
      | 'policy_per_payment'
      | 'policy_daily'
      | 'policy_budget'
      | 'policy_threshold_block'
    >
  | 'policy_rulepack';

type WithholdingReason = Extract<TaxReason, 'threshold_crossed' | 'tolerance_exceeded'>;

// A quote that starts withholding: the owner may want to know, or to stop
const isWithholding = (reason: TaxReason): reason is WithholdingReason =>
  reason === 'threshold_crossed' || reason === 'tolerance_exceeded';

export type PolicyWarning = { reason: WithholdingReason; tdsMicroUsdc: bigint };

export type CheckPolicyResult =
  | { ok: true; data: { totalMicro: bigint; warnings: PolicyWarning[] } }
  | { ok: false; data: { reason: PolicyBlockReason; message: string } };

export const hostAllowed = (url: string, allowlist: readonly string[]): boolean => {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowlist.some((entry) =>
    entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry
  );
};

const block = (reason: PolicyBlockReason, message: string): CheckPolicyResult => ({
  ok: false,
  data: { reason, message }
});

// Decides whether Pay may sign this quote. Pure: the caller reads the spend totals and records
// the payment once it settles. Every cap counts the all-in total, tax included.
export const checkPolicy = ({
  policy,
  url,
  quote,
  spent
}: {
  policy: SpendPolicy;
  url: string;
  quote: KoshaSplitRequirements;
  spent: SpendTotals;
}): CheckPolicyResult => {
  const { totalMicro: total, tax } = quote.extra.kosha;
  const totalMicro = BigInt(total);

  if (!hostAllowed(url, policy.allowlist)) {
    return block('policy_allowlist', `${url} is not on the allowlist`);
  }
  if (!rulepackMatches(tax.rulepack, policy.acceptRulepacks)) {
    return block('policy_rulepack', `rule pack ${tax.rulepack} is not accepted`);
  }
  if (totalMicro > policy.perPaymentUsdc) {
    return block('policy_per_payment', `${totalMicro} micro-USDC is over the per-payment cap`);
  }
  if (spent.dayMicro + totalMicro > policy.dailyUsdc) {
    return block('policy_daily', `${totalMicro} micro-USDC would pass today's cap`);
  }
  if (spent.fyMicro + totalMicro > policy.fyBudgetUsdc) {
    return block('policy_budget', `${totalMicro} micro-USDC would pass this year's budget`);
  }

  const { reason } = tax;
  if (isWithholding(reason) && policy.onThreshold === 'block') {
    return block('policy_threshold_block', `the quote withholds TDS (${reason})`);
  }
  const warnings: PolicyWarning[] =
    isWithholding(reason) && policy.onThreshold === 'warn'
      ? [{ reason, tdsMicroUsdc: BigInt(tax.tdsMicroUsdc) }]
      : [];

  return { ok: true, data: { totalMicro, warnings } };
};
