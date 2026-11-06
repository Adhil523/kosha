import { spendPolicySchema } from './spend-policy';
import { describe, expect, it } from 'vitest';

const POLICY = {
  perPaymentUsdc: '0.50',
  dailyUsdc: '5',
  fyBudgetUsdc: '200',
  allowlist: ['api.demo-in.dev', '*.Demo-Global.dev']
};

describe('spendPolicySchema', () => {
  it('parses USDC caps into micro-units and fills the defaults', () => {
    expect(spendPolicySchema.parse(POLICY)).toEqual({
      perPaymentUsdc: 500_000n,
      dailyUsdc: 5_000_000n,
      fyBudgetUsdc: 200_000_000n,
      allowlist: ['api.demo-in.dev', '*.demo-global.dev'],
      onThreshold: 'warn',
      acceptRulepacks: ['in-2026.*']
    });
  });

  it('keeps an explicit threshold action and rule packs', () => {
    const parsed = spendPolicySchema.parse({
      ...POLICY,
      onThreshold: 'block',
      acceptRulepacks: ['in-2026.2']
    });

    expect(parsed).toMatchObject({ onThreshold: 'block', acceptRulepacks: ['in-2026.2'] });
  });

  it.each([
    ['a cap with 7 decimals', { ...POLICY, perPaymentUsdc: '0.0000001' }],
    ['a negative cap', { ...POLICY, dailyUsdc: '-1' }],
    ['a numeric cap', { ...POLICY, fyBudgetUsdc: 200 }],
    ['an empty allowlist', { ...POLICY, allowlist: [] }],
    ['a URL instead of a host', { ...POLICY, allowlist: ['https://api.demo-in.dev'] }],
    ['an unknown threshold action', { ...POLICY, onThreshold: 'ignore' }],
    ['no accepted rule packs', { ...POLICY, acceptRulepacks: [] }],
    ['an unknown option', { ...POLICY, maxUsdc: '1' }]
  ])('rejects %s', (_label, input) => {
    expect(spendPolicySchema.safeParse(input).success).toBe(false);
  });
});
