import { CORE_PATHS } from './core-client';
import {
  createGateHandler,
  type GateOptions,
  type GateRequest,
  type GateResult
} from './gate-handler';
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
const setup = (replies: CoreReplies = {}, overrides: Partial<GateOptions> = {}) => {
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
    onChainProof: false,
    routes: { 'GET /v1/gst-lookup': { priceUsdc: '0.10', description: 'GSTIN lookup' } },
    ...overrides
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
      hcsSequence: 42,
      reserveProof: 'off'
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

describe('createGateHandler: deferred settlement', () => {
  it('verifies now and settles only when asked', async () => {
    const { handle, calls } = setup();

    const result = await handle(request({ 'payment-signature': paymentFor(splitEntry) }), {
      deferSettle: true
    });

    if (result.action !== 'verified') {
      throw new Error(`expected verified, got ${result.action}`);
    }
    expect(calls(CORE_PATHS.verify)).toHaveLength(1);
    expect(calls(CORE_PATHS.settle)).toEqual([]);

    const settled = await result.settle();

    expect(settled.action).toBe('pass');
    expect(calls(CORE_PATHS.settle)).toHaveLength(1);
  });

  it('refuses an invalid payment before the API handler runs', async () => {
    const { handle, calls } = setup({
      verify: () =>
        json({ isValid: false, invalidReason: 'quote_expired', invalidMessage: 'expired' })
    });

    const result = await handle(request({ 'payment-signature': paymentFor(splitEntry) }), {
      deferSettle: true
    });

    expect(expectRespond(result).status).toBe(402);
    expect(calls(CORE_PATHS.settle)).toEqual([]);
  });

  it('still quotes an unpaid request', async () => {
    const { handle } = setup();

    const result = await handle(request(), { deferSettle: true });

    expect(expectRespond(result).status).toBe(402);
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

describe('createGateHandler: on-chain reserve proof', () => {
  // The settled transaction as the Mirror Node shows it, crediting the reserve `reserveMicro`
  /* eslint-disable @typescript-eslint/naming-convention -- Mirror Node fields are snake_case */
  const mirrorWith = (reserveMicro: number | null) =>
    vi.fn(async () =>
      reserveMicro === null
        ? Response.json({}, { status: 404 })
        : Response.json({
            transactions: [
              {
                transaction_id: '0.0.6001-1762424000-000000001',
                consensus_timestamp: '1762424002.000000001',
                result: 'SUCCESS',
                name: 'CRYPTOTRANSFER',
                token_transfers: [
                  { token_id: splitEntry.asset, account: '0.0.5001', amount: 100000 },
                  { token_id: splitEntry.asset, account: '0.0.6101', amount: reserveMicro }
                ]
              }
            ]
          })
    );
  /* eslint-enable @typescript-eslint/naming-convention */
  const proofOptions = (mirrorFetch: ReturnType<typeof mirrorWith>) => ({
    onChainProof: { mirrorUrl: 'https://mirror.test', fetch: mirrorFetch, sleep: async () => {} }
  });
  const paid = request({ 'payment-signature': paymentFor(splitEntry) });

  it('passes once the reserve leg is proven on-chain', async () => {
    const { handle } = setup({}, proofOptions(mirrorWith(1019)));
    const result = await handle(paid);
    expect(result.action === 'pass' && result.kosha.reserveProof).toBe('proven');
  });

  it('refuses with amount_mismatch when the chain shows a short reserve, whatever Core said', async () => {
    const { handle } = setup({}, proofOptions(mirrorWith(1000)));
    const result = expectRespond(await handle(paid));
    expect(result.status).toBe(402);
    expect(result.body).toMatchObject({
      error: 'amount_mismatch',
      message: 'reserve proof: reserve_short'
    });
    expect(
      decodePaymentResponseHeader(result.headers[HEADERS.paymentResponse] ?? '')
    ).toMatchObject({
      success: false,
      errorReason: 'amount_mismatch',
      transaction: SETTLED.transaction
    });
  });

  it('still serves, marked unconfirmed, when the Mirror Node lags past the timeout', async () => {
    const { handle } = setup({}, proofOptions(mirrorWith(null)));
    const result = await handle(paid);
    expect(result.action === 'pass' && result.kosha.reserveProof).toBe('unconfirmed');
  });
});
