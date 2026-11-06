import { formToPolicy, microToUsdc, policyToForm } from '@/lib/policy-form';
import { POLICY_FIXTURE } from '@kosha/shared/fixtures';
import { describe, expect, it } from 'vitest';

describe('microToUsdc', () => {
  it('writes plain USDC text without trailing zeros or grouping', () => {
    expect(microToUsdc(500_000n)).toBe('0.5');
    expect(microToUsdc(200_000_000n)).toBe('200');
    expect(microToUsdc(1_234_000_001n)).toBe('1234.000001');
  });
});

describe('policy form', () => {
  it('round-trips a policy through the form', () => {
    const form = policyToForm(POLICY_FIXTURE);

    expect(form).toMatchObject({ perPaymentUsdc: '0.5', dailyUsdc: '5', fyBudgetUsdc: '200' });
    expect(formToPolicy(form)).toEqual({ ok: true, data: POLICY_FIXTURE });
  });

  it('reads lists one per line or comma-separated, trimmed, hosts in lowercase', () => {
    const result = formToPolicy({
      ...policyToForm(POLICY_FIXTURE),
      allowlist: ' API.demo-in.dev, *.example.com\n\n',
      acceptRulepacks: 'in-2026.*\nin-2027.1'
    });

    expect(result.ok && result.data).toMatchObject({
      allowlist: ['api.demo-in.dev', '*.example.com'],
      acceptRulepacks: ['in-2026.*', 'in-2027.1']
    });
  });

  it('names each field that needs fixing', () => {
    const result = formToPolicy({
      ...policyToForm(null),
      dailyUsdc: '1.0000001',
      fyBudgetUsdc: '-5',
      acceptRulepacks: ' '
    });

    expect(result).toEqual({
      ok: false,
      data: {
        dailyUsdc: 'Enter a USDC amount, up to 6 decimals',
        fyBudgetUsdc: 'Enter a USDC amount, up to 6 decimals',
        acceptRulepacks: 'Accept at least one rule pack, e.g. in-2026.*'
      }
    });
  });

  it('starts an agent without a policy from the defaults, with no host restriction', () => {
    expect(formToPolicy(policyToForm(null))).toMatchObject({
      ok: true,
      data: { perPaymentMicro: '1000000', allowlist: [], acceptRulepacks: ['in-2026.*'] }
    });
  });
});
