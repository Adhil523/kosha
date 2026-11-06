import { findAgentByIdentity } from './agent-identity';
import type { KoshaDb } from './db/client';
import { agent, agentWallet } from './db/schema';
import type { ErrorResponse } from '@kosha/shared/error-codes';
import { type AgentIdentity, caip10AccountSchema } from '@kosha/shared/ids';
import { and, asc, eq, isNull } from 'drizzle-orm';

// Creates an agent's 2-of-2 reserve on Hedera (A08's createReserveAccount, with the agent's key
// from the Mirror Node) and returns its account ID, or null if the network refused
export type ReserveFactory = (payerAccountId: string) => Promise<string | null>;

export type Payer = {
  agentId: string;
  level: number;
  residency: 'resident' | 'non_resident' | 'unknown';
  panOnFile: boolean;
  reserveAccountId: string;
};

export type ResolvedPayer = { ok: true; data: Payer } | { ok: false; data: ErrorResponse };

type AgentRow = typeof agent.$inferSelect;

// By identity, or by its account once the agent has moved from CAIP-10 to a UAID
const findAgent = async (db: KoshaDb, identity: string): Promise<AgentRow | undefined> =>
  (await findAgentByIdentity(db, identity)) ?? undefined;

// hedera:testnet:0.0.6003 → 0.0.6003
const accountOf = (caip10: string): string => caip10.split(':').at(-1) ?? '';

export const createPayerResolver = (db: KoshaDb, createReserve: ReserveFactory) => {
  // One reserve creation per agent at a time, even when several quotes arrive together
  const creating = new Map<string, Promise<string | null>>();

  const ensureReserve = async (row: AgentRow): Promise<string | null> => {
    const [wallet] = await db
      .select({ accountID: agentWallet.accountID })
      .from(agentWallet)
      .where(eq(agentWallet.agentID, row.id))
      .orderBy(asc(agentWallet.createdAt));
    if (!wallet) return null;

    const pending = creating.get(row.id);
    if (pending) return pending;
    const work = (async () => {
      const created = await createReserve(wallet.accountID);
      if (!created) return null;
      await db
        .update(agent)
        .set({ reserveAccountID: created })
        .where(and(eq(agent.id, row.id), isNull(agent.reserveAccountID)));
      const [saved] = await db
        .select({ reserve: agent.reserveAccountID })
        .from(agent)
        .where(eq(agent.id, row.id));
      return saved?.reserve ?? null;
    })();
    creating.set(row.id, work);
    try {
      return await work;
    } finally {
      creating.delete(row.id);
    }
  };

  // X-KOSHA-AGENT → the payer a kosha-split quote is made for
  return async (identity: AgentIdentity): Promise<ResolvedPayer> => {
    let row = await findAgent(db, identity);

    if (!row) {
      const caip10 = caip10AccountSchema.safeParse(identity);
      if (!caip10.success) {
        const message = 'unknown agent: register it with POST /v1/agents before paying';
        return { ok: false, data: { error: 'payer_not_declared', message } };
      }
      // Level 0: registered on its first quote, with its own account as its wallet
      await db.insert(agent).values({ identity }).onConflictDoNothing({ target: agent.identity });
      row = await findAgent(db, identity);
      if (!row) return { ok: false, data: { error: 'internal_error' } };
      await db
        .insert(agentWallet)
        .values({ agentID: row.id, accountID: accountOf(caip10.data) })
        .onConflictDoNothing({ target: agentWallet.accountID });
    }

    const reserveAccountId = row.reserveAccountID ?? (await ensureReserve(row));
    if (!reserveAccountId) {
      const message = 'could not create the agent’s TDS reserve; retry shortly';
      return { ok: false, data: { error: 'core_unavailable', message } };
    }

    return {
      ok: true,
      data: {
        agentId: row.id,
        level: row.level,
        residency: row.residency,
        panOnFile: row.panOnFile,
        reserveAccountId
      }
    };
  };
};

export type ResolvePayer = ReturnType<typeof createPayerResolver>;
