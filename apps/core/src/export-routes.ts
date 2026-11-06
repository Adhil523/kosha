import type { RegisterRoutes } from './app';
import { authenticateReader, scopedReceiver } from './auth';
import type { KoshaDb } from './db/client';
import { quarterBounds, readTdsExport, toTdsCsv } from './tds-export';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import { quarterSchema } from '@kosha/shared/tax-reports';
import { z } from 'zod';

export type ExportRouteDeps = {
  db: KoshaDb;
  adminToken: string;
  // The rule pack's "MM-01", which sets the quarters
  financialYearStart: string;
};

const exportQuerySchema = z.object({
  receiverId: z.string().min(1).optional(),
  quarter: quarterSchema
});

// GET /v1/exports/tds: the receiver's quarterly TDS statement data as a CSV download
export const exportRoutes =
  (deps: ExportRouteDeps): RegisterRoutes =>
  (app) => {
    app.get(
      '/v1/exports/tds',
      {
        schema: {
          querystring: exportQuerySchema,
          response: {
            // The CSV text, sent as is under its text/csv content type
            200: z.string(),
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
        const bounds = quarterBounds(request.query.quarter, deps.financialYearStart);
        if (!receiverId || !bounds) {
          return reply
            .status(400)
            .send({ error: 'invalid_payload', message: 'receiverId and a quarter are required' });
        }

        const rows = await readTdsExport(deps.db, receiverId, bounds);
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header(
            'content-disposition',
            `attachment; filename="kosha-tds-${request.query.quarter}.csv"`
          )
          .send(toTdsCsv(rows));
      }
    );
  };
