import { CORE_PATHS } from './core-client';
import { koshaHono, type KoshaHonoEnv, type KoshaHonoOptions } from './hono-middleware';
import { encodeHeader, HEADERS } from '@kosha/shared/headers';
import { paymentRequired, splitEntry } from '@kosha/shared/x402-payment.fixture';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { type Handler, Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const GST_PATH = '/v1/gst-lookup';
const URL_BASE = 'http://api.test';
const AGENT = 'hedera:testnet:0.0.6001';

// Core's quote for the payment priced the route at exactly 0.10 USDC
const VERIFIED_EXTRA = { kosha: { quoteId: 'q_7f3a', priceMicroUsdc: '100000' } };

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
      tdsMicroUsdc: '1019',
      priceMicroUsdc: '100000'
    }
  }
};

const PAYMENT = encodeHeader({
  x402Version: 2,
  accepted: splitEntry,
  payload: { transaction: 'AAEC' }
});

type CoreReplies = Partial<Record<keyof typeof CORE_PATHS, () => Response>>;

// A Hono app behind koshaHono, with a fake Core and a handler that records each call
const setup = (
  replies: CoreReplies = {},
  options: Partial<KoshaHonoOptions> = {},
  handler: Handler<KoshaHonoEnv> = (c) =>
    c.json({ gstin: 'demo', paidBy: c.get('kosha')?.agentId ?? null })
) => {
  const defaults: Required<CoreReplies> = {
    quote: () => Response.json(paymentRequired),
    verify: () => Response.json({ isValid: true, payer: '0.0.6001', extra: VERIFIED_EXTRA }),
    settle: () => Response.json(SETTLED)
  };
  const coreCalls: string[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname;
    const name = (Object.keys(CORE_PATHS) as (keyof typeof CORE_PATHS)[]).find(
      (key) => CORE_PATHS[key] === path
    );
    if (!name) throw new Error(`unexpected Core call: ${path}`);
    coreCalls.push(name);
    return (replies[name] ?? defaults[name])();
  });
  const handlerSpy = vi.fn(handler);
  const onSettled = vi.fn();

  const app = new Hono<KoshaHonoEnv>();
  app.use(
    koshaHono({
      core: 'https://core.test',
      apiKey: 'key_123',
      fetch: fetchMock,
      onChainProof: false,
      routes: { [`GET ${GST_PATH}`]: { priceUsdc: '0.10' } },
      onSettled,
      ...options
    })
  );
  app.get(GST_PATH, handlerSpy);
  app.get('/health', (c) => c.json({ ok: true }));
  return { app, coreCalls, handlerSpy, onSettled };
};

const paid = (app: Hono<KoshaHonoEnv>) =>
  app.request(`${URL_BASE}${GST_PATH}`, {
    headers: { [HEADERS.paymentSignature]: PAYMENT, [HEADERS.koshaAgent]: AGENT }
  });

describe('koshaHono: settleMode "before"', () => {
  it('answers an unpaid request with the 402 quote, header and body', async () => {
    const { app, handlerSpy } = setup();

    const response = await app.request(`${URL_BASE}${GST_PATH}`, {
      headers: { [HEADERS.koshaAgent]: AGENT }
    });

    expect(response.status).toBe(402);
    const header = response.headers.get(HEADERS.paymentRequired) ?? '';
    expect(decodePaymentRequiredHeader(header).accepts).toHaveLength(2);
    expect(await response.json()).toMatchObject({ x402Version: 2 });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('settles a paid request, then runs the handler with c.get("kosha") and the receipt headers', async () => {
    const { app, coreCalls, onSettled } = setup();

    const response = await paid(app);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ gstin: 'demo', paidBy: AGENT });
    expect(coreCalls).toEqual(['verify', 'settle']);
    const receipt = decodePaymentResponseHeader(
      response.headers.get(HEADERS.paymentResponse) ?? ''
    );
    expect(receipt).toMatchObject({ success: true, transaction: SETTLED.transaction });
    expect(response.headers.get(HEADERS.koshaTax)).toBeTruthy();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('passes unpriced routes straight through without calling Core', async () => {
    const { app, coreCalls } = setup();

    const response = await app.request(`${URL_BASE}/health`);

    expect(await response.json()).toEqual({ ok: true });
    expect(coreCalls).toEqual([]);
  });

  it('answers 503 when Core is down, without running the handler', async () => {
    const down = () => {
      throw new TypeError('fetch failed');
    };
    const { app, handlerSpy } = setup({ quote: down });

    const response = await app.request(`${URL_BASE}${GST_PATH}`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'core_unavailable' });
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});

describe('koshaHono: settleMode "after"', () => {
  it('runs the handler first and settles only after a 2xx', async () => {
    const { app, coreCalls, onSettled } = setup({}, { settleMode: 'after' });

    const response = await paid(app);

    expect(response.status).toBe(200);
    expect(coreCalls).toEqual(['verify', 'settle']);
    expect(response.headers.get(HEADERS.paymentResponse)).toBeTruthy();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('does not charge for a call the handler failed', async () => {
    const { app, coreCalls } = setup({}, { settleMode: 'after' }, (c) =>
      c.json({ message: 'no such GSTIN' }, 404)
    );

    const response = await paid(app);

    expect(response.status).toBe(404);
    expect(coreCalls).toEqual(['verify']);
  });

  it('replaces the handler response with a 402 when settlement fails', async () => {
    const failed = () =>
      Response.json({
        success: false,
        errorReason: 'replay',
        transaction: '',
        network: 'hedera:testnet'
      });
    const { app } = setup({ settle: failed }, { settleMode: 'after' });

    const response = await paid(app);

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ error: 'replay' });
  });
});
