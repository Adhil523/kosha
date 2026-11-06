import type { Executor } from './executor';
import {
  AccountId,
  type Key,
  type PrivateKey,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  Timestamp,
  type TransferTransaction
} from '@hiero-ledger/sdk';

// HIP-423 long-term schedules are live on testnet; the network refuses an expiry more than 62
// days out (docs/research/scheduled-transactions.md)
export const MAX_SCHEDULE_SECONDS = 62 * 24 * 60 * 60;
const IDENTICAL_SCHEDULE = 'IDENTICAL_SCHEDULE_ALREADY_CREATED';

export type ScheduledTransferInput = {
  // Not frozen: the schedule carries its body
  transfer: TransferTransaction;
  // Unique per release (e.g. kosha-release:2026-11:agt_1), so a retried job finds its own schedule
  memo: string;
  expiresAt: Date;
  // Pays the inner transfer's fee when it executes (Core)
  payerAccountId: string;
  // Lets Core delete a bad schedule; omit to make it undeletable
  adminKey?: Key;
  now?: Date;
};

export type Scheduled =
  | { ok: true; data: { scheduleId: string; created: boolean } }
  | { ok: false; data: { reason: 'expiry_out_of_range' } }
  | { ok: false; data: { reason: 'rejected'; status: string } };

// Creates the schedule, executing on the last required signature (waitForExpiry false). Core's
// signature on the create counts toward the inner transfer. Idempotent: an identical schedule
// returns the existing ID with created: false.
export const createScheduledTransfer = async (
  execute: Executor,
  { transfer, memo, expiresAt, payerAccountId, adminKey, now = new Date() }: ScheduledTransferInput
): Promise<Scheduled> => {
  const seconds = (expiresAt.getTime() - now.getTime()) / 1000;
  if (seconds <= 0 || seconds > MAX_SCHEDULE_SECONDS) {
    return { ok: false, data: { reason: 'expiry_out_of_range' } };
  }

  const create = new ScheduleCreateTransaction()
    .setScheduledTransaction(transfer)
    .setScheduleMemo(memo)
    .setPayerAccountId(AccountId.fromString(payerAccountId))
    .setExpirationTime(Timestamp.fromDate(expiresAt))
    .setWaitForExpiry(false);
  if (adminKey) create.setAdminKey(adminKey);

  const executed = await execute(create);
  const scheduleId = executed.ok
    ? executed.data.scheduleId
    : executed.data.status === IDENTICAL_SCHEDULE
      ? executed.data.receipt?.scheduleId
      : null;
  if (!scheduleId) {
    const status = executed.ok ? 'NO_SCHEDULE_ID' : executed.data.status;
    return { ok: false, data: { reason: 'rejected', status } };
  }
  return { ok: true, data: { scheduleId: scheduleId.toString(), created: executed.ok } };
};

export type Signed = { ok: true } | { ok: false; data: { reason: 'rejected'; status: string } };

// Adds a co-signer's signature; with the last one, the scheduled transfer executes
export const signSchedule = async (
  execute: Executor,
  scheduleId: string,
  signer: PrivateKey
): Promise<Signed> => {
  const executed = await execute(new ScheduleSignTransaction().setScheduleId(scheduleId), [signer]);
  return executed.ok
    ? { ok: true }
    : { ok: false, data: { reason: 'rejected', status: executed.data.status } };
};
