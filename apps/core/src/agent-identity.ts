import type { KoshaDb } from './db/client';
import { agent, agentWallet } from './db/schema';
import { uaidNativeAccount } from '@kosha/hedera/hcs11-profile';
import { caip10AccountSchema, uaidSchema } from '@kosha/shared/ids';
import { eq } from 'drizzle-orm';

export type AgentRecord = typeof agent.$inferSelect;

// The Hedera account behind an identity: a CAIP-10 identity's account, or a UAID's nativeId
export const identityAccount = (identity: string): string | null => {
  const caip10 = caip10AccountSchema.safeParse(identity);
  if (caip10.success) return caip10.data.split(':').at(-1) ?? null;
  const uaid = uaidSchema.safeParse(identity);
  return uaid.success ? (uaidNativeAccount(uaid.data)?.accountId ?? null) : null;
};

// An agent keeps one record as its identity moves from its CAIP-10 account (Level 0) to an HCS-14
// UAID for the same account. So an identity finds its agent by exact match, or else through the
// account behind it, when that account is a wallet of an agent whose own identity is backed by
// the same account. A wallet held by an agent with an unrelated identity matches nothing.
export const findAgentByIdentity = async (
  db: KoshaDb,
  identity: string
): Promise<AgentRecord | null> => {
  const [exact] = await db.select().from(agent).where(eq(agent.identity, identity));
  if (exact) return exact;
  const account = identityAccount(identity);
  if (!account) return null;
  const [owner] = await db
    .select({ agent })
    .from(agentWallet)
    .innerJoin(agent, eq(agent.id, agentWallet.agentID))
    .where(eq(agentWallet.accountID, account));
  return owner && identityAccount(owner.agent.identity) === account ? owner.agent : null;
};
