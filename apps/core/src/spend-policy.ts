import type { AgentPolicy } from './agent-policy';
import type { ErrorCode } from '@kosha/shared/error-codes';

// The decision reasons the agent owner's threshold action applies to (spec Component 3, rule 3)
const WITHHOLDING_REASONS: ReadonlySet<string> = new Set([
  'threshold_crossed',
  'tolerance_exceeded'
]);

export type PolicyCode = Extract<
  ErrorCode,
  | 'policy_per_payment'
  | 'policy_daily'
  | 'policy_budget'
  | 'policy_allowlist'
  | 'policy_threshold_block'
>;

// What the agent has already committed today (IST) and this financial year, in micro-USDC
export type SpendTotals = { dayMicro: bigint; fyMicro: bigint };

export type SpendCheck = {
  rules: AgentPolicy;
  resourceUrl: string;
  // The all-in total: price plus TDS. Tax counts toward every cap.
  totalMicro: bigint;
  reason: string;
  spent: SpendTotals;
};

export type SpendCheckResult =
  | { ok: true; data: { warn: boolean } }
  | { ok: false; data: { code: PolicyCode; message: string } };

// `*.example.com` matches any subdomain. An empty allowlist leaves hosts unrestricted.
const hostAllowed = (url: string, allowlist: readonly string[]): boolean => {
  if (allowlist.length === 0) return true;
  if (!URL.canParse(url)) return false;
  const host = new URL(url).hostname.toLowerCase();
  return allowlist.some((entry) => {
    const rule = entry.toLowerCase();
    return rule.startsWith('*.') ? host.endsWith(rule.slice(1)) : host === rule;
  });
};

const refuse = (code: PolicyCode, message: string): SpendCheckResult => ({
  ok: false,
  data: { code, message }
});

// Server-side twin of Kosha Pay's checkPolicy, in the same order with the same codes, so a payment
// Pay would refuse is refused by Core too. Pure: the caller reads the totals.
export const checkSpendPolicy = ({
  rules,
  resourceUrl,
  totalMicro,
  reason,
  spent
}: SpendCheck): SpendCheckResult => {
  if (!hostAllowed(resourceUrl, rules.allowlist)) {
    return refuse('policy_allowlist', `${resourceUrl} is not on the allowlist`);
  }
  if (totalMicro > rules.perPaymentMicro) {
    return refuse('policy_per_payment', `${totalMicro} micro-USDC is over the per-payment cap`);
  }
  if (spent.dayMicro + totalMicro > rules.dailyMicro) {
    return refuse('policy_daily', `${totalMicro} micro-USDC would pass today's cap`);
  }
  if (spent.fyMicro + totalMicro > rules.fyBudgetMicro) {
    return refuse('policy_budget', `${totalMicro} micro-USDC would pass this year's budget`);
  }

  const withholds = WITHHOLDING_REASONS.has(reason);
  if (withholds && rules.thresholdAction === 'block') {
    return refuse('policy_threshold_block', `the quote withholds TDS (${reason})`);
  }
  return { ok: true, data: { warn: withholds && rules.thresholdAction === 'warn' } };
};
