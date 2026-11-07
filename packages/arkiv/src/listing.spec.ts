import { koshaTermsSchema, toListings } from './listing';
import { describe, expect, it } from 'vitest';

const GST_LOOKUP = {
  route: 'GET /v1/gst-lookup',
  priceUsdc: '0.10',
  priceMicroUsdc: '100000',
  description: 'GSTIN lookup'
};

const TERMS = koshaTermsSchema.parse({
  network: 'hedera:testnet',
  rulepack: 'in-2026.2',
  prices: [GST_LOOKUP, { route: 'POST /v1/company', priceUsdc: '0.25', priceMicroUsdc: '250000' }],
  unverifiedPolicy: 'threshold_tolerant',
  acceptedLevels: [0, 1],
  registrationUrl: 'https://console.kosha.dev/register'
});

describe('koshaTermsSchema', () => {
  it('refuses terms with no priced route', () => {
    expect(koshaTermsSchema.safeParse({ ...TERMS, prices: [] }).success).toBe(false);
  });

  it('refuses a route that is not "METHOD /path"', () => {
    const prices = [{ ...GST_LOOKUP, route: '/v1/gst-lookup' }];
    expect(koshaTermsSchema.safeParse({ ...TERMS, prices }).success).toBe(false);
  });

  it('refuses an unknown unverified-payer policy', () => {
    expect(koshaTermsSchema.safeParse({ ...TERMS, unverifiedPolicy: 'lenient' }).success).toBe(
      false
    );
  });
});

describe('toListings', () => {
  it('makes one listing per priced route, with the API URL trimmed', () => {
    const result = toListings('https://api.demo-in.dev/', TERMS);
    if (!result.ok) throw new Error('expected listings');
    expect(result.data.map((l) => l.route)).toEqual(['GET /v1/gst-lookup', 'POST /v1/company']);
    const [first, second] = result.data.map((l) => l.values);
    expect(first).toMatchObject({
      apiUrl: 'https://api.demo-in.dev',
      method: 'GET',
      priceMicroUsdc: { type: 'u64', value: 100000n },
      rulepack: 'in-2026.2',
      unverifiedPolicy: 'threshold_tolerant',
      acceptsLevel0: true,
      acceptsLevel1: true,
      acceptsLevel2: false,
      description: 'GSTIN lookup',
      registrationUrl: 'https://console.kosha.dev/register'
    });
    expect(second).toMatchObject({ method: 'POST', priceUsdc: '0.25' });
    expect(second).not.toHaveProperty('description');
  });

  it('carries the full terms document as the payload', () => {
    const result = toListings('https://api.demo-in.dev', TERMS);
    if (!result.ok) throw new Error('expected listings');
    const payload = result.data[0]?.values.terms;
    expect(JSON.parse(new TextDecoder().decode(payload as Uint8Array))).toEqual(TERMS);
  });

  it('shortens a description to fit 128 bytes without splitting a character', () => {
    const prices = [{ ...GST_LOOKUP, description: 'कोश '.repeat(40) }];
    const result = toListings('https://api.demo-in.dev', { ...TERMS, prices });
    if (!result.ok) throw new Error('expected listings');
    const description = String(result.data[0]?.values.description);
    expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(128);
    expect(description.endsWith('…')).toBe(true);
    expect(description).not.toContain('�');
  });

  it('leaves out a registration URL too long to fit, rather than cutting it', () => {
    const result = toListings('https://api.demo-in.dev', {
      ...TERMS,
      registrationUrl: `https://example.com/${'x'.repeat(200)}`
    });
    if (!result.ok) throw new Error('expected listings');
    expect(result.data[0]?.values).not.toHaveProperty('registrationUrl');
  });

  it('refuses an API URL longer than an attribute holds', () => {
    const result = toListings(`https://example.com/${'x'.repeat(200)}`, TERMS);
    expect(result).toMatchObject({ ok: false, data: { reason: 'api_url_too_long' } });
  });
});
