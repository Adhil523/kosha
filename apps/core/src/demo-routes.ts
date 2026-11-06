import type { RegisterRoutes } from './app';
import { requireAdmin } from './auth';
import { resetDemo } from './demo-reset';
import { recordSamplePayments, type SampleDeps } from './sample-payments';
import {
  demoResetRequestSchema,
  demoResetResponseSchema,
  samplePaymentsRequestSchema,
  samplePaymentsResponseSchema
} from '@kosha/shared/demo-admin';
import { errorResponseSchema } from '@kosha/shared/error-codes';

export type DemoRouteDeps = SampleDeps & { adminToken: string; now?: () => Date };

// Admin-only endpoints for `pnpm seed --history` and `--reset-demo` (A14)
export const demoRoutes =
  (deps: DemoRouteDeps): RegisterRoutes =>
  (app) => {
    const admin = { preHandler: requireAdmin(deps.adminToken) };

    app.post(
      '/v1/admin/sample-payments',
      {
        ...admin,
        schema: {
          body: samplePaymentsRequestSchema,
          response: { 200: samplePaymentsResponseSchema, 400: errorResponseSchema }
        }
      },
      async (request, reply) => {
        const recorded = await recordSamplePayments(deps, request.body.payments);
        if (!recorded.ok) {
          return reply
            .status(400)
            .send({ error: 'invalid_payload', message: recorded.data.message });
        }
        return recorded.data;
      }
    );

    app.post(
      '/v1/admin/demo-reset',
      {
        ...admin,
        schema: {
          body: demoResetRequestSchema,
          response: { 200: demoResetResponseSchema, 400: errorResponseSchema }
        }
      },
      async (request, reply) => {
        const reset = await resetDemo(deps, request.body, deps.now?.() ?? new Date());
        if (!reset.ok) {
          return reply.status(400).send({ error: 'invalid_payload', message: reset.data.message });
        }
        return reset.data;
      }
    );
  };
