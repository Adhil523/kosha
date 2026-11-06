import type { RegisterRoutes } from './app';
import { authenticateReader, scopedReceiver } from './auth';
import type { KoshaDb } from './db/client';
import { classifyOutside, listOutsidePayments } from './outside-classify';
import { outsidePaymentRowSchema } from '@kosha/shared/console-api';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import { outsideClassifySchema } from '@kosha/shared/tax-reports';
import { z } from 'zod';

export type OutsideRouteDeps = {
  db: KoshaDb;
  adminToken: string;
  pairSecret: string;
  paymentsTopicId: string;
};

const FAILURES = { 401: errorResponseSchema, 403: errorResponseSchema };

// Payments the watcher flagged (A19). The admin token reads and classifies for any receiver; a
// receiver key only for its own.
export const outsideRoutes =
  (deps: OutsideRouteDeps): RegisterRoutes =>
  (app) => {
    app.get(
      '/v1/outside-payments',
      {
        schema: {
          querystring: z.object({ receiverId: z.string().min(1).optional() }),
          response: { 200: z.array(outsidePaymentRowSchema), ...FAILURES }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReader(deps.db, deps.adminToken, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const scope = scopedReceiver(auth.data, request.query.receiverId);
        if (!scope) return reply.status(403).send({ error: 'unauthorized' });
        return listOutsidePayments(deps.db, scope.receiverId);
      }
    );

    app.post(
      '/v1/outside-payments/:id/classify',
      {
        schema: {
          params: z.object({ id: z.string().min(1) }),
          body: outsideClassifySchema,
          response: {
            200: outsidePaymentRowSchema,
            ...FAILURES,
            404: errorResponseSchema,
            409: errorResponseSchema
          }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReader(deps.db, deps.adminToken, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const scope = scopedReceiver(auth.data, undefined);
        if (!scope) return reply.status(403).send({ error: 'unauthorized' });
        const result = await classifyOutside(deps, scope, request.params.id, request.body);
        if (!result.ok) {
          const { status, message } = result.data;
          return reply
            .status(status)
            .send({ error: status === 404 ? 'not_found' : 'invalid_payload', message });
        }
        return result.data;
      }
    );
  };
