import type { RegisterRoutes } from './app';
import { authenticateReader, scopedReceiver } from './auth';
import type { KoshaDb } from './db/client';
import { readLedger } from './ledger-read';
import { ledgerPageSchema, ledgerQuerySchema } from '@kosha/shared/console-api';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import type { HederaNetwork } from '@kosha/shared/ids';

export type LedgerRouteDeps = {
  db: KoshaDb;
  adminToken: string;
  network: HederaNetwork;
};

// The Console's reads. The admin token reads any receiver; a receiver key reads only its own.
export const ledgerRoutes =
  (deps: LedgerRouteDeps): RegisterRoutes =>
  (app) => {
    app.get(
      '/v1/ledger',
      {
        schema: {
          querystring: ledgerQuerySchema,
          response: {
            200: ledgerPageSchema,
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

        const page = await readLedger(deps.db, deps.network, { ...request.query, ...scope });
        if (!page) {
          return reply
            .status(400)
            .send({ error: 'invalid_payload', message: 'cursor is not one Core issued' });
        }
        return page;
      }
    );
  };
