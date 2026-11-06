import type { AgentPolicy } from './agent-policy';
import { checkSpendPolicy, type SpendCheck } from './spend-policy';
import { describe, expect, it } from 'vitest';

const RULES: AgentPolicy = {
  perPaymentMicro: 500_000n,
  dailyMicro: 5_000_000n,
  fyBudgetMicro: 200_000_000n,
  allowlist: ['api.demo-in.dev', '*.demo-global.dev'],
  thresholdAction: 'warn',
  acceptRulepacks: ['in-tds-194t-v2']
};

const check = (overrides: Partial<SpendCheck> = {}) =>
  checkSpendPolicy({
    rules: RULES,
    resourceUrl: 'https://api.demo-in.dev/v1/gst-lookup',
    totalMicro: 100_000n,
    reason: 'under_threshold',
    spent: { dayMicro: 0n, fyMicro: 0n },
    ...overrides
  });

const codeOf = (overrides: Partial<SpendCheck>) => {
  const result = check(overrides);
  return result.ok ? null : result.data.code;
};

describe('checkSpendPolicy', () => {
  it('passes a payment inside every rule', () => {
    expect(check()).toEqual({ ok: true, data: { warn: false } });
  });

  it('refuses a host off the allowlist', () => {
    expect(codeOf({ resourceUrl: 'https://evil.dev/x' })).toBe('policy_allowlist');
    expect(codeOf({ resourceUrl: 'not a url' })).toBe('policy_allowlist');
  });

  it('matches a wildcard entry against subdomains only', () => {
    expect(codeOf({ resourceUrl: 'https://api.demo-global.dev/x' })).toBeNull();
    expect(codeOf({ resourceUrl: 'https://demo-global.dev/x' })).toBe('policy_allowlist');
  });

  it('leaves hosts unrestricted when the allowlist is empty', () => {
    const rules = { ...RULES, allowlist: [] };
    expect(codeOf({ rules, resourceUrl: 'https://anywhere.dev/x' })).toBeNull();
  });

  it('refuses a payment over the per-payment cap', () => {
    expect(codeOf({ totalMicro: 500_001n })).toBe('policy_per_payment');
    expect(codeOf({ totalMicro: 500_000n })).toBeNull();
  });

  it("refuses a payment that would pass today's cap", () => {
    expect(codeOf({ spent: { dayMicro: 4_950_000n, fyMicro: 0n } })).toBe('policy_daily');
    expect(codeOf({ spent: { dayMicro: 4_900_000n, fyMicro: 0n } })).toBeNull();
  });

  it("refuses a payment that would pass the year's budget", () => {
    const spent = { dayMicro: 0n, fyMicro: 199_950_000n };
    expect(codeOf({ spent })).toBe('policy_budget');
  });

  it('counts the tax: a price under the cap with TDS on top is over it', () => {
    // A 0.495 USDC price with 1% TDS is 0.49995, inside; at 20% it is 0.594, outside
    expect(codeOf({ totalMicro: 495_000n + 4_950n })).toBeNull();
    expect(codeOf({ totalMicro: 495_000n + 99_000n })).toBe('policy_per_payment');
  });

  it('blocks a withholding quote when the threshold action is block', () => {
    const rules = { ...RULES, thresholdAction: 'block' as const };
    expect(codeOf({ rules, reason: 'threshold_crossed' })).toBe('policy_threshold_block');
    expect(codeOf({ rules, reason: 'tolerance_exceeded' })).toBe('policy_threshold_block');
    expect(codeOf({ rules, reason: 'under_threshold' })).toBeNull();
  });

  it('warns on a withholding quote when the threshold action is warn', () => {
    expect(check({ reason: 'threshold_crossed' })).toEqual({ ok: true, data: { warn: true } });
  });

  it('lets a withholding quote through silently when the threshold action is allow', () => {
    const rules = { ...RULES, thresholdAction: 'allow' as const };
    expect(check({ rules, reason: 'threshold_crossed' })).toEqual({
      ok: true,
      data: { warn: false }
    });
  });
});
