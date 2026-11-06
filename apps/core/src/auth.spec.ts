import { buildApp } from './app';
import { authenticateReceiver, generateApiKey, hashApiKey, requireAdmin } from './auth';
import type { DbHandle } from './db/client';
import { receiver } from './db/schema';
import { testDb } from './db/test-db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ADMIN_TOKEN = 'a'.repeat(48);

describe('requireAdmin', () => {
  const app = buildApp({
    logger: false,
    routes: [
      (instance) => {
        instance.get('/admin-only', { preHandler: requireAdmin(ADMIN_TOKEN) }, () => ({
          ok: true
        }));
      }
    ]
  });

  it.each([
    ['no header', {}],
    ['a wrong token', { authorization: `Bearer ${'b'.repeat(48)}` }],
    ['a token of another length', { authorization: 'Bearer short' }],
    ['a non-bearer scheme', { authorization: `Basic ${ADMIN_TOKEN}` }]
  ])('refuses %s', async (_case, headers) => {
    const response = await app.inject({ method: 'GET', url: '/admin-only', headers });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  it('lets the admin token through', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    expect(response.json()).toEqual({ ok: true });
  });
});

describe('authenticateReceiver', () => {
  let handle: DbHandle;
  const apiKey = generateApiKey();

  beforeAll(async () => {
    handle = await testDb();
    await handle.db.insert(receiver).values({
      legalName: 'Demo GST Data Pvt Ltd',
      residency: 'resident',
      specifiedPerson: false,
      mode: 'threshold',
      unverifiedPolicy: 'threshold_tolerant',
      apiKeyHash: hashApiKey(apiKey)
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it('generates 64-hex keys and stores only their hash', () => {
    expect(apiKey).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(apiKey)).not.toContain(apiKey);
  });

  it('finds the receiver behind a valid key', async () => {
    const found = await authenticateReceiver(handle.db, {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    expect(found.ok && found.data.legalName).toBe('Demo GST Data Pvt Ltd');
  });

  it('refuses a missing or unknown key', async () => {
    for (const headers of [{}, { authorization: `Bearer ${generateApiKey()}` }]) {
      expect(await authenticateReceiver(handle.db, { headers })).toEqual({
        ok: false,
        data: { error: 'unauthorized' }
      });
    }
  });
});
