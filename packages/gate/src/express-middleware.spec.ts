import { CORE_PATHS } from './core-client';
import { koshaGate, type KoshaGateOptions } from './express-middleware';
import { encodeHeader, HEADERS } from '@kosha/shared/headers';
import { paymentRequired, splitEntry } from '@kosha/shared/x402-payment.fixture';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const GST_PATH = '/v1/gst-lookup';
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

const PAYMENT = encodeHeader({
  x402Version: 2,
  accepted: splitEntry,
  payload: { transaction: 'AAEC' }
});

type CoreReplies = Partial<Record<keyof typeof CORE_PATHS, () => Response>>;

// An Express app behind koshaGate, with a fake Core and a handler that records each call
const setup = (
  replies: CoreReplies = {},
  options: Partial<KoshaGateOptions> = {},
  handler: express.RequestHandler = (req, res) => {
    res.json({ gstin: 'demo', paidBy: req.kosha?.agentId ?? null });
  }
) => {
  const defaults: Required<CoreReplies> = {
    quote: () => Response.json(paymentRequired),
    verify: () => Response.json({ isValid: true, payer: '0.0.6001' }),
    settle: () => Response.json(SETTLED)
  };
  const coreCalls: string[] = [];
  const quoteBodies: unknown[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const name = (Object.keys(CORE_PATHS) as (keyof typeof CORE_PATHS)[]).find(
      (key) => CORE_PATHS[key] === path
    );
    if (!name) {
      throw new Error(`unexpected Core call: ${path}`);
    }
    coreCalls.push(name);
    if (name === 'quote') {
      quoteBodies.push(JSON.parse(String(init?.body)));
    }
    return (replies[name] ?? defaults[name])();
  });
  const handlerSpy = vi.fn(handler);
  const onSettled = vi.fn();

  const app = express();
  app.use(
    koshaGate({
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
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  return { app, coreCalls, quoteBodies, handlerSpy, onSettled };
};

const paid = (app: express.Express) =>
  request(app).get(GST_PATH).set(HEADERS.paymentSignature, PAYMENT).set(HEADERS.koshaAgent, AGENT);

describe('koshaGate: settleMode "before"', () => {
  it('answers an unpaid request with a 402 quote', async () => {
    const { app, handlerSpy } = setup();

    const response = await request(app).get(GST_PATH).expect(402);

    expect(response.body).toEqual(paymentRequired);
    expect(decodePaymentRequiredHeader(response.get(HEADERS.paymentRequired) ?? '')).toEqual(
      paymentRequired
    );
    expect(response.get('access-control-expose-headers')).toContain(HEADERS.paymentResponse);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('quotes the absolute URL of the resource', async () => {
    const { app, quoteBodies } = setup();

    const response = await request(app).get(`${GST_PATH}?gstin=29ABCDE1234F1Z5`).expect(402);

    const host = new URL(response.request.url).host;
    expect(quoteBodies).toEqual([
      expect.objectContaining({
        method: 'GET',
        resource: expect.objectContaining({
          url: `http://${host}${GST_PATH}?gstin=29ABCDE1234F1Z5`
        })
      })
    ]);
  });

  it('settles a paid request, then runs the handler with req.kosha', async () => {
    const { app, coreCalls, onSettled } = setup();

    const response = await paid(app).expect(200);

    expect(response.body).toEqual({ gstin: 'demo', paidBy: AGENT });
    expect(coreCalls).toEqual(['verify', 'settle']);
    expect(decodePaymentResponseHeader(response.get(HEADERS.paymentResponse) ?? '')).toEqual(
      SETTLED
    );
    expect(response.get(HEADERS.koshaTax)).toBe(
      'rateBps=100; tdsMicroUsdc=1019; rulepack=in-2026.2'
    );
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ txId: SETTLED.transaction }));
  });

  it('refuses a failed payment with 402 and never runs the handler', async () => {
    const { app, handlerSpy } = setup({
      verify: () => Response.json({ isValid: false, invalidReason: 'replay' })
    });

    const response = await paid(app).expect(402);

    expect(response.body).toMatchObject({ x402Version: 2, error: 'invalid_payload' });
    expect(decodePaymentResponseHeader(response.get(HEADERS.paymentResponse) ?? '')).toMatchObject({
      success: false
    });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('answers 503 when Core is down', async () => {
    const { app } = setup({ quote: () => new Response('down', { status: 502 }) });

    const response = await request(app).get(GST_PATH).expect(503);

    expect(response.body).toEqual({ error: 'core_unavailable' });
  });

  it('answers a CORS preflight for a priced route', async () => {
    const { app } = setup();

    const response = await request(app)
      .options(GST_PATH)
      .set('access-control-request-method', 'GET')
      .expect(204);

    expect(response.get('access-control-allow-headers')).toContain(HEADERS.paymentSignature);
  });

  it('lets an unpriced route through without calling Core', async () => {
    const { app, coreCalls } = setup();

    await request(app).get('/health').expect(200, { ok: true });

    expect(coreCalls).toEqual([]);
  });
});

describe('koshaGate: settleMode "after"', () => {
  const after = { settleMode: 'after' } as const;

  it('runs the handler first, then settles and sends its body', async () => {
    const { app, coreCalls, onSettled } = setup({}, after);

    const response = await paid(app).expect(200);

    // The handler ran before settlement, so it had no req.kosha
    expect(response.body).toEqual({ gstin: 'demo', paidBy: null });
    expect(coreCalls).toEqual(['verify', 'settle']);
    expect(response.get(HEADERS.paymentResponse)).toBeDefined();
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('does not charge for a handler that failed', async () => {
    const { app, coreCalls } = setup({}, after, (_req, res) => {
      res.status(500).json({ error: 'lookup failed' });
    });

    await paid(app).expect(500, { error: 'lookup failed' });

    expect(coreCalls).toEqual(['verify']);
  });

  it('replaces the body with a 402 when settlement fails', async () => {
    const { app } = setup(
      { settle: () => Response.json({ ...SETTLED, success: false, errorReason: 'replay' }) },
      after,
      (_req, res) => {
        res.type('text/plain').send('secret data');
      }
    );

    const response = await paid(app).expect(402);

    expect(response.type).toBe('application/json');
    expect(response.body).toMatchObject({ error: 'replay' });
    expect(response.text).not.toContain('secret data');
  });

  it('collects a body written in several chunks', async () => {
    const { app } = setup({}, after, (_req, res) => {
      res.type('text/plain');
      res.write('first ');
      res.write(Buffer.from('second '));
      res.end('third');
    });

    const response = await paid(app).expect(200);

    expect(response.text).toBe('first second third');
  });

  it('refuses an invalid payment before the handler runs', async () => {
    const { app, handlerSpy } = setup(
      { verify: () => Response.json({ isValid: false, invalidReason: 'quote_expired' }) },
      after
    );

    await paid(app).expect(402);

    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
