import { readAggregates } from './aggregate-read';
import type { RegisterRoutes } from './app';
import { authenticateReader, scopedReceiver } from './auth';
import type { KoshaDb } from './db/client';
import { readLedger } from './ledger-read';
import {
  aggregateRowSchema,
  financialYearSchema,
  ledgerPageSchema,
  ledgerQuerySchema
} from '@kosha/shared/console-api';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import type { HederaNetwork } from '@kosha/shared/ids';
import { financialYear } from '@kosha/tax-engine/ist-calendar';
import type { RulePack } from '@kosha/tax-engine/rule-pack';
import { z } from 'zod';

export type LedgerRouteDeps = {
  db: KoshaDb;
  adminToken: string;
  network: HederaNetwork;
  pack: RulePack;
  now?: () => Date;
};

const aggregatesQuerySchema = z.object({
  receiverId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  // Defaults to the current financial year
  fy: financialYearSchema.optional()
});

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

    app.get(
      '/v1/aggregates',
      {
        schema: {
          querystring: aggregatesQuerySchema,
          response: {
            200: z.array(aggregateRowSchema),
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

        const now = deps.now?.() ?? new Date();
        const fy = request.query.fy ?? financialYear(now, deps.pack.financialYearStart);
        return readAggregates(deps.db, deps.pack, { ...request.query, ...scope, fy });
      }
    );
  };
