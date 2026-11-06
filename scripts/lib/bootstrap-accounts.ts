import { type BootstrapContext, bootstrapLog } from './bootstrap-context';
import { AccountCreateTransaction, Hbar, type Key, KeyList, PrivateKey } from '@hiero-ledger/sdk';
import type { Executor } from '@kosha/hedera/executor';
import { createReserveAccount } from '@kosha/hedera/reserve';

// Env names Agent A's seed reads: <PREFIX>_ACCOUNT_ID, <PREFIX>_PRIVATE_KEY, <PREFIX>_RESERVE_ID
const RECEIVER_PREFIXES = ['RECEIVER_IN', 'RECEIVER_IN_SOLO', 'RECEIVER_GLOBAL'] as const;
const AGENT_PREFIXES = ['AGENT_RESIDENT', 'AGENT_NONRESIDENT', 'AGENT_UNKNOWN'] as const;
// Each agent pays for its own HCS-11 profile inscription; Core pays every settlement fee
const AGENT_HBAR = 5;

// An account bootstrap must associate with the settlement token, with the keys that sign for it
// besides Core (the operator signs every transaction anyway)
export type TokenHolder = {
  label: string;
  accountId: string;
  signers: PrivateKey[];
  isAgent: boolean;
};

const labelOf = (prefix: string): string => prefix.toLowerCase().replaceAll('_', '-');

const createAccount = async (context: BootstrapContext, label: string, key: Key, hbar = 0) => {
  const create = new AccountCreateTransaction()
    .setKeyWithoutAlias(key)
    .setInitialBalance(new Hbar(hbar))
    .setAccountMemo(`kosha ${label}`);
  const created = await context.run(create);
  if (!created.ok) throw new Error(`creating ${label} failed: ${created.data.status}`);
  const accountId = created.data.accountId?.toString();
  if (!accountId) throw new Error(`creating ${label} returned no account ID`);
  return accountId;
};

// An account with its own fresh Ed25519 key; the ID and key are saved together
const ensureOwnKeyAccount = async (context: BootstrapContext, prefix: string, hbar = 0) => {
  const idKey = `${prefix}_ACCOUNT_ID`;
  const secretKey = `${prefix}_PRIVATE_KEY`;
  const existingId = context.env[idKey]?.trim();
  const existingKey = context.env[secretKey]?.trim();
  if (existingId) {
    if (!existingKey) throw new Error(`${idKey} is set but ${secretKey} is empty`);
    return { accountId: existingId, key: PrivateKey.fromStringDer(existingKey) };
  }

  const key = PrivateKey.generateED25519();
  const accountId = await createAccount(context, labelOf(prefix), key.publicKey, hbar);
  context.save({ [idKey]: accountId, [secretKey]: key.toStringDer() });
  return { accountId, key };
};

// An account whose key needs no new secret (Core's key, or a 2-of-2 of keys already saved)
const ensureSharedKeyAccount = async (context: BootstrapContext, prefix: string, key: Key) => {
  const idKey = `${prefix}_ACCOUNT_ID`;
  const existing = context.env[idKey]?.trim();
  if (existing) return existing;
  const accountId = await createAccount(context, labelOf(prefix), key);
  context.save({ [idKey]: accountId });
  return accountId;
};

// Same reserve shape Core creates for a Level 0 agent: KeyList([agent, core], 2)
const ensureAgentReserve = async (
  context: BootstrapContext,
  prefix: string,
  agentKey: PrivateKey
) => {
  const reserveKey = `${prefix}_RESERVE_ID`;
  const existing = context.env[reserveKey]?.trim();
  if (existing) return existing;

  const execute: Executor = async (transaction, signers) => {
    const ran = await context.run(transaction, signers);
    return ran.ok ? ran : { ok: false, data: { status: ran.data.status, receipt: null } };
  };
  const created = await createReserveAccount(execute, {
    agentKey: agentKey.publicKey,
    coreKey: context.coreKey.publicKey
  });
  if (!created.ok)
    throw new Error(`creating ${labelOf(prefix)} reserve failed: ${created.data.status}`);
  context.save({ [reserveKey]: created.data.accountId });
  return created.data.accountId;
};

export const ensureDemoAccounts = async (context: BootstrapContext): Promise<TokenHolder[]> => {
  const holders: TokenHolder[] = [];
  const compliance = await ensureOwnKeyAccount(context, 'COMPLIANCE');
  holders.push({
    label: 'compliance',
    accountId: compliance.accountId,
    signers: [compliance.key],
    isAgent: false
  });

  for (const prefix of RECEIVER_PREFIXES) {
    const receiver = await ensureOwnKeyAccount(context, prefix);
    holders.push({
      label: labelOf(prefix),
      accountId: receiver.accountId,
      signers: [receiver.key],
      isAgent: false
    });
  }

  for (const prefix of AGENT_PREFIXES) {
    const agent = await ensureOwnKeyAccount(context, prefix, AGENT_HBAR);
    holders.push({
      label: labelOf(prefix),
      accountId: agent.accountId,
      signers: [agent.key],
      isAgent: true
    });
    const reserveId = await ensureAgentReserve(context, prefix, agent.key);
    holders.push({
      label: `${labelOf(prefix)}-reserve`,
      accountId: reserveId,
      signers: [agent.key],
      isAgent: false
    });
  }

  const coreKey = context.coreKey.publicKey;
  const compatId = await ensureSharedKeyAccount(context, 'COMPAT_SETTLEMENT', coreKey);
  holders.push({ label: 'compat-settlement', accountId: compatId, signers: [], isAgent: false });
  const poolKey = new KeyList([coreKey, compliance.key.publicKey], 2);
  const poolId = await ensureSharedKeyAccount(context, 'POOL_RESERVE', poolKey);
  holders.push({
    label: 'pool-reserve',
    accountId: poolId,
    signers: [compliance.key],
    isAgent: false
  });

  bootstrapLog(`${holders.length} demo accounts ready`);
  return holders;
};
