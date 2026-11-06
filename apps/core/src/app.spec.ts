import { buildApp, type RegisterRoutes } from './app';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const echoRoute: RegisterRoutes = (app) => {
  app.post(
    '/echo',
    { schema: { body: z.object({ amount: z.string().regex(/^\d+$/) }) } },
    (request) => ({ amount: request.body.amount })
  );
  app.get('/boom', () => {
    throw new Error('secret detail that must not leak');
  });
};

describe('buildApp', () => {
  const app = buildApp({ logger: false, routes: [echoRoute] });

  it('answers the health check', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('validates a body with its Zod schema', async () => {
    const valid = await app.inject({ method: 'POST', url: '/echo', payload: { amount: '100' } });
    expect(valid.json()).toEqual({ amount: '100' });

    const invalid = await app.inject({ method: 'POST', url: '/echo', payload: { amount: 1.5 } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: 'invalid_payload' });
  });

  it('answers an unknown route with not_found', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/nothing' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('hides the detail of an unexpected error', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
  });
});
