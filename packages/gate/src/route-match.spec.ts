import { compileRoutes, usdcToMicro } from './route-match';
import { describe, expect, it } from 'vitest';

const match = compileRoutes({
  'GET /v1/gst-lookup': { priceUsdc: '0.10', description: 'GSTIN lookup' },
  'GET /v1/company/:cin': { priceUsdc: '0.25' },
  'POST /v1/company/:cin/filings/:year': { priceUsdc: '1' }
});

describe('usdcToMicro', () => {
  it.each([
    ['0.10', 100_000n],
    ['0.25', 250_000n],
    ['1', 1_000_000n],
    ['0.000001', 1n],
    ['12.5', 12_500_000n],
    ['0', 0n]
  ])('converts %s USDC to %s micro-USDC', (usdc, micro) => {
    expect(usdcToMicro(usdc)).toBe(micro);
  });

  it.each(['0.1234567', '-1', '1e3', '.5', '01', ''])('rejects "%s"', (usdc) => {
    expect(() => usdcToMicro(usdc)).toThrow(RangeError);
  });
});

describe('compileRoutes', () => {
  it('matches a fixed path and carries its net price', () => {
    expect(match('GET', '/v1/gst-lookup?gstin=29ABCDE1234F1Z5')).toEqual({
      key: 'GET /v1/gst-lookup',
      priceMicroUsdc: 100_000n,
      description: 'GSTIN lookup',
      mimeType: undefined,
      params: {}
    });
  });

  it('matches :params and decodes them', () => {
    expect(match('get', '/v1/company/U72200%20KA')).toMatchObject({
      key: 'GET /v1/company/:cin',
      priceMicroUsdc: 250_000n,
      params: { cin: 'U72200 KA' }
    });
    expect(match('POST', '/v1/company/L1/filings/2026/')?.params).toEqual({
      cin: 'L1',
      year: '2026'
    });
  });

  it.each([
    ['another method', 'POST', '/v1/gst-lookup'],
    ['an unpriced path', 'GET', '/health'],
    ['a missing param', 'GET', '/v1/company/'],
    ['an extra segment', 'GET', '/v1/gst-lookup/extra'],
    ['a malformed escape in a param', 'GET', '/v1/company/%E0']
  ])('returns null for %s', (_label, method, path) => {
    expect(match(method, path)).toBeNull();
  });

  it.each([
    ['a malformed price', { 'GET /a': { priceUsdc: '0.1.0' } }],
    ['a lowercase method', { 'get /a': { priceUsdc: '1' } }],
    ['a key without a path', { GET: { priceUsdc: '1' } }],
    ['an unknown option', { 'GET /a': { priceUsdc: '1', price: 1 } }]
  ])('throws at startup for %s', (_label, routes) => {
    expect(() => compileRoutes(routes as never)).toThrow(/invalid routes/);
  });
});
