import type { RegisterRoutes } from './app';
import { requireAdmin } from './auth';
import { recordSamplePayments, type SampleDeps } from './sample-payments';
import {
  samplePaymentsRequestSchema,
  samplePaymentsResponseSchema
} from '@kosha/shared/demo-admin';
import { errorResponseSchema } from '@kosha/shared/error-codes';

export type DemoRouteDeps = SampleDeps & { adminToken: string };

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
  };
