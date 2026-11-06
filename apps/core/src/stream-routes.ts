import type { RegisterRoutes } from './app';
import { authenticateReader, scopedReceiver } from './auth';
import type { KoshaDb } from './db/client';
import type { EventBus } from './event-bus';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import { z } from 'zod';

// A comment line this often keeps proxies (and the Console's own) from closing an idle stream
export const HEARTBEAT_MS = 15_000;

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Stops nginx-style proxies from buffering events
  'x-accel-buffering': 'no'
};

export type StreamRouteDeps = {
  db: KoshaDb;
  adminToken: string;
  bus: EventBus;
  heartbeatMs?: number;
};

const streamQuerySchema = z.object({ receiverId: z.string().min(1).optional() });

// GET /v1/stream: one receiver's live events as server-sent events, `data: <StreamEvent JSON>`
export const streamRoutes =
  (deps: StreamRouteDeps): RegisterRoutes =>
  (app) => {
    app.get(
      '/v1/stream',
      {
        schema: {
          querystring: streamQuerySchema,
          response: {
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema
          }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReader(deps.db, deps.adminToken, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const scope = scopedReceiver(auth.data, request.query.receiverId);
        if (!scope) return reply.status(403).send({ error: 'unauthorized' });
        const { receiverId } = scope;
        if (!receiverId) {
          return reply
            .status(400)
            .send({ error: 'invalid_payload', message: 'receiverId is required' });
        }

        // From here the response is a long-lived stream that Fastify no longer manages
        reply.hijack();
        const stream = reply.raw;
        stream.writeHead(200, SSE_HEADERS);
        stream.write(': connected\n\n');
        const unsubscribe = deps.bus.subscribe(receiverId, (event) => {
          stream.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        const heartbeat = setInterval(() => {
          stream.write(': heartbeat\n\n');
        }, deps.heartbeatMs ?? HEARTBEAT_MS);
        request.raw.on('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
      }
    );
  };
