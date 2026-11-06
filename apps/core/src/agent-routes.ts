import { registerAgent, type RegisterDeps } from './agent-register';
import { listAgentRows, loadAgentRow } from './agent-rows';
import type { RegisterRoutes } from './app';
import { requireAdmin } from './auth';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import { agentRegisterSchema, agentRowSchema } from '@kosha/shared/registry';
import { z } from 'zod';

export type AgentRouteDeps = RegisterDeps & { adminToken: string };

export const agentRoutes =
  (deps: AgentRouteDeps): RegisterRoutes =>
  (app) => {
    const admin = { preHandler: requireAdmin(deps.adminToken) };

    // Registers an agent, or upgrades one (e.g. Level 0 → Level 1 once it presents a credential)
    app.post(
      '/v1/agents',
      {
        ...admin,
        schema: {
          body: agentRegisterSchema,
          response: {
            200: agentRowSchema,
            201: agentRowSchema,
            400: errorResponseSchema,
            502: errorResponseSchema
          }
        }
      },
      async (request, reply) => {
        const registered = await registerAgent(deps, request.body);
        if (!registered.ok) return reply.status(registered.data.status).send(registered.data.body);
        const { row, created } = registered.data;
        return reply.status(created ? 201 : 200).send(row);
      }
    );

    // The Console's agent-owner workspace lists agents; it can't know Core's internal IDs
    app.get(
      '/v1/agents',
      { ...admin, schema: { response: { 200: z.array(agentRowSchema) } } },
      async () => listAgentRows(deps.db)
    );

    app.get(
      '/v1/agents/:id',
      {
        ...admin,
        schema: {
          params: z.object({ id: z.string().min(1) }),
          response: { 200: agentRowSchema, 404: errorResponseSchema }
        }
      },
      async (request, reply) => {
        const row = await loadAgentRow(deps.db, request.params.id);
        return row ? row : reply.status(404).send({ error: 'not_found' });
      }
    );
  };
