import { loadPolicy, savePolicy, toWirePolicy } from './agent-policy';
import type { RegisterRoutes } from './app';
import { requireAdmin } from './auth';
import type { KoshaDb } from './db/client';
import { agent } from './db/schema';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import { policySchema } from '@kosha/shared/registry';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

export type PolicyRouteDeps = {
  db: KoshaDb;
  adminToken: string;
};

const paramsSchema = z.object({ id: z.string().min(1) });

const agentExists = async (db: KoshaDb, agentId: string): Promise<boolean> => {
  const [row] = await db.select({ id: agent.id }).from(agent).where(eq(agent.id, agentId));
  return Boolean(row);
};

// The agent owner's spending rules (spec Component 3). The Console and scripts set them with the
// admin token; Core enforces them at quote and again at verify.
export const policyRoutes =
  (deps: PolicyRouteDeps): RegisterRoutes =>
  (app) => {
    const admin = { preHandler: requireAdmin(deps.adminToken) };

    app.get(
      '/v1/agents/:id/policy',
      {
        ...admin,
        schema: {
          params: paramsSchema,
          response: { 200: policySchema, 404: errorResponseSchema }
        }
      },
      async (request, reply) => {
        const rules = await loadPolicy(deps.db, request.params.id);
        if (!rules) {
          return reply
            .status(404)
            .send({ error: 'not_found', message: 'no policy for this agent' });
        }
        return toWirePolicy(rules);
      }
    );

    app.put(
      '/v1/agents/:id/policy',
      {
        ...admin,
        schema: {
          params: paramsSchema,
          body: policySchema,
          response: { 200: policySchema, 404: errorResponseSchema }
        }
      },
      async (request, reply) => {
        const agentId = request.params.id;
        if (!(await agentExists(deps.db, agentId))) {
          return reply.status(404).send({ error: 'not_found', message: 'no such agent' });
        }
        await savePolicy(deps.db, agentId, request.body);
        return request.body;
      }
    );
  };
