import { api, type Fetch } from '@/lib/api';
import { describe, expect, it } from 'vitest';

const respond =
  (body: string | null, status = 200): Fetch =>
  async () =>
    new Response(body, { status });

describe('api', () => {
  it('returns ok with parsed JSON', async () => {
    const response = await api.get<{ a: number }>('http://core/x', {
      customFetch: respond('{"a":1}')
    });

    expect(response).toEqual({ ok: true, status: 200, data: { a: 1 } });
  });

  it('returns the error body on a non-2xx status', async () => {
    const response = await api.get('http://core/x', {
      customFetch: respond('{"message":"nope"}', 401)
    });

    expect(response).toEqual({ ok: false, status: 401, data: { message: 'nope' } });
  });

  it('treats an empty 204 as null data', async () => {
    const response = await api.delete('http://core/x', { customFetch: respond(null, 204) });

    expect(response).toEqual({ ok: true, status: 204, data: null });
  });

  it('sends a JSON body with a content type', async () => {
    let seen: RequestInit | undefined;
    const customFetch: Fetch = async (_url, init) => {
      seen = init;
      return new Response('{}');
    };

    await api.post('http://core/x', { b: 2 }, { customFetch });

    expect(seen?.body).toBe('{"b":2}');
    expect(seen?.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('turns a network failure into status 0', async () => {
    const customFetch: Fetch = async () => {
      throw new TypeError('fetch failed');
    };

    const response = await api.get('http://core/x', { customFetch });

    expect(response).toEqual({ ok: false, status: 0, data: { message: 'fetch failed' } });
  });
});
