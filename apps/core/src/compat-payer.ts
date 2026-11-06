import type { KoshaDb } from './db/client';
import { agent, agentWallet } from './db/schema';
import { walletOwner } from './payment-verify';
import type { HederaNetwork } from '@kosha/shared/ids';
import { eq } from 'drizzle-orm';

// The agent a compatibility payment is booked to: the quote's agent, else the agent that declared
// the paying account, else a new Level 0 agent for that account. It gets no reserve of its own:
// its compatibility TDS sits in the pooled reserve in its name.
export const bookCompatPayer = async (
  db: KoshaDb,
  network: HederaNetwork,
  quotedAgentId: string | null,
  payer: string
): Promise<string> => {
  const known = quotedAgentId ?? (await walletOwner(db, payer));
  if (known) return known;

  const identity = `hedera:${network}:${payer}`;
  await db.insert(agent).values({ identity }).onConflictDoNothing({ target: agent.identity });
  const [row] = await db.select({ id: agent.id }).from(agent).where(eq(agent.identity, identity));
  if (!row) throw new Error('[compat]: the Level 0 payer was not saved');
  await db
    .insert(agentWallet)
    .values({ agentID: row.id, accountID: payer })
    .onConflictDoNothing({ target: agentWallet.accountID });
  return row.id;
};
