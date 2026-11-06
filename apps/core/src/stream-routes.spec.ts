import { buildApp } from './app';
import type { DbHandle } from './db/client';
import { testDb } from './db/test-db';
import { createEventBus, type EventBus } from './event-bus';
import { ADMIN, ADMIN_TOKEN, type LedgerSeed, receiverAuth, seedParties } from './ledger.fixture';
import { streamRoutes } from './stream-routes';
import type { StreamEvent } from '@kosha/shared/console-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NEAR: StreamEvent = {
  type: 'threshold.near',
  receiverId: 'rcv',
  agentId: 'agt',
  pct: 90.05,
  promptLevel1: false
};

describe('GET /v1/stream', () => {
  let handle: DbHandle;
  let app: ReturnType<typeof buildApp>;
  let seed: LedgerSeed;
  let base = '';
  let open = 0;

  // Counts live subscriptions, so the test can see a closed stream let go of the bus
  const countingBus = (inner: EventBus): EventBus => ({
    publish: inner.publish,
    subscribe: (receiverId, listener) => {
      open += 1;
      const unsubscribe = inner.subscribe(receiverId, listener);
      return () => {
        open -= 1;
        unsubscribe();
      };
    }
  });
  const bus = countingBus(createEventBus());

  // Reads the stream until `done` says the text so far is enough
  const readUntil = async (response: Response, done: (text: string) => boolean) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no body');
    const decoder = new TextDecoder();
    let text = '';
    while (!done(text)) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text;
  };

  const waitFor = async (check: () => boolean) => {
    for (let tries = 0; tries < 100 && !check(); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  beforeAll(async () => {
    handle = await testDb();
    seed = await seedParties(handle.db);
    app = buildApp({
      logger: false,
      routes: [streamRoutes({ db: handle.db, adminToken: ADMIN_TOKEN, bus, heartbeatMs: 20 })]
    });
    base = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await app.close();
    await handle.close();
  });

  it("streams the receiver's events and heartbeats, and lets go when the client leaves", async () => {
    const abort = new AbortController();
    const response = await fetch(`${base}/v1/stream?receiverId=${seed.receivers.in}`, {
      headers: ADMIN,
      signal: abort.signal
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');

    await waitFor(() => open === 1);
    bus.publish(seed.receivers.solo, { ...NEAR, receiverId: 'someone-else' });
    bus.publish(seed.receivers.in, NEAR);
    const text = await readUntil(
      response,
      (sofar) => sofar.includes('data: ') && sofar.includes(': heartbeat')
    );
    expect(text).toContain(`data: ${JSON.stringify(NEAR)}\n\n`);
    expect(text).not.toContain('someone-else');

    abort.abort();
    await waitFor(() => open === 0);
    expect(open).toBe(0);
  });

  it("refuses a receiver key asking for another receiver's stream", async () => {
    const response = await fetch(`${base}/v1/stream?receiverId=${seed.receivers.in}`, {
      headers: receiverAuth('solo')
    });
    expect(response.status).toBe(403);
  });

  it('needs a receiver to stream for, and a secret', async () => {
    expect((await fetch(`${base}/v1/stream`, { headers: ADMIN })).status).toBe(400);
    expect((await fetch(`${base}/v1/stream?receiverId=x`)).status).toBe(401);
  });
});
