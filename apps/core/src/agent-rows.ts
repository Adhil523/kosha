import type { KoshaDb } from './db/client';
import { agent, agentWallet } from './db/schema';
import { type AgentRow, agentRowSchema } from '@kosha/shared/registry';
import { asc, eq } from 'drizzle-orm';

// An agent as the registry API answers it, with its declared wallets

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
