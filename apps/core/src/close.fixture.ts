import type { KoshaDb } from './db/client';
import { challan, release } from './db/schema';
import {
  AccountId,
  PrivateKey,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  type Transaction,
  TransactionId
} from '@hiero-ledger/sdk';
import type { Executed, Executor, ReceiptLike } from '@kosha/hedera/executor';
import type { MirrorResult, MirrorSchedule, MirrorTransaction } from '@kosha/hedera/mirror';

// A recorded challan with its releases, as POST /v1/challans leaves them, for the release specs

export const RECORDED_AT = new Date('2026-12-01T04:00:00Z');
export const RELEASE_EXPIRES_AT = new Date('2026-12-08T04:00:00Z');

export type ReleaseSeed = { agentId: string; micro: bigint; status?: 'pending' | 'scheduled' };

export const seedChallan = async (
  db: KoshaDb,
  receiverId: string,
  releases: ReleaseSeed[]
): Promise<{ challanId: string; releaseIds: string[] }> => {
  const [recorded] = await db
    .insert(challan)
    .values({
      receiverID: receiverId,
      month: '2026-11',
      tdsPaise: releases.reduce((sum, row) => sum + row.micro, 0n),
      challanRefHash: 'ab'.repeat(32),
      recordedAt: RECORDED_AT
    })
    .returning({ id: challan.id });
  if (!recorded) throw new Error('[close-fixture]: challan not saved');
  const rows = await db
    .insert(release)
    .values(
      releases.map((row, index) => ({
        challanID: recorded.id,
        agentID: row.agentId,
        reserveAccountID: '0.0.6101',
        toAccountID: '0.0.5001',
        micro: row.micro,
        expiresAt: RELEASE_EXPIRES_AT,
        status: row.status ?? 'pending',
        scheduleID: row.status === 'scheduled' ? `0.0.80${index}` : null,
        createdAt: new Date(RECORDED_AT.getTime() + index)
      }))
    )
    .returning({ id: release.id });
  return { challanId: recorded.id, releaseIds: rows.map((row) => row.id) };
};

const receipt = (scheduleId: string | null): ReceiptLike => ({
  topicSequenceNumber: null,
  accountId: null,
  scheduleId
});

// Answers every ScheduleCreate with the next outcome; a fresh schedule ID by default
export const fakeScheduler = (...outcomes: Executed[]) => {
  const seen: Transaction[] = [];
  let created = 0;
  const execute: Executor = async (transaction) => {
    seen.push(transaction);
    const next = outcomes.shift();
    if (next) return next;
    created += 1;
    const id = transaction instanceof ScheduleCreateTransaction ? `0.0.90${created}` : null;
    return { ok: true, data: receipt(id) };
  };
  return { execute, seen };
};

export const IDENTICAL_SCHEDULE: Executed = {
  ok: false,
  data: { status: 'IDENTICAL_SCHEDULE_ALREADY_CREATED', receipt: receipt('0.0.8001') }
};

// executed_failed: the schedule ran, but the transfer inside it failed
type ScheduleAnswer = MirrorSchedule['status'] | 'missing' | 'executed_failed';
const RAN_AT = '1796529960.000000000';
const RAN_AND_FAILED_AT = '1796529961.000000000';

export const fakeMirror = (answers: Record<string, ScheduleAnswer>) => ({
  scheduleStatus: async (scheduleId: string): Promise<MirrorResult<MirrorSchedule>> => {
    const answer = answers[scheduleId];
    if (!answer || answer === 'missing') return { ok: false, data: { reason: 'not_found' } };
    const failed = answer === 'executed_failed';
    return {
      ok: true,
      data: {
        scheduleId,
        status: failed ? 'executed' : answer,
        executedAt: answer === 'executed' ? RAN_AT : failed ? RAN_AND_FAILED_AT : null,
        expiresAt: '1765166400.000000000',
        payerAccountId: '0.0.4000'
      }
    };
  },
  transactionAt: async (timestamp: string): Promise<MirrorResult<MirrorTransaction>> => ({
    ok: true,
    data: {
      transactionId: '0.0.4000-1796529900-000000000',
      consensusTimestamp: timestamp,
      result: timestamp === RAN_AT ? 'SUCCESS' : 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT',
      name: 'CRYPTOTRANSFER',
      memo: '',
      tokenTransfers: []
    }
  })
});

const AGENT_KEY = PrivateKey.generateED25519();

// What scripts/cosign-release.ts sends: a ScheduleSign frozen with the agent as payer and signed
// by its key, serialized
export const signedScheduleSign = async (scheduleId: string): Promise<string> => {
  const transaction = new ScheduleSignTransaction()
    .setScheduleId(scheduleId)
    .setTransactionId(TransactionId.generate(AccountId.fromString('0.0.6001')))
    .setNodeAccountIds([AccountId.fromString('0.0.3')])
    .freeze();
  await transaction.sign(AGENT_KEY);
  return Buffer.from(transaction.toBytes()).toString('base64');
};
