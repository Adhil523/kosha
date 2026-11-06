import { findAgentByIdentity } from './agent-identity';
import { checkAgentProfile, type ProfileCheckResult } from './agent-profile';
import type { RegisterRoutes } from './app';
import { requireAdmin } from './auth';
import type { KoshaDb } from './db/client';
import { agent, agentWallet } from './db/schema';
import type { PublicKey } from '@hiero-ledger/sdk';
import { credentialHash, verifyCredential } from '@kosha/hedera/credentials';
import type { ProfileReader } from '@kosha/hedera/hcs11-profile';
import { type ErrorResponse, errorResponseSchema } from '@kosha/shared/error-codes';
import { uaidSchema } from '@kosha/shared/ids';
import { agentRegisterSchema, type AgentRow, agentRowSchema } from '@kosha/shared/registry';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

export type AgentRouteDeps = {
  db: KoshaDb;
  adminToken: string;
  // Core's test issuer (ISSUER_PRIVATE_KEY's public key)
  issuerKey: PublicKey;
  // Checks a UAID against its HCS-11 profile (A18). Without one, Core registers the UAID and
  // credential only: the spec's fallback for when the Kiloscribe CDN is down.
  profileReader?: Pick<ProfileReader, 'profileForUaid'>;
};

const NO_PROFILE_CHECK: ProfileCheckResult = { ok: true, data: null };

const invalid = (message: string): ErrorResponse => ({ error: 'invalid_payload', message });

const toAgentRow = (row: typeof agent.$inferSelect, wallets: string[]): AgentRow =>
  agentRowSchema.parse({
    agentId: row.id,
    identity: row.identity,
    level: row.level,
    residency: row.residency,
    panOnFile: row.panOnFile,
    wallets,
    reserveAccountId: row.reserveAccountID,
    credentialIssuer: row.credentialIssuer,
    verifiedAt: row.verifiedAt?.toISOString() ?? null
  });

export const loadAgentRow = async (db: KoshaDb, agentId: string): Promise<AgentRow | null> => {
  const [row] = await db.select().from(agent).where(eq(agent.id, agentId));
  if (!row) return null;
  const wallets = await db
    .select({ accountID: agentWallet.accountID })
    .from(agentWallet)
    .where(eq(agentWallet.agentID, agentId))
    .orderBy(asc(agentWallet.createdAt), asc(agentWallet.accountID));
  return toAgentRow(
    row,
    wallets.map((wallet) => wallet.accountID)
  );
};

// Every registered agent, oldest first: two queries, not one per agent
export const listAgentRows = async (db: KoshaDb): Promise<AgentRow[]> => {
  const rows = await db.select().from(agent).orderBy(asc(agent.createdAt), asc(agent.id));
  const wallets = await db
    .select({ agentID: agentWallet.agentID, accountID: agentWallet.accountID })
    .from(agentWallet)
    .orderBy(asc(agentWallet.createdAt), asc(agentWallet.accountID));
  const walletsOf = new Map<string, string[]>();
  for (const wallet of wallets) {
    walletsOf.set(wallet.agentID, [...(walletsOf.get(wallet.agentID) ?? []), wallet.accountID]);
  }
  return rows.map((row) => toAgentRow(row, walletsOf.get(row.id) ?? []));
};

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
        const { identity, credential, wallets, reserveAccountId } = request.body;

        let verified: {
          residency: 'resident' | 'non_resident';
          panOnFile: boolean;
          level: 1 | 2;
        } | null = null;
        if (credential) {
          if (credential.subject !== identity) {
            return reply.status(400).send(invalid('the credential names another agent'));
          }
          const checked = verifyCredential(credential, deps.issuerKey);
          if (!checked.ok)
            return reply.status(400).send(invalid(`credential ${checked.data.reason}`));
          verified = checked.data;
        }

        const profileCheck = deps.profileReader
          ? await checkAgentProfile(deps.profileReader, { identity, credential, wallets })
          : NO_PROFILE_CHECK;
        if (!profileCheck.ok) {
          const { reason, message } = profileCheck.data;
          return reason === 'unavailable'
            ? reply.status(502).send({ error: 'internal_error', message })
            : reply.status(400).send(invalid(message));
        }

        // Found by identity, or by its account when an agent moves from CAIP-10 to a UAID
        const existing = await findAgentByIdentity(deps.db, identity);
        const owners = await deps.db
          .select({ accountID: agentWallet.accountID, agentID: agentWallet.agentID })
          .from(agentWallet)
          .where(inArray(agentWallet.accountID, wallets));
        if (owners.some((owner) => owner.agentID !== existing?.id)) {
          return reply.status(400).send(invalid('a wallet belongs to another agent'));
        }

        const profile = verified
          ? {
              level: verified.level,
              residency: verified.residency,
              panOnFile: verified.panOnFile,
              credentialIssuer: credential?.issuer ?? null,
              credentialHash: credential ? credentialHash(credential) : null,
              verifiedAt: new Date()
            }
          : {};
        const profileCache = profileCheck.data ?? {};

        const agentId = await deps.db.transaction(async (tx) => {
          const [saved] = existing
            ? await tx
                .update(agent)
                .set({
                  // A UAID replaces the CAIP-10 identity it grew from; never the other way
                  identity: uaidSchema.safeParse(identity).success ? identity : existing.identity,
                  ...profile,
                  ...profileCache,
                  reserveAccountID: existing.reserveAccountID ?? reserveAccountId ?? null
                })
                .where(eq(agent.id, existing.id))
                .returning({ id: agent.id })
            : await tx
                .insert(agent)
                .values({
                  identity,
                  reserveAccountID: reserveAccountId ?? null,
                  ...profile,
                  ...profileCache
                })
                .returning({ id: agent.id });
          const id = saved?.id ?? '';
          const known = new Set(owners.map((owner) => owner.accountID));
          const fresh = wallets.filter((wallet) => !known.has(wallet));
          if (fresh.length > 0) {
            await tx
              .insert(agentWallet)
              .values(fresh.map((accountID) => ({ agentID: id, accountID })));
          }
          return id;
        });

        const row = await loadAgentRow(deps.db, agentId);
        // Just written in this request; the error handler answers internal_error if it's gone
        if (!row) throw new Error('[agents]: saved agent could not be read back');
        return reply.status(existing ? 200 : 201).send(row);
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
