import { bigintToAmount } from '@kosha/shared/money';
import { type Policy, THRESHOLD_ACTIONS } from '@kosha/shared/registry';
import { z } from 'zod';

const USDC_DECIMALS = 6;
const MICRO_PER_USDC = 10n ** BigInt(USDC_DECIMALS);
const USDC_PATTERN = new RegExp(`^(\\d+)(?:\\.(\\d{1,${USDC_DECIMALS}}))?$`);
const LIST_SEPARATOR = /[\n,]/;

// What the editor's fields hold: amounts as USDC text, lists one entry per line
export type PolicyForm = {
  perPaymentUsdc: string;
  dailyUsdc: string;
  fyBudgetUsdc: string;
  allowlist: string;
  thresholdAction: Policy['thresholdAction'];
  acceptRulepacks: string;
};
export type PolicyFormErrors = Partial<Record<keyof PolicyForm, string>>;

// For an agent with no policy yet: modest caps, warn at the threshold, the 2026 Indian packs
export const DEFAULT_POLICY_FORM: PolicyForm = {
  perPaymentUsdc: '1',
  dailyUsdc: '10',
  fyBudgetUsdc: '500',
  allowlist: '',
  thresholdAction: 'warn',
  acceptRulepacks: 'in-2026.*'
};

// 1500000n → "1.5": plain digits for an input field, no grouping
export const microToUsdc = (micro: bigint): string => {
  const whole = micro / MICRO_PER_USDC;
  const fraction = (micro % MICRO_PER_USDC).toString().padStart(USDC_DECIMALS, '0');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
};

const usdcField = z
  .string()
  .trim()
  .regex(USDC_PATTERN, 'Enter a USDC amount, up to 6 decimals')
  .transform((text) => {
    const [whole = '0', fraction = ''] = text.split('.');
    return BigInt(whole) * MICRO_PER_USDC + BigInt(fraction.padEnd(USDC_DECIMALS, '0'));
  });

const listField = (lowercase: boolean) =>
  z.string().transform((text) =>
    text
      .split(LIST_SEPARATOR)
      .map((entry) => (lowercase ? entry.trim().toLowerCase() : entry.trim()))
      .filter(Boolean)
  );

const policyFormSchema = z.object({
  perPaymentUsdc: usdcField,
  dailyUsdc: usdcField,
  fyBudgetUsdc: usdcField,
  // Empty leaves hosts unrestricted (Core's rule)
  allowlist: listField(true),
  thresholdAction: z.enum(THRESHOLD_ACTIONS),
  acceptRulepacks: listField(false).pipe(
    z.array(z.string()).min(1, 'Accept at least one rule pack, e.g. in-2026.*')
  )
});

export const policyToForm = (policy: Policy | null): PolicyForm =>
  policy
    ? {
        perPaymentUsdc: microToUsdc(BigInt(policy.perPaymentMicro)),
        dailyUsdc: microToUsdc(BigInt(policy.dailyMicro)),
        fyBudgetUsdc: microToUsdc(BigInt(policy.fyBudgetMicro)),
        allowlist: policy.allowlist.join('\n'),
        thresholdAction: policy.thresholdAction,
        acceptRulepacks: policy.acceptRulepacks.join('\n')
      }
    : DEFAULT_POLICY_FORM;

// The policy to PUT, or one message per field that needs fixing
export const formToPolicy = (
  form: PolicyForm
): { ok: true; data: Policy } | { ok: false; data: PolicyFormErrors } => {
  const parsed = policyFormSchema.safeParse(form);
  if (!parsed.success) {
    const errors: PolicyFormErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && field in form) {
        errors[field as keyof PolicyForm] ??= issue.message;
      }
    }
    return { ok: false, data: errors };
  }
  const { perPaymentUsdc, dailyUsdc, fyBudgetUsdc, ...lists } = parsed.data;
  return {
    ok: true,
    data: {
      perPaymentMicro: bigintToAmount(perPaymentUsdc),
      dailyMicro: bigintToAmount(dailyUsdc),
      fyBudgetMicro: bigintToAmount(fyBudgetUsdc),
      ...lists
    }
  };
};
