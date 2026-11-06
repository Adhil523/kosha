import type { RegisterRoutes } from './app';
import { authenticateReceiver } from './auth';
import { confirmDecision, decidePayment, type DecisionDeps } from './decisions';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import {
  decideRequestSchema,
  decideResponseSchema,
  decisionConfirmSchema
} from '@kosha/shared/facilitator-api';
import { z } from 'zod';

const FAILURES = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema
};

// Kosha's tax engine for other facilitators (A24): receiver API key auth, like /v1/quote
export const decisionRoutes =
  (deps: DecisionDeps): RegisterRoutes =>
  (app) => {
    app.post(
      '/v1/decide',
      {
        schema: { body: decideRequestSchema, response: { 200: decideResponseSchema, ...FAILURES } }
      },
      async (request, reply) => {
        const auth = await authenticateReceiver(deps.db, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const decided = await decidePayment(deps, auth.data, request.body);
        if (!decided.ok) {
          const { status, code, message } = decided.data;
          return reply.status(status).send({ error: code, message });
        }
        return decided.data;
      }
    );

    app.post(
      '/v1/decisions/:id/confirm',
      {
        schema: {
          params: z.object({ id: z.string().min(1) }),
          body: decisionConfirmSchema,
          response: { 200: decideResponseSchema, ...FAILURES }
        }
      },
      async (request, reply) => {
        const auth = await authenticateReceiver(deps.db, request);
        if (!auth.ok) return reply.status(401).send(auth.data);
        const confirmed = await confirmDecision(
          deps,
          auth.data.id,
          request.params.id,
          request.body
        );
        if (!confirmed.ok) {
          const { status, code, message } = confirmed.data;
          return reply.status(status).send({ error: code, message });
        }
        return confirmed.data;
      }
    );
  };
