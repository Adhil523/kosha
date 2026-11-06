import { checkPolicy } from './check-policy';
import { type SpendPolicyInput, spendPolicySchema } from './spend-policy';
import { koshaSplitRequirementsSchema } from '@kosha/shared/x402-payment';
import { splitEntry } from '@kosha/shared/x402-payment.fixture';
import { describe, expect, it } from 'vitest';

const URL_GST = 'https://api.demo-in.dev/v1/gst-lookup?gstin=27AAPFU0939F1ZV';
const NOTHING_SPENT = { dayMicro: 0n, fyMicro: 0n };
// The fixture quote: 0.10 USDC price + 1019 micro-USDC TDS = 101,019 all-in, threshold_crossed
const TOTAL = 101_019n;

const policyWith = (overrides: Partial<SpendPolicyInput> = {}) =>
  spendPolicySchema.parse({
    perPaymentUsdc: '0.50',
    dailyUsdc: '5',
    fyBudgetUsdc: '200',
    allowlist: ['api.demo-in.dev', '*.demo-global.dev'],
    onThreshold: 'allow',
    ...overrides
  });

const quoteWith = (tax: Partial<(typeof splitEntry)['extra']['kosha']['tax']> = {}) =>
  koshaSplitRequirementsSchema.parse({
    ...splitEntry,
    extra: {
      ...splitEntry.extra,
      kosha: { ...splitEntry.extra.kosha, tax: { ...splitEntry.extra.kosha.tax, ...tax } }
    }
  });

const check = ({
  policy = policyWith(),
  url = URL_GST,
  quote = quoteWith(),
  spent = NOTHING_SPENT
} = {}) => checkPolicy({ policy, url, quote, spent });

describe('checkPolicy: allowlist', () => {
  it.each([
    ['an exact host', URL_GST],
    ['a host in another case', 'https://API.Demo-In.dev/v1/gst-lookup'],
    ['a subdomain of a wildcard entry', 'https://eu.api.demo-global.dev/v1/x']
  ])('allows %s', (_label, url) => {
    expect(check({ url })).toEqual({ ok: true, data: { totalMicro: TOTAL, warnings: [] } });
  });

  it.each([
    ['another host', 'https://evil.example/v1/gst-lookup'],
    ['a look-alike suffix', 'https://api.demo-in.dev.evil.example/'],
    ['the bare domain of a wildcard entry', 'https://demo-global.dev/'],
    ['a malformed URL', 'not a url']
  ])('blocks %s', (_label, url) => {
    expect(check({ url })).toMatchObject({ ok: false, data: { reason: 'policy_allowlist' } });
  });
});

describe('checkPolicy: accepted rule packs', () => {
  it('blocks a quote decided by a rule pack the owner does not accept', () => {
    const result = check({ quote: quoteWith({ rulepack: 'in-2027.1' }) });

    expect(result).toMatchObject({ ok: false, data: { reason: 'policy_rulepack' } });
  });

  it('allows an exact rule pack id', () => {
    expect(check({ policy: policyWith({ acceptRulepacks: ['in-2026.2'] }) }).ok).toBe(true);
  });
});

describe('checkPolicy: caps count the all-in total, tax included', () => {
  it.each([
    ['exactly at the per-payment cap', { perPaymentUsdc: '0.101019' }, NOTHING_SPENT, true],
    [
      'the price under the cap but the total over it',
      { perPaymentUsdc: '0.10' },
      NOTHING_SPENT,
      false
    ]
  ])('per payment: %s', (_label, policy, spent, ok) => {
    const result = check({ policy: policyWith(policy), spent });

    expect(result.ok).toBe(ok);
    expect(result.ok || result.data.reason).toBe(ok || 'policy_per_payment');
  });

  it.each([
    ['lands exactly on the daily cap', 5_000_000n - TOTAL, true],
    ['passes the daily cap by 1 micro-USDC', 5_000_000n - TOTAL + 1n, false]
  ])('daily: a payment that %s', (_label, dayMicro, ok) => {
    const result = check({ spent: { dayMicro, fyMicro: dayMicro } });

    expect(result.ok || result.data.reason).toBe(ok || 'policy_daily');
  });

  it.each([
    ['lands exactly on the yearly budget', 200_000_000n - TOTAL, true],
    ['passes the yearly budget by 1 micro-USDC', 200_000_000n - TOTAL + 1n, false]
  ])('financial year: a payment that %s', (_label, fyMicro, ok) => {
    const result = check({ spent: { dayMicro: 0n, fyMicro } });

    expect(result.ok || result.data.reason).toBe(ok || 'policy_budget');
  });
});

describe('checkPolicy: onThreshold', () => {
  it.each([
    ['threshold_crossed', 'warn', true, 1],
    ['tolerance_exceeded', 'warn', true, 1],
    ['threshold_crossed', 'allow', true, 0],
    ['threshold_crossed', 'block', false, 0],
    ['tolerance_exceeded', 'block', false, 0]
  ] as const)('%s under "%s"', (reason, onThreshold, ok, warnings) => {
    const result = check({ policy: policyWith({ onThreshold }), quote: quoteWith({ reason }) });

    expect(result.ok).toBe(ok);
    if (result.ok) {
      expect(result.data.warnings).toHaveLength(warnings);
    } else {
      expect(result.data.reason).toBe('policy_threshold_block');
    }
  });

  it('reports the TDS in a warning', () => {
    const result = check({ policy: policyWith({ onThreshold: 'warn' }) });

    expect(result).toEqual({
      ok: true,
      data: {
        totalMicro: TOTAL,
        warnings: [{ reason: 'threshold_crossed', tdsMicroUsdc: 1_019n }]
      }
    });
  });

  it.each(['under_threshold', 'within_tolerance', 'first_rupee', 'non_resident'] as const)(
    'ignores a %s quote even under "block"',
    (reason) => {
      const quote = quoteWith({ reason, rateBps: 0, tdsMicroUsdc: '0' });

      expect(check({ policy: policyWith({ onThreshold: 'block' }), quote }).ok).toBe(true);
    }
  );
});
