import { identityAccount } from './agent-identity';
import { registerAgent, type RegisterDeps } from './agent-register';
import { listAgentRows, loadAgentRow } from './agent-rows';
import type { RegisterRoutes } from './app';
import { requireAdmin } from './auth';
import type { ChallengeStore } from './challenges';
import type { KeyLookup } from './receiver-routes';
import { errorResponseSchema } from '@kosha/shared/error-codes';
import {
  agentChallengeSchema,
  agentRegisterSchema,
  agentRowSchema,
  agentSelfRegisterSchema
} from '@kosha/shared/registry';
import { z } from 'zod';

export type AgentRouteDeps = RegisterDeps & {
  adminToken: string;
  // The account's current key from the Mirror Node, for self-registration proofs
  keyLookup: KeyLookup;
  challenges: ChallengeStore;
};

const invalid = (message: string) => ({ error: 'invalid_payload' as const, message });

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

    app.get('/v1/agents/challenge', { schema: { response: { 200: agentChallengeSchema } } }, () =>
      deps.challenges.issue()
    );

    // An agent registers itself (Kosha Pay's register()): no admin token, a signed challenge instead
    app.post(
      '/v1/agents/self',
      {
        schema: {
          body: agentSelfRegisterSchema,
          response: {
            200: agentRowSchema,
            201: agentRowSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            502: errorResponseSchema
          }
        }
      },
      async (request, reply) => {
        const { challengeNonce, signature, ...registration } = request.body;
        if (!deps.challenges.consume(challengeNonce)) {
          return reply.status(400).send(invalid('challenge expired or already used'));
        }
        const account = identityAccount(registration.identity);
        if (!account)
          return reply.status(400).send(invalid('the identity names no Hedera account'));
        if (registration.wallets.length !== 1 || registration.wallets[0] !== account) {
          return reply
            .status(400)
            .send(invalid('an agent registering itself declares only its own account as a wallet'));
        }
        const key = await deps.keyLookup(account);
        const nonce = new TextEncoder().encode(challengeNonce);
        if (!key || !key.verify(nonce, Buffer.from(signature, 'hex'))) {
          return reply.status(401).send({ error: 'unauthorized', message: 'bad account proof' });
        }

        const registered = await registerAgent(deps, registration);
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
