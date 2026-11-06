import type { Executed, Executor, ReceiptLike } from './executor';
import { createReserveAccount, RESERVE_ACCOUNT_MEMO } from './reserve';
import { createScheduledTransfer, MAX_SCHEDULE_SECONDS, signSchedule } from './schedule';
import {
  AccountCreateTransaction,
  KeyList,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  type Transaction,
  TransferTransaction
} from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const receipt = (fields: Partial<ReceiptLike>): ReceiptLike => ({
  topicSequenceNumber: null,
  accountId: null,
  scheduleId: null,
  ...fields
});

const fakeExecutor = (result: Executed) => {
  const seen: { transaction: Transaction; signers: PrivateKey[] }[] = [];
  const execute: Executor = async (transaction, signers = []) => {
    seen.push({ transaction, signers });
    return result;
  };
  return { execute, seen };
};

const NOW = new Date('2026-12-01T00:00:00Z');
const release = () => ({
  transfer: new TransferTransaction()
    .addTokenTransfer('0.0.429274', '0.0.6101', -1019n)
    .addTokenTransfer('0.0.429274', '0.0.5001', 1019n),
  memo: 'kosha-release:2026-11:agt_resident',
  expiresAt: new Date(NOW.getTime() + 7 * 24 * 3600 * 1000),
  payerAccountId: '0.0.4000',
  now: NOW
});

describe('createScheduledTransfer', () => {
  it('schedules the transfer to run on the last signature', async () => {
    const { execute, seen } = fakeExecutor({ ok: true, data: receipt({ scheduleId: '0.0.8001' }) });

    expect(await createScheduledTransfer(execute, release())).toEqual({
      ok: true,
      data: { scheduleId: '0.0.8001', created: true }
    });

    const [call] = seen;
    expect(call?.transaction).toBeInstanceOf(ScheduleCreateTransaction);
    if (!(call?.transaction instanceof ScheduleCreateTransaction)) return;
    expect(call.transaction.getScheduleMemo).toBe('kosha-release:2026-11:agt_resident');
    expect(call.transaction.payerAccountId?.toString()).toBe('0.0.4000');
    expect(call.transaction.waitForExpiry).toBe(false);
    expect(call.transaction.expirationTime?.toDate()).toEqual(release().expiresAt);
  });

  it('returns the existing schedule when an identical one was already created', async () => {
    const { execute } = fakeExecutor({
      ok: false,
      data: {
        status: 'IDENTICAL_SCHEDULE_ALREADY_CREATED',
        receipt: receipt({ scheduleId: '0.0.8001' })
      }
    });
    expect(await createScheduledTransfer(execute, release())).toEqual({
      ok: true,
      data: { scheduleId: '0.0.8001', created: false }
    });
  });

  it('refuses an expiry in the past or more than 62 days out', async () => {
    const { execute, seen } = fakeExecutor({ ok: true, data: receipt({}) });
    const tooFar = new Date(NOW.getTime() + (MAX_SCHEDULE_SECONDS + 1) * 1000);
    for (const expiresAt of [new Date(NOW.getTime() - 1000), tooFar]) {
      expect(await createScheduledTransfer(execute, { ...release(), expiresAt })).toEqual({
        ok: false,
        data: { reason: 'expiry_out_of_range' }
      });
    }
    expect(seen).toHaveLength(0);
  });

  it('passes on any other rejection', async () => {
    const { execute } = fakeExecutor({
      ok: false,
      data: { status: 'INVALID_ACCOUNT_ID', receipt: null }
    });
    expect(await createScheduledTransfer(execute, release())).toEqual({
      ok: false,
      data: { reason: 'rejected', status: 'INVALID_ACCOUNT_ID' }
    });
  });
});

describe('signSchedule', () => {
  it('signs the schedule with the co-signer’s key', async () => {
    const { execute, seen } = fakeExecutor({ ok: true, data: receipt({}) });
    const agentKey = PrivateKey.generateED25519();

    expect(await signSchedule(execute, '0.0.8001', agentKey)).toEqual({ ok: true });
    expect(seen[0]?.transaction).toBeInstanceOf(ScheduleSignTransaction);
    expect(seen[0]?.signers).toEqual([agentKey]);
  });
});

describe('createReserveAccount', () => {
  it('creates a 2-of-2 account of the agent and Core with one association slot', async () => {
    const { execute, seen } = fakeExecutor({ ok: true, data: receipt({ accountId: '0.0.6101' }) });
    const agentKey = PrivateKey.generateED25519().publicKey;
    const coreKey = PrivateKey.generateED25519().publicKey;

    expect(await createReserveAccount(execute, { agentKey, coreKey })).toEqual({
      ok: true,
      data: { accountId: '0.0.6101' }
    });

    const create = seen[0]?.transaction;
    expect(create).toBeInstanceOf(AccountCreateTransaction);
    if (!(create instanceof AccountCreateTransaction)) return;
    const key = create.key;
    expect(key).toBeInstanceOf(KeyList);
    if (!(key instanceof KeyList)) return;
    expect(key.threshold).toBe(2);
    expect(key.toArray().map((part) => part.toString())).toEqual([
      agentKey.toString(),
      coreKey.toString()
    ]);
    expect(create.maxAutomaticTokenAssociations?.toNumber()).toBe(1);
    expect(create.accountMemo).toBe(RESERVE_ACCOUNT_MEMO);
  });

  it('passes on a rejection', async () => {
    const { execute } = fakeExecutor({
      ok: false,
      data: { status: 'INSUFFICIENT_PAYER_BALANCE', receipt: null }
    });
    const key = PrivateKey.generateED25519().publicKey;
    expect(await createReserveAccount(execute, { agentKey: key, coreKey: key })).toEqual({
      ok: false,
      data: { reason: 'rejected', status: 'INSUFFICIENT_PAYER_BALANCE' }
    });
  });
});
