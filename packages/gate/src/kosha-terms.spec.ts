import { createGateHandler } from './gate-handler';
import { buildTerms, TERMS_PATH, type TermsOptions } from './kosha-terms';
import { describe, expect, it, vi } from 'vitest';

const ROUTES = {
  'GET /v1/gst-lookup': { priceUsdc: '0.10', description: 'GSTIN lookup' },
  'GET /v1/company/:cin': { priceUsdc: '0.25' }
};

const TERMS: TermsOptions = {
  rulepack: 'in-2026.2',
  unverifiedPolicy: 'threshold_tolerant',
  acceptedLevels: [0, 1, 2],
  registrationUrl: 'https://console.kosha.dev/register'
};

describe('buildTerms', () => {
  it('lists every priced route at its net price', () => {
    expect(buildTerms(ROUTES, 'hedera:testnet', TERMS)).toEqual({
      network: 'hedera:testnet',
      rulepack: 'in-2026.2',
      prices: [
        {
          route: 'GET /v1/gst-lookup',
          priceUsdc: '0.10',
          priceMicroUsdc: '100000',
          description: 'GSTIN lookup'
        },
        { route: 'GET /v1/company/:cin', priceUsdc: '0.25', priceMicroUsdc: '250000' }
      ],
      unverifiedPolicy: 'threshold_tolerant',
      acceptedLevels: [0, 1, 2],
      registrationUrl: 'https://console.kosha.dev/register'
    });
  });

  it('leaves out a registration link the owner has not given', () => {
    const { registrationUrl: _omitted, ...withoutLink } = TERMS;

    expect(buildTerms(ROUTES, 'hedera:testnet', withoutLink)).not.toHaveProperty('registrationUrl');
  });
});

describe('createGateHandler: terms', () => {
  const setup = (terms?: TermsOptions) => {
    const fetchMock = vi.fn<typeof fetch>();
    const handle = createGateHandler({
      core: 'https://core.test',
      apiKey: 'key_123',
      fetch: fetchMock,
      routes: ROUTES,
      terms
    });
    return { handle, fetchMock };
  };
  const termsRequest = (method = 'GET') => ({
    method,
    url: `https://api.demo-in.dev${TERMS_PATH}`,
    headers: {}
  });

  it('serves the terms without calling Core', async () => {
    const { handle, fetchMock } = setup(TERMS);

    const result = await handle(termsRequest());

    expect(result).toEqual({
      action: 'respond',
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      body: buildTerms(ROUTES, 'hedera:testnet', TERMS)
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes the path through when no terms are configured', async () => {
    const { handle } = setup();

    expect(await handle(termsRequest())).toEqual({ action: 'next' });
  });

  it('serves the terms only to GET', async () => {
    const { handle } = setup(TERMS);

    expect(await handle(termsRequest('POST'))).toEqual({ action: 'next' });
  });
});
