import type { KoshaDb } from './db/client';
import { policy } from './db/schema';
import { amountToBigint, bigintToAmount } from '@kosha/shared/money';
import { type Policy, policySchema } from '@kosha/shared/registry';
import { eq } from 'drizzle-orm';

// An agent's spending rules as Core enforces them: caps in micro-USDC, counted on the all-in total
export type AgentPolicy = Omit<Policy, 'perPaymentMicro' | 'dailyMicro' | 'fyBudgetMicro'> & {
  perPaymentMicro: bigint;
  dailyMicro: bigint;
  fyBudgetMicro: bigint;
};

export const toWirePolicy = (rules: AgentPolicy): Policy =>
  policySchema.parse({
    ...rules,
    perPaymentMicro: bigintToAmount(rules.perPaymentMicro),
    dailyMicro: bigintToAmount(rules.dailyMicro),
    fyBudgetMicro: bigintToAmount(rules.fyBudgetMicro)
  });

// Null when the agent has no policy: Core then enforces nothing beyond the tax rules
export const loadPolicy = async (db: KoshaDb, agentId: string): Promise<AgentPolicy | null> => {
  const [row] = await db.select().from(policy).where(eq(policy.agentID, agentId));
  if (!row) return null;
  return {
    perPaymentMicro: row.perPaymentMicro,
    dailyMicro: row.dailyMicro,
    fyBudgetMicro: row.fyBudgetMicro,
    allowlist: row.allowlist,
    thresholdAction: row.thresholdAction,
    acceptRulepacks: row.acceptRulepacks
  };
};

// Replaces the agent's policy (PUT semantics: every rule is set on each write)
export const savePolicy = async (db: KoshaDb, agentId: string, rules: Policy): Promise<void> => {
  const values = {
    perPaymentMicro: amountToBigint(rules.perPaymentMicro),
    dailyMicro: amountToBigint(rules.dailyMicro),
    fyBudgetMicro: amountToBigint(rules.fyBudgetMicro),
    allowlist: rules.allowlist,
    thresholdAction: rules.thresholdAction,
    acceptRulepacks: rules.acceptRulepacks
  };
  await db
    .insert(policy)
    .values({ agentID: agentId, ...values })
    .onConflictDoUpdate({ target: policy.agentID, set: values });
};
