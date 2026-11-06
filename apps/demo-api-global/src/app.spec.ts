import { buildApp } from './app';
import { encodeHeader, HEADERS } from '@kosha/shared/headers';
import { paymentRequired, splitEntry } from '@kosha/shared/x402-payment.fixture';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const AGENT = 'hedera:testnet:0.0.6001';
const MERIDIAN_LEI = '5493001KQW6DM7KEDR62';

// A payment for the route's net price, 0.05 USDC
const PAYMENT = encodeHeader({
  x402Version: 2,
  accepted: { ...splitEntry, amount: '50000' },
  payload: { transaction: 'AAEC' }
});

const SETTLED = {
  success: true,
  payer: '0.0.6001',
  transaction: '0.0.6001@1762424000.000000001',
  network: 'hedera:testnet',
  amount: '50000',
  extensions: {
    kosha: {
      hashscanUrl: 'https://hashscan.io/testnet/transaction/1762424000.000000001',
      hcsSequence: 7,
      tdsMicroUsdc: '0'
    }
  }
};

// What Gate sends to verify and settle; only the paid amount matters here
const facilitatorBody = z.object({ paymentRequirements: z.object({ amount: z.string() }) });

const setup = () => {
  // Core reports the API price of the quote a payment paid; here that is the amount it carries
  const replies = new Map<string, (price: string) => Response>([
    ['/v1/quote', () => Response.json(paymentRequired)],
    [
      '/v1/verify',
      (price) =>
        Response.json({
          isValid: true,
          payer: '0.0.6001',
          extra: { kosha: { quoteId: 'q_7f3a', priceMicroUsdc: price } }
        })
    ],
    [
      '/v1/settle',
      (price) =>
        Response.json({
          ...SETTLED,
          extensions: { kosha: { ...SETTLED.extensions.kosha, priceMicroUsdc: price } }
        })
    ]
  ]);
  const priceIn = (body: RequestInit['body']): string => {
    const parsed = facilitatorBody.safeParse(typeof body === 'string' ? JSON.parse(body) : null);
    return parsed.success ? parsed.data.paymentRequirements.amount : '0';
  };
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const reply = replies.get(new URL(String(input)).pathname);
    if (!reply) {
      throw new Error(`unexpected Core call: ${String(input)}`);
    }
    return reply(priceIn(init?.body));
  });
  // The fake Core's transactions aren't on the Mirror Node; Gate's own tests cover the proof
  return buildApp({
    core: 'https://core.test',
    apiKey: 'key_123',
    fetch: fetchMock,
    onChainProof: false
  });
};

const paidGet = (path: string) =>
  request(setup()).get(path).set(HEADERS.paymentSignature, PAYMENT).set(HEADERS.koshaAgent, AGENT);

describe('demo-api-global', () => {
  it('quotes an unpaid lookup', async () => {
    const response = await request(setup()).get(`/v1/lei/${MERIDIAN_LEI}`).expect(402);

    expect(response.get(HEADERS.paymentRequired)).toBeDefined();
  });

  it('answers a paid lookup with the entity', async () => {
    const response = await paidGet(`/v1/lei/${MERIDIAN_LEI.toLowerCase()}`).expect(200);

    expect(response.body).toEqual({
      entity: expect.objectContaining({ lei: MERIDIAN_LEI, country: 'SG' }),
      paidBy: AGENT
    });
    expect(response.get(HEADERS.koshaTax)).toContain('tdsMicroUsdc=0');
  });

  it.each([
    ['a malformed LEI', '/v1/lei/ABC', 400],
    ['an LEI with wrong check digits', '/v1/lei/5493001KQW6DM7KEDR63', 400],
    ['an unknown LEI', '/v1/lei/5493000000000000AB75', 404]
  ])('answers %s with a message', async (_label, path, status) => {
    const response = await paidGet(path).expect(status);

    expect(response.body).toEqual({ message: expect.any(String) });
  });

  it('serves its terms with the net price', async () => {
    const response = await request(setup()).get('/.well-known/kosha').expect(200);

    expect(response.body.prices).toEqual([
      expect.objectContaining({ route: 'GET /v1/lei/:lei', priceMicroUsdc: '50000' })
    ]);
  });
});
