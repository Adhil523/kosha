import { CORE_PATHS, createCoreClient } from './core-client';
import { amountSchema } from '@kosha/shared/money';
import { paymentRequired } from '@kosha/shared/x402-payment.fixture';
import { describe, expect, it, vi } from 'vitest';

const QUOTE_REQUEST = {
  method: 'GET',
  resource: { url: 'https://api.demo-in.dev/v1/gst-lookup' },
  priceMicroUsdc: amountSchema.parse('100000')
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

const clientWith = (respond: () => Promise<Response>) => {
  const fetchMock = vi.fn<typeof fetch>(respond);
  const client = createCoreClient({
    core: 'https://core.test/',
    apiKey: 'key_123',
    fetch: fetchMock
  });
  return { client, fetchMock };
};

describe('createCoreClient', () => {
  it('posts the quote with the API key and returns the parsed 402 body', async () => {
    const { client, fetchMock } = clientWith(async () => jsonResponse(200, paymentRequired));

    const result = await client.quote(QUOTE_REQUEST);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.accepts).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://core.test${CORE_PATHS.quote}`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer key_123' });
    expect(JSON.parse(String(init?.body))).toEqual(QUOTE_REQUEST);
  });

  it.each([401, 403])('reports a %s as unauthorized', async (status) => {
    const { client } = clientWith(async () => jsonResponse(status, { error: 'unauthorized' }));

    expect(await client.quote(QUOTE_REQUEST)).toEqual({
      ok: false,
      data: { reason: 'unauthorized', status }
    });
  });

  it("reports a 403 with a policy code as Core's refusal", async () => {
    const body = { error: 'policy_daily', message: 'daily cap of 5 USDC reached' };
    const { client } = clientWith(async () => jsonResponse(403, body));

    expect(await client.quote(QUOTE_REQUEST)).toEqual({
      ok: false,
      data: { reason: 'refused', status: 403, ...body }
    });
  });

  it("reports another 4xx with Core's error body as Core's refusal", async () => {
    const body = { error: 'invalid_payload', message: 'X-KOSHA-AGENT is required' };
    const { client } = clientWith(async () => jsonResponse(400, body));

    expect(await client.quote(QUOTE_REQUEST)).toEqual({
      ok: false,
      data: { reason: 'refused', status: 400, ...body }
    });
  });

  it('keeps a 401 as unauthorized whatever its body says', async () => {
    const { client } = clientWith(async () => jsonResponse(401, { error: 'policy_daily' }));

    expect(await client.quote(QUOTE_REQUEST)).toEqual({
      ok: false,
      data: { reason: 'unauthorized', status: 401 }
    });
  });

  it.each([{ error: 'not_found' }, { message: 'no code' }, 'not json'])(
    'keeps a 403 without a policy code as unauthorized (%j)',
    async (body) => {
      const { client } = clientWith(async () => jsonResponse(403, body));

      expect(await client.quote(QUOTE_REQUEST)).toEqual({
        ok: false,
        data: { reason: 'unauthorized', status: 403 }
      });
    }
  );

  it('reports a 5xx as core_unavailable', async () => {
    const { client } = clientWith(async () => jsonResponse(503, {}));

    expect(await client.quote(QUOTE_REQUEST)).toEqual({
      ok: false,
      data: { reason: 'core_unavailable', status: 503 }
    });
  });

  it('reports a network failure or timeout as core_unavailable', async () => {
    const { client } = clientWith(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });

    expect(await client.verify({} as never)).toEqual({
      ok: false,
      data: { reason: 'core_unavailable' }
    });
  });

  it.each([
    ['a body that breaks the contract', () => jsonResponse(200, { isValid: 'yes' })],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })]
  ])('reports %s as invalid_response', async (_label, respond) => {
    const { client } = clientWith(async () => respond());

    expect(await client.verify({} as never)).toEqual({
      ok: false,
      data: { reason: 'invalid_response', status: 200 }
    });
  });

  it('passes an aborted request signal so a hung Core times out', async () => {
    const { client, fetchMock } = clientWith(async () => jsonResponse(200, { isValid: true }));

    await client.verify({} as never);

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
