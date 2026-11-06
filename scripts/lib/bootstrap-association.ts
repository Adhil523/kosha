/* eslint-disable @typescript-eslint/naming-convention -- the Mirror Node REST API names its fields in snake_case */
import type { TokenHolder } from './bootstrap-accounts';
import { type BootstrapContext, bootstrapLog } from './bootstrap-context';
import { TokenAssociateTransaction, TransferTransaction } from '@hiero-ledger/sdk';
import { z } from 'zod';

const ALREADY_ASSOCIATED = 'TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT';
const INSUFFICIENT_TOKEN_BALANCE = 'INSUFFICIENT_TOKEN_BALANCE';
// 1,000 tUSDC per demo agent, in micro-units
export const AGENT_FUND_MICRO = 1_000_000_000n;

const tokenHoldingsSchema = z.object({
  tokens: z.array(z.object({ token_id: z.string(), balance: z.union([z.number(), z.string()]) }))
});

// The holder's balance, or null when the Mirror Node shows no association (it lags a few
// seconds behind consensus, so an association can be missing here; the associate call settles it)
const mirrorBalance = async (
  context: BootstrapContext,
  accountId: string,
  tokenId: string,
  fetchImpl: typeof fetch
): Promise<bigint | null> => {
  const url = `${context.mirrorUrl}/api/v1/accounts/${accountId}/tokens?token.id=${tokenId}`;
  const response = await fetchImpl(url);
  if (!response.ok) return null;
  const parsed = tokenHoldingsSchema.safeParse(await response.json());
  const holding = parsed.success
    ? parsed.data.tokens.find((t) => t.token_id === tokenId)
    : undefined;
  return holding ? BigInt(holding.balance) : null;
};

// Association isn't idempotent on Hedera, so an existing one counts as success. Both keys of a
// 2-of-2 account sign: Core as operator, the other through `signers`.
const associate = async (context: BootstrapContext, holder: TokenHolder, tokenId: string) => {
  const tx = new TokenAssociateTransaction().setAccountId(holder.accountId).setTokenIds([tokenId]);
  const ran = await context.run(tx, holder.signers);
  if (!ran.ok && ran.data.status !== ALREADY_ASSOCIATED) {
    throw new Error(`associating ${holder.label} failed: ${ran.data.status}`);
  }
  bootstrapLog(`${holder.label} associated with ${tokenId}`);
};

// Core (the treasury for tUSDC) funds an agent that holds none of the token yet. With Circle USDC
// (H5), Core may hold too little; that is reported, not fatal, so the run can finish.
const fundAgent = async (context: BootstrapContext, holder: TokenHolder, tokenId: string) => {
  const transfer = new TransferTransaction()
    .addTokenTransfer(tokenId, context.coreId, -AGENT_FUND_MICRO)
    .addTokenTransfer(tokenId, holder.accountId, AGENT_FUND_MICRO);
  const ran = await context.run(transfer);
  if (ran.ok) return bootstrapLog(`${holder.label} funded with ${AGENT_FUND_MICRO} micro-units`);
  if (ran.data.status === INSUFFICIENT_TOKEN_BALANCE) {
    return bootstrapLog(
      `Core holds too little ${tokenId} to fund ${holder.label}; fund it by hand`
    );
  }
  throw new Error(`funding ${holder.label} failed: ${ran.data.status}`);
};

export const ensureTokenHoldings = async (
  context: BootstrapContext,
  holders: TokenHolder[],
  tokenId: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> => {
  for (const holder of holders) {
    const balance = await mirrorBalance(context, holder.accountId, tokenId, fetchImpl);
    if (balance === null) await associate(context, holder, tokenId);
    if (holder.isAgent && (balance ?? 0n) === 0n) await fundAgent(context, holder, tokenId);
  }
};
