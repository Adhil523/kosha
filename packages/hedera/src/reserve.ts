import type { Executor } from './executor';
import { AccountCreateTransaction, Hbar, KeyList, type PublicKey } from '@hiero-ledger/sdk';

export const RESERVE_ACCOUNT_MEMO = 'kosha reserve';

export type ReserveCreated =
  | { ok: true; data: { accountId: string } }
  | { ok: false; data: { reason: 'rejected'; status: string } };

// Mode C: an agent's own TDS reserve. Both the agent and Core must sign to move it (2-of-2), so
// neither can spend the reserved tax alone. One automatic association slot lets the first USDC
// credit associate the token without the agent signing; Core, as fee payer, pays that fee.
export const createReserveAccount = async (
  execute: Executor,
  { agentKey, coreKey }: { agentKey: PublicKey; coreKey: PublicKey }
): Promise<ReserveCreated> => {
  const create = new AccountCreateTransaction()
    .setKeyWithoutAlias(new KeyList([agentKey, coreKey], 2))
    .setMaxAutomaticTokenAssociations(1)
    .setInitialBalance(new Hbar(0))
    .setAccountMemo(RESERVE_ACCOUNT_MEMO);

  const executed = await execute(create);
  if (!executed.ok)
    return { ok: false, data: { reason: 'rejected', status: executed.data.status } };
  const accountId = executed.data.accountId;
  if (!accountId) return { ok: false, data: { reason: 'rejected', status: 'NO_ACCOUNT_ID' } };
  return { ok: true, data: { accountId: accountId.toString() } };
};
