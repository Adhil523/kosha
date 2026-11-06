import { CORE_PATHS } from './core-client';
import { createGateHandler, type GateRequest, type GateResult } from './gate-handler';
import { ERROR_CODES } from '@kosha/shared/error-codes';
import { encodeHeader, HEADERS } from '@kosha/shared/headers';
import { exactEntry, paymentRequired, splitEntry } from '@kosha/shared/x402-payment.fixture';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { describe, expect, it, vi } from 'vitest';

const URL_GST = 'https://api.demo-in.dev/v1/gst-lookup?gstin=29ABCDE1234F1Z5';
const AGENT = 'hedera:testnet:0.0.6001';

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

const paymentFor = (accepted: unknown) =>
  encodeHeader({ x402Version: 2, accepted, payload: { transaction: 'AAEC' } });

type CoreReplies = Partial<Record<keyof typeof CORE_PATHS, () => Response | Promise<Response>>>;

const json = (body: unknown, status = 200) => Response.json(body, { status });

// A fake Core: each path answers with the given reply, or a happy-path default
const setup = (replies: CoreReplies = {}) => {
  const defaults: Required<CoreReplies> = {
    quote: () => json(paymentRequired),
    verify: () => json({ isValid: true, payer: '0.0.6001' }),
    settle: () => json(SETTLED)
  };
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    const name = (Object.keys(CORE_PATHS) as (keyof typeof CORE_PATHS)[]).find(
      (key) => CORE_PATHS[key] === path
    );
    if (!name) {
      throw new Error(`unexpected Core call: ${path}`);
    }
    return (replies[name] ?? defaults[name])();
  });
  const handle = createGateHandler({
    core: 'https://core.test',
    apiKey: 'key_123',
    fetch: fetchMock,
    routes: { 'GET /v1/gst-lookup': { priceUsdc: '0.10', description: 'GSTIN lookup' } }
  });
  const calls = (path: string) =>
    fetchMock.mock.calls
      .filter(([input]) => new URL(String(input)).pathname === path)
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
  return { handle, calls };
};

const request = (headers: GateRequest['headers'] = {}, method = 'GET'): GateRequest => ({
  method,
  url: URL_GST,
  headers
});

const expectRespond = (result: GateResult) => {
  if (result.action !== 'respond') {
    throw new Error(`expected respond, got ${result.action}`);
  }
  return result;
};

describe('createGateHandler: unpaid request', () => {
  it('answers 402 with the quote in PAYMENT-REQUIRED and the body', async () => {
    const { handle, calls } = setup();

    const result = expectRespond(await handle(request({ 'x-kosha-agent': AGENT })));

    expect(result.status).toBe(402);
    expect(result.body).toEqual(paymentRequired);
    const header = result.headers[HEADERS.paymentRequired] ?? '';
    // A stock x402 client reads the same thing, with both accepts[] entries
    expect(decodePaymentRequiredHeader(header)).toEqual(paymentRequired);
    expect(result.headers['access-control-expose-headers']).toContain(HEADERS.paymentRequired);
    expect(calls(CORE_PATHS.quote)).toEqual([
      {
        method: 'GET',
        resource: { url: URL_GST, description: 'GSTIN lookup' },
        priceMicroUsdc: '100000',
        agent: AGENT
      }
    ]);
  });

  it('quotes a caller with a malformed X-KOSHA-AGENT as unverified', async () => {
    const { handle, calls } = setup();

    await handle(request({ 'x-kosha-agent': '0x1234' }));

    expect(calls(CORE_PATHS.quote)[0]).not.toHaveProperty('agent');
  });

  it('lets an unpriced route through without calling Core', async () => {
    const { handle, calls } = setup();

    const result = await handle({ method: 'GET', url: 'https://api.test/health', headers: {} });

    expect(result).toEqual({ action: 'next' });
    expect(calls(CORE_PATHS.quote)).toEqual([]);
  });

  it('answers a CORS preflight for a priced route', async () => {
    const { handle } = setup();

    const result = expectRespond(
      await handle(request({ 'access-control-request-method': 'GET' }, 'OPTIONS'))
    );

    expect(result.status).toBe(204);
    expect(result.headers['access-control-allow-headers']).toBe(
      'PAYMENT-SIGNATURE, X-KOSHA-AGENT, Content-Type'
    );
  });
});

