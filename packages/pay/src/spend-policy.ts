import { THRESHOLD_ACTIONS } from '@kosha/shared/registry';
import { z } from 'zod';

const MICRO_PER_USDC = 1_000_000n;
const USDC_DECIMALS = 6;
const USDC_PATTERN = new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${USDC_DECIMALS}})?$`);
// An exact host, or "*.example.com" for any subdomain of it
const HOST_PATTERN = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*$/;

export const DEFAULT_ACCEPT_RULEPACKS = ['in-2026.*'];

// "0.50" → 500000n, exactly, without a float
const usdcSchema = z
  .string()
  .regex(USDC_PATTERN, 'expected a USDC amount with up to 6 decimals')
  .transform((usdc) => {
    const [whole = '0', fraction = ''] = usdc.split('.');
    return BigInt(whole) * MICRO_PER_USDC + BigInt(fraction.padEnd(USDC_DECIMALS, '0'));
  });

// The owner's spending rules. Every cap counts the all-in total: the price plus the TDS reserved.
export const spendPolicySchema = z.strictObject({
  perPaymentUsdc: usdcSchema,
  dailyUsdc: usdcSchema,
  fyBudgetUsdc: usdcSchema,
  allowlist: z.array(z.string().toLowerCase().regex(HOST_PATTERN)).min(1),
  // What to do when a quote starts withholding (threshold_crossed or tolerance_exceeded)
  onThreshold: z.enum(THRESHOLD_ACTIONS).default('warn'),
  // Glob patterns, e.g. "in-2026.*"
  acceptRulepacks: z.array(z.string().min(1)).min(1).default(DEFAULT_ACCEPT_RULEPACKS)
});

export type SpendPolicyInput = z.input<typeof spendPolicySchema>;
export type SpendPolicy = z.output<typeof spendPolicySchema>;
export type ThresholdAction = SpendPolicy['onThreshold'];
