import type { RegisterRoutes } from './app';
import { authenticateReader, scopedReceiver } from './auth';
import { type ChallanDeps, listChallans, recordChallan } from './challan-record';
import type { KoshaDb } from './db/client';
import { monthBounds, readMonthlyClose } from './monthly-close';
import { cosignRelease } from './release-cosign';
import { listReleases, refreshReleases, scheduleDue } from './releases';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import {
  challanRecordSchema,
  challanRowSchema,
  monthlyCloseSchema,
  monthSchema,
  releaseCosignSchema,
  releaseRowSchema
} from '@kosha/shared/tax-reports';
import { z } from 'zod';

export type CloseRouteDeps = {
  db: KoshaDb;
  adminToken: string;
  challan: ChallanDeps;
};

const FAILURES = { 401: errorResponseSchema, 403: errorResponseSchema };
const UNAUTHORIZED = { error: 'unauthorized' as const };
const receiverQuery = z.object({ receiverId: z.string().min(1).optional() });

// The monthly close (A20). The admin token acts for any receiver; a receiver key only for itself.
export const closeRoutes =
  (deps: CloseRouteDeps): RegisterRoutes =>
  (app) => {
    app.get(
      '/v1/close',
      {
        schema: {
          querystring: receiverQuery.extend({ month: monthSchema }),
          response: {
            200: monthlyCloseSchema,
            ...FAILURES,
            400: errorResponseSchema,
            404: errorResponseSchema
          }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReader(deps.db, deps.adminToken, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const scope = scopedReceiver(auth.data, request.query.receiverId);
        if (!scope) return reply.status(403).send(UNAUTHORIZED);
        const bounds = monthBounds(request.query.month);
        if (!scope.receiverId || !bounds) {
          return reply
            .status(400)
            .send({ error: 'invalid_payload', message: 'receiverId and month are required' });
        }
        const close = await readMonthlyClose(
          deps.db,
          scope.receiverId,
          request.query.month,
          bounds
        );
        if (!close) return reply.status(404).send({ error: 'not_found' });
        return close;
      }
    );

    app.get(
      '/v1/challans',
      {
        schema: {
          querystring: receiverQuery,
          response: { 200: z.array(challanRowSchema), ...FAILURES }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReader(deps.db, deps.adminToken, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const scope = scopedReceiver(auth.data, request.query.receiverId);
        if (!scope) return reply.status(403).send(UNAUTHORIZED);
        return listChallans(deps.db, scope.receiverId);
      }
    );

    app.post(
      '/v1/challans',
      {
        schema: {
          body: challanRecordSchema,
          response: {
            201: z.object({ challan: challanRowSchema, releases: z.array(releaseRowSchema) }),
            ...FAILURES,
            400: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema
          }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReader(deps.db, deps.adminToken, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        if (!scopedReceiver(auth.data, request.body.receiverId)) {
          return reply.status(403).send(UNAUTHORIZED);
        }
        const result = await recordChallan(deps.challan, request.body);
        if (!result.ok) {
          const { status, message } = result.data;
          return reply
            .status(status)
            .send({ error: status === 404 ? 'not_found' : 'invalid_payload', message });
        }
        return reply.status(201).send(result.data);
      }
    );

    app.get(
      '/v1/releases',
      {
        schema: {
          querystring: receiverQuery.extend({ challanId: z.string().min(1).optional() }),
          response: { 200: z.array(releaseRowSchema), ...FAILURES }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReader(deps.db, deps.adminToken, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const scope = scopedReceiver(auth.data, request.query.receiverId);
        if (!scope) return reply.status(403).send(UNAUTHORIZED);
        const filter = { challanId: request.query.challanId, receiverId: scope.receiverId };
        // A read is when a refused schedule is retried and a co-signed one is seen executed
        await scheduleDue(deps.challan.releases, filter);
        await refreshReleases(deps.challan.releases, filter);
        return listReleases(deps.db, filter);
      }
    );

    app.post(
      '/v1/releases/:id/cosign',
      {
        schema: {
          params: z.object({ id: z.string().min(1) }),
          body: releaseCosignSchema,
          response: {
            200: releaseRowSchema,
            ...FAILURES,
            400: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            502: errorResponseSchema
          }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReader(deps.db, deps.adminToken, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const scope = scopedReceiver(auth.data, undefined);
        if (!scope) return reply.status(403).send(UNAUTHORIZED);
        const result = await cosignRelease(
          deps.challan.releases,
          { receiverId: scope.receiverId },
          request.params.id,
          request.body
        );
        if (!result.ok) {
          const { status, message } = result.data;
          const error =
            status === 404 ? 'not_found' : status === 502 ? 'settlement_failed' : 'invalid_payload';
          return reply.status(status).send({ error, message });
        }
        return result.data;
      }
    );
  };
