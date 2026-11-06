import { createKoshaPay } from './kosha-pay';
import { PAY_CONFIG } from './pay-config.fixture';
import { createMemorySpendStore } from './spend-store';
import { decodeHeader, encodeHeader, HEADERS } from '@kosha/shared/headers';
import { paymentPayloadSchema } from '@kosha/shared/x402-payment';
import { exactEntry, paymentRequired, splitEntry } from '@kosha/shared/x402-payment.fixture';
import { describe, expect, it, vi } from 'vitest';

// Two minutes before the fixture quote expires
const NOW = new Date('2026-11-06T10:30:00Z');
const URL_GST = 'https://api.demo-in.dev/v1/gst-lookup?gstin=29AAKCK4821M1ZQ';
const LEVEL_ZERO_ID = 'hedera:testnet:0.0.6001';

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

type Kosha = (typeof splitEntry)['extra']['kosha'];
const quoteWith = (kosha: Partial<Kosha>) => ({
  ...splitEntry,
  extra: { ...splitEntry.extra, kosha: { ...splitEntry.extra.kosha, ...kosha } }
});

const quoted = (accepts: unknown[] = paymentRequired.accepts) => {
  const body = { ...paymentRequired, accepts };
  return Response.json(body, {
    status: 402,
    headers: { [HEADERS.paymentRequired]: encodeHeader(body) }
  });
};

const settled = (settlement: unknown = SETTLED, status = 200) =>
  Response.json(
    { gstin: '29AAKCK4821M1ZQ' },
    { status, headers: { [HEADERS.paymentResponse]: encodeHeader(settlement) } }
  );

// A fake paid API: an unpaid call gets `unpaid()`, a paid one gets `paid()`
const setup = ({
  unpaid = () => quoted(),
  paid = () => settled()
}: { unpaid?: () => Response; paid?: () => Response } = {}) => {
  const fetchMock = vi.fn<typeof fetch>(async (_input, init) =>
    new Headers(init?.headers).has(HEADERS.paymentSignature) ? paid() : unpaid()
  );
  const store = createMemorySpendStore();
  const pay = createKoshaPay(PAY_CONFIG, { fetch: fetchMock, store, now: () => NOW });
  const sentHeaders = (call: number) => new Headers(fetchMock.mock.calls[call]?.[1]?.headers);
  return { pay, fetchMock, store, sentHeaders };
};

describe('createKoshaPay: fetch', () => {
  it('pays a 402 once and returns the paid response with a receipt', async () => {
    const { pay, fetchMock, store, sentHeaders } = setup();

    const response = await pay.fetch(URL_GST);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ gstin: '29AAKCK4821M1ZQ' });
    // One unpaid call, then exactly one retry
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentHeaders(0).get(HEADERS.koshaAgent)).toBe(LEVEL_ZERO_ID);
    expect(sentHeaders(1).get(HEADERS.koshaAgent)).toBe(LEVEL_ZERO_ID);

    const payment = decodeHeader(
      paymentPayloadSchema,
      sentHeaders(1).get(HEADERS.paymentSignature) ?? ''
    );
    expect(payment.ok && payment.data.accepted).toEqual(splitEntry);
    expect(pay.lastReceipt).toEqual({
      txId: SETTLED.transaction,
      payer: '0.0.6001',
      hashscanUrl: SETTLED.extensions.kosha.hashscanUrl,
      hcsSequence: 42,
      tdsMicroUsdc: 1019n,
      totalMicro: 101019n
    });
    expect(pay.lastError).toBeNull();
    expect(await store.totals(NOW)).toEqual({ dayMicro: 101019n, fyMicro: 101019n });
  });

  it('passes a free response straight through', async () => {
    const { pay, fetchMock } = setup({ unpaid: () => Response.json({ ok: true }) });

    const response = await pay.fetch(URL_GST);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pay.lastReceipt).toBeNull();
  });

  it('does not retry a second time when the paid call is refused', async () => {
    const { pay, fetchMock, store } = setup({
      paid: () => settled({ ...SETTLED, success: false, errorReason: 'replay' }, 402)
    });

    const response = await pay.fetch(URL_GST);

    expect(response.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pay.lastError).toEqual({
      reason: 'payment_rejected',
      message: 'the server refused: replay'
    });
    expect(await store.totals(NOW)).toEqual({ dayMicro: 0n, fyMicro: 0n });
  });

  it('counts a payment as spent when the receipt is missing', async () => {
    const { pay, store } = setup({ paid: () => Response.json({ ok: true }) });

    await pay.fetch(URL_GST);

    expect(pay.lastReceipt).toBeNull();
    expect((await store.totals(NOW)).dayMicro).toBe(101019n);
  });
});

