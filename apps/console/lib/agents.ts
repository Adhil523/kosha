import { amountSchema } from '@kosha/shared/money';
import { agentRowSchema } from '@kosha/shared/registry';
import { z } from 'zod';

// One agent as the agent-owner workspace shows it: Core's registry row plus its reserve's token
// balance from the Mirror Node (null when the Mirror Node or the token ID is unavailable)
export const agentViewSchema = agentRowSchema.extend({
  reserveBalanceMicro: amountSchema.nullable()
});
export const agentViewsSchema = z.array(agentViewSchema);
export type AgentView = z.output<typeof agentViewSchema>;

/* eslint-disable @typescript-eslint/naming-convention -- Mirror Node fields are snake_case */
const mirrorTokensSchema = z.object({
  tokens: z.array(z.object({ token_id: z.string(), balance: z.number().int().nonnegative() }))
});
/* eslint-enable @typescript-eslint/naming-convention */

// The Mirror Node's /accounts/:id/tokens answer → the balance of one token in minor units, or
// null when the answer is unreadable. An account without the token holds 0.
export const readTokenBalance = (json: unknown, tokenId: string): string | null => {
  const parsed = mirrorTokensSchema.safeParse(json);
  if (!parsed.success) return null;
  const token = parsed.data.tokens.find((entry) => entry.token_id === tokenId);
  return String(token?.balance ?? 0);
};

// A short tab label: the paying account and the level, e.g. "0.0.6001 · L1"
export const agentShortLabel = (agent: AgentView): string =>
  `${agent.wallets[0] ?? agent.agentId} · L${agent.level}`;