describe('createGateHandler: paid request', () => {
  it.each([
    ['PAYMENT-SIGNATURE', 'payment-signature'],
    ['the legacy X-PAYMENT', 'x-payment']
  ])('verifies, settles and passes through with %s', async (_label, header) => {
    const { handle, calls } = setup();
    const payment = paymentFor(splitEntry);

    const result = await handle(request({ [header]: payment, 'x-kosha-agent': AGENT }));

    if (result.action !== 'pass') {
      throw new Error(`expected pass, got ${result.action}`);
    }
    expect(result.kosha).toEqual({
      route: 'GET /v1/gst-lookup',
      agentId: AGENT,
      payer: '0.0.6001',
      txId: SETTLED.transaction,
      hashscanUrl: SETTLED.extensions.kosha.hashscanUrl,
      tdsMicroUsdc: 1019n,
      hcsSequence: 42
    });
    expect(result.headers[HEADERS.koshaTax]).toBe(
      'rateBps=100; tdsMicroUsdc=1019; rulepack=in-2026.2'
    );
    expect(decodePaymentResponseHeader(result.headers[HEADERS.paymentResponse] ?? '')).toEqual(
      SETTLED
    );
    const facilitatorBody = { x402Version: 2, paymentRequirements: splitEntry };
    expect(calls(CORE_PATHS.verify)).toEqual([expect.objectContaining(facilitatorBody)]);
    expect(calls(CORE_PATHS.settle)).toEqual([expect.objectContaining(facilitatorBody)]);
  });

  it('accepts the compatibility entry, whose all-in total covers the price', async () => {
    const { handle } = setup();

    const result = await handle(request({ 'payment-signature': paymentFor(exactEntry) }));

    expect(result.action).toBe('pass');
    expect(result.action === 'pass' && result.headers[HEADERS.koshaTax]).toBe('tdsMicroUsdc=1019');
  });
});

const VERIFIER_CODES = ERROR_CODES.slice(0, ERROR_CODES.indexOf('bad_signature') + 1);

describe('createGateHandler: failed payment', () => {
  it.each([...VERIFIER_CODES, 'quote_expired', 'quote_not_found', 'replay', 'policy_daily'])(
    'answers 402 with %s when Core rejects the payment, and never settles',
    async (code) => {
      const { handle, calls } = setup({
        verify: () =>
          json({
            isValid: false,
            invalidReason: 'invalid_payload',
            extra: { kosha: { quoteId: 'q_7f3a', errorCode: code } }
          })
      });

      const result = expectRespond(
        await handle(request({ 'payment-signature': paymentFor(splitEntry) }))
      );

      expect(result.status).toBe(402);
      expect(result.body).toEqual({ x402Version: 2, error: code });
      const response = decodePaymentResponseHeader(result.headers[HEADERS.paymentResponse] ?? '');
      expect(response).toMatchObject({
        success: false,
        transaction: '',
        network: 'hedera:testnet'
      });
      expect(calls(CORE_PATHS.settle)).toEqual([]);
    }
  );

  it('answers 402 replay when the same payment settles twice', async () => {
    const replayed = {
      success: false,
      errorReason: 'replay',
      transaction: '',
      network: 'hedera:testnet'
    };
    const { handle } = setup({ settle: () => json(replayed) });

    const result = expectRespond(
      await handle(request({ 'payment-signature': paymentFor(splitEntry) }))
    );

    expect(result.body).toEqual({ x402Version: 2, error: 'replay' });
    expect(decodePaymentResponseHeader(result.headers[HEADERS.paymentResponse] ?? '')).toEqual(
      replayed
    );
  });

  it.each([
    ['a header that is not base64 JSON', 'not-base64!'],
    ['a payload of the wrong shape', encodeHeader({ x402Version: 1 })]
  ])('answers 402 invalid_payload for %s without calling Core', async (_label, header) => {
    const { handle, calls } = setup();

    const result = expectRespond(await handle(request({ 'payment-signature': header })));

    expect(result.body).toEqual({ x402Version: 2, error: 'invalid_payload' });
    expect(calls(CORE_PATHS.verify)).toEqual([]);
  });

  it('refuses a quote for a different price before calling Core', async () => {
    const { handle, calls } = setup();
    const cheaper = { ...splitEntry, amount: '50000' };

    const result = expectRespond(
      await handle(request({ 'payment-signature': paymentFor(cheaper) }))
    );

    expect(result.body).toEqual({ x402Version: 2, error: 'amount_mismatch' });
    expect(calls(CORE_PATHS.verify)).toEqual([]);
  });
});

describe('createGateHandler: Core unavailable', () => {
  const down = () => {
    throw new TypeError('fetch failed');
  };

  it.each([
    ['quoting', { quote: down }, {}],
    ['verifying', { verify: down }, { 'payment-signature': paymentFor(splitEntry) }],
    ['settling', { settle: down }, { 'payment-signature': paymentFor(splitEntry) }]
  ] as const)('answers 503 core_unavailable while %s', async (_label, replies, headers) => {
    const { handle } = setup(replies);

    const result = expectRespond(await handle(request(headers)));

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'core_unavailable' });
  });

  it('answers 503 unauthorized when Core rejects the API key', async () => {
    const { handle } = setup({ quote: () => json({ error: 'unauthorized' }, 401) });

    const result = expectRespond(await handle(request()));

    expect(result).toMatchObject({ status: 503, body: { error: 'unauthorized' } });
  });
});