describe('createKoshaPay: refusals before signing', () => {
  it.each([
    ['blocked by the allowlist', 'https://evil.example/v1/data', quoted(), 'policy_allowlist'],
    [
      'over the per-payment cap',
      URL_GST,
      quoted([quoteWith({ totalMicro: '600000' }), exactEntry]),
      'policy_per_payment'
    ],
    [
      'a tampered quote whose legs no longer sum to the total',
      URL_GST,
      quoted([quoteWith({ totalMicro: '100000' }), exactEntry]),
      'total_mismatch'
    ],
    [
      'a reserve leg to another account',
      URL_GST,
      quoted([
        quoteWith({
          transfers: [
            { account: '0.0.5001', amount: '100000', leg: 'consideration' },
            { account: '0.0.6666', amount: '1019', leg: 'tds_reserve' }
          ]
        }),
        exactEntry
      ]),
      'reserve_not_ours'
    ],
    ['a 402 with only the exact entry', URL_GST, quoted([exactEntry]), 'no_kosha_split'],
    [
      'an unreadable 402',
      URL_GST,
      new Response('nope', { status: 402, headers: { [HEADERS.paymentRequired]: '!!' } }),
      'invalid_402'
    ]
  ])('refuses %s and returns the 402 unchanged', async (_label, url, reply, reason) => {
    const { pay, fetchMock } = setup({ unpaid: () => reply });

    const response = await pay.fetch(url);

    expect(response.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pay.lastError?.reason).toBe(reason);
  });

  it('pays a 402 that also offers schemes and networks Kosha does not model', async () => {
    const evm = { ...splitEntry, scheme: 'exact', network: 'eip155:8453', asset: '0xabc' };
    const upto = { ...splitEntry, scheme: 'upto' };
    const { pay } = setup({ unpaid: () => quoted([evm, upto, splitEntry]) });

    const prepared = await pay.prepare(URL_GST);

    expect(prepared.ok && prepared.data.kind).toBe('payment');
  });

  it('reads the quote from the 402 body when the header is missing', async () => {
    const { pay } = setup({ unpaid: () => Response.json(paymentRequired, { status: 402 }) });

    const prepared = await pay.prepare(URL_GST);

    expect(prepared.ok && prepared.data.kind).toBe('payment');
  });
});

describe('createKoshaPay: prepare and complete', () => {
  it('signs in prepare() and sends nothing until complete()', async () => {
    const { pay, fetchMock } = setup();

    const prepared = await pay.prepare(URL_GST);

    if (!prepared.ok || prepared.data.kind !== 'payment') {
      throw new Error('expected a prepared payment');
    }
    expect(prepared.data.payment.totalMicro).toBe(101019n);
    expect(prepared.data.payment.warnings).toEqual([
      { reason: 'threshold_crossed', tdsMicroUsdc: 1019n }
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();

    const completed = await pay.complete(prepared.data.payment);

    expect(completed.ok && completed.data.receipt?.txId).toBe(SETTLED.transaction);
  });
});

describe('createKoshaPay: options', () => {
  it('throws on invalid options without printing the key', () => {
    const secret = 'not-a-real-key-but-still-secret';

    expect(() => createKoshaPay({ ...PAY_CONFIG, privateKey: secret, accountId: 'x' })).toThrow(
      /accountId/
    );
    expect(() => createKoshaPay({ ...PAY_CONFIG, privateKey: secret })).not.toThrow(secret);
  });
});
