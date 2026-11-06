import { ensureAuditAccount, ensureDemoAccounts } from './bootstrap-accounts';
import { fakeContext, receipt } from './bootstrap-fake';
import { AccountCreateTransaction, Hbar, KeyList } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const numberedAccounts = () => {
  let next = 2000;
  return () => receipt({ accountId: `0.0.${(next += 1)}` });
};

describe('ensureDemoAccounts', () => {
  it('creates every demo account once and saves IDs with their keys', async () => {
    const context = fakeContext({}, numberedAccounts());
    const holders = await ensureDemoAccounts(context);

    expect(context.transactions).toHaveLength(12);
    expect(holders.map((holder) => holder.label)).toEqual([
      'compliance',
      'receiver-in',
      'receiver-in-solo',
      'receiver-global',
      'agent-resident',
      'agent-resident-reserve',
      'agent-nonresident',
      'agent-nonresident-reserve',
      'agent-unknown',
      'agent-unknown-reserve',
      'compat-settlement',
      'pool-reserve'
    ]);
    expect(Object.keys(context.saved)).toEqual(
      expect.arrayContaining([
        'AGENT_RESIDENT_ACCOUNT_ID',
        'AGENT_RESIDENT_PRIVATE_KEY',
        'AGENT_RESIDENT_RESERVE_ID',
        'RECEIVER_IN_SOLO_PRIVATE_KEY',
        'COMPLIANCE_PRIVATE_KEY',
        'COMPAT_SETTLEMENT_ACCOUNT_ID',
        'POOL_RESERVE_ACCOUNT_ID'
      ])
    );
  });

  it('makes the pool reserve a 2-of-2 of Core and compliance', async () => {
    const context = fakeContext({}, numberedAccounts());
    await ensureDemoAccounts(context);
    const pool = context.transactions.at(-1);
    if (!(pool instanceof AccountCreateTransaction)) throw new Error('expected an account create');
    const key = pool.key;
    expect(key).toBeInstanceOf(KeyList);
    if (!(key instanceof KeyList)) return;
    expect(key.threshold).toBe(2);
    expect(key.toArray()).toHaveLength(2);
  });

  it('creates nothing on a rerun', async () => {
    const first = fakeContext({}, numberedAccounts());
    await ensureDemoAccounts(first);
    const rerun = fakeContext({ ...first.saved }, numberedAccounts());
    const holders = await ensureDemoAccounts(rerun);
    expect(rerun.transactions).toHaveLength(0);
    expect(holders).toHaveLength(12);
  });

  it('refuses an account ID whose key is missing', async () => {
    const context = fakeContext({ COMPLIANCE_ACCOUNT_ID: '0.0.3003' }, numberedAccounts());
    await expect(ensureDemoAccounts(context)).rejects.toThrow('COMPLIANCE_PRIVATE_KEY is empty');
  });
});

describe('ensureAuditAccount', () => {
  it('creates a funded audit account with its own key once, and says when it did', async () => {
    const first = fakeContext({}, numberedAccounts());
    const made = await ensureAuditAccount(first);
    expect(made.created).toBe(true);
    expect(Object.keys(first.saved)).toEqual(['AUDIT_ACCOUNT_ID', 'AUDIT_PRIVATE_KEY']);
    const [create] = first.transactions;
    if (!(create instanceof AccountCreateTransaction))
      throw new Error('expected an account create');
    expect(create.key?.toString()).toBe(made.key.publicKey.toString());
    expect(create.initialBalance?.toTinybars().toString()).toBe(
      new Hbar(5).toTinybars().toString()
    );

    const rerun = fakeContext({ ...first.saved }, numberedAccounts());
    expect((await ensureAuditAccount(rerun)).created).toBe(false);
    expect(rerun.transactions).toHaveLength(0);
  });
});
