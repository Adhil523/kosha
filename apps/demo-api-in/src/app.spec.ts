import { buildApp } from './app';
import { encodeHeader, HEADERS } from '@kosha/shared/headers';
import { paymentRequired, splitEntry } from '@kosha/shared/x402-payment.fixture';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const AGENT = 'hedera:testnet:0.0.6001';
const KAVERI = { gstin: '29AAKCK4821M1ZQ', cin: 'U72200KA2016PTC094512' };

const SETTLED = {
  success: true,
  payer: '0.0.6001',
  transaction: '0.0.6001@1762424000.000000001',
  network: 'hedera:testnet',
  amount: '100000',
  extensions: {
    kosha: {
      hashscanUrl: 'https://hashscan.io/testnet/transaction/1762424000.000000001',
      hcsSequence: 42,
      tdsMicroUsdc: '1019'
    }
  }
};

// A payment for a route's net price: Gate refuses one quoted for a different route
const paymentFor = (amount: string) =>
  encodeHeader({
    x402Version: 2,
    accepted: { ...splitEntry, amount },
    payload: { transaction: 'AAEC' }
  });

const PRICES = { gstLookup: '100000', company: '250000' } as const;

// The app against a fake Core that quotes, verifies and settles everything
const setup = () => {
  const replies = new Map<string, () => Response>([
    ['/v1/quote', () => Response.json(paymentRequired)],
    ['/v1/verify', () => Response.json({ isValid: true, payer: '0.0.6001' })],
    ['/v1/settle', () => Response.json(SETTLED)]
  ]);
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const reply = replies.get(new URL(String(input)).pathname);
    if (!reply) {
      throw new Error(`unexpected Core call: ${String(input)}`);
    }
    return reply();
  });
  const app = buildApp({
    core: 'https://core.test',
    apiKey: 'key_123',
    fetch: fetchMock,
    registrationUrl: 'http://localhost:3000/agents'
  });
  return { app, fetchMock };
};

const paidGet = (path: string, amount: string = PRICES.gstLookup) => {
  const { app } = setup();
  return request(app)
    .get(path)
    .set(HEADERS.paymentSignature, paymentFor(amount))
    .set(HEADERS.koshaAgent, AGENT);
};

describe('demo-api-in', () => {
  it('serves /health free', async () => {
    const { app, fetchMock } = setup();

    await request(app).get('/health').expect(200, { ok: true });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('quotes an unpaid GST lookup', async () => {
    const { app } = setup();

    const response = await request(app).get(`/v1/gst-lookup?gstin=${KAVERI.gstin}`).expect(402);

    expect(response.get(HEADERS.paymentRequired)).toBeDefined();
  });

  it('answers a paid GST lookup with the registration', async () => {
    const response = await paidGet(`/v1/gst-lookup?gstin=${KAVERI.gstin.toLowerCase()}`).expect(
      200
    );

    expect(response.body).toEqual({
      registration: {
        gstin: KAVERI.gstin,
        legalName: 'Kaveri Analytics Private Limited',
        tradeName: 'Kaveri Analytics',
        state: 'Karnataka',
        status: 'Active',
        registeredOn: '2017-07-01'
      },
      paidBy: AGENT
    });
    expect(response.get(HEADERS.paymentResponse)).toBeDefined();
  });

  it('refuses a payment quoted for the cheaper route', async () => {
    const response = await paidGet(`/v1/company/${KAVERI.cin}`, PRICES.gstLookup).expect(402);

    expect(response.body).toMatchObject({ error: 'amount_mismatch' });
  });

  it('answers a paid company lookup with its master data', async () => {
    const response = await paidGet(`/v1/company/${KAVERI.cin}`, PRICES.company).expect(200);

    expect(response.body.company).toMatchObject({ cin: KAVERI.cin, gstins: [KAVERI.gstin] });
  });

  it.each([
    ['a malformed GSTIN', '/v1/gst-lookup?gstin=123', PRICES.gstLookup, 400],
    ['a missing GSTIN', '/v1/gst-lookup', PRICES.gstLookup, 400],
    ['an unknown GSTIN', '/v1/gst-lookup?gstin=27AAAAA0000A1Z5', PRICES.gstLookup, 404],
    ['a malformed CIN', '/v1/company/U123', PRICES.company, 400],
    ['an unknown CIN', '/v1/company/U00000MH2000PTC000000', PRICES.company, 404]
  ])('answers %s with a message', async (_label, path, amount, status) => {
    const response = await paidGet(path, amount).expect(status);

    expect(response.body).toEqual({ message: expect.any(String) });
  });

  it('serves its terms at /.well-known/kosha', async () => {
    const { app } = setup();

    const response = await request(app).get('/.well-known/kosha').expect(200);

    expect(response.body).toMatchObject({
      rulepack: 'in-2026.2',
      unverifiedPolicy: 'threshold_tolerant',
      prices: [
        { route: 'GET /v1/gst-lookup', priceUsdc: '0.10' },
        { route: 'GET /v1/company/:cin', priceUsdc: '0.25' }
      ],
      registrationUrl: 'http://localhost:3000/agents'
    });
  });
});
