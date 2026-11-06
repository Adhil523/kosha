import type { Executed, Executor, ReceiptLike } from './executor';
import { HCS_MESSAGE_LIMIT_BYTES, submitMessage } from './hcs';
import { TopicMessageSubmitTransaction, type Transaction } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const receipt = (fields: Partial<ReceiptLike>): ReceiptLike => ({
  topicSequenceNumber: null,
  accountId: null,
  scheduleId: null,
  ...fields
});

const fakeExecutor = (result: Executed) => {
  const seen: Transaction[] = [];
  const execute: Executor = async (transaction) => {
    seen.push(transaction);
    return result;
  };
  return { execute, seen };
};

const PAY_RECORD = { v: 2, t: 'pay', pid: 'pay_1', tds: '1019', agg: '1000652' };

describe('submitMessage', () => {
  it('submits one JSON message to the topic and returns its sequence number', async () => {
    const { execute, seen } = fakeExecutor({
      ok: true,
      data: receipt({ topicSequenceNumber: 42n })
    });

    expect(await submitMessage(execute, '0.0.7001', PAY_RECORD)).toEqual({
      ok: true,
      data: { sequence: 42 }
    });

    const [transaction] = seen;
    expect(transaction).toBeInstanceOf(TopicMessageSubmitTransaction);
    if (!(transaction instanceof TopicMessageSubmitTransaction)) return;
    expect(transaction.topicId?.toString()).toBe('0.0.7001');
    expect(Buffer.from(transaction.message ?? new Uint8Array()).toString('utf8')).toBe(
      JSON.stringify(PAY_RECORD)
    );
    expect(transaction.maxChunks).toBe(1);
  });

  it('refuses a message over the 1,024-byte limit without submitting it', async () => {
    const { execute, seen } = fakeExecutor({ ok: true, data: receipt({}) });
    const tooBig = { note: 'x'.repeat(HCS_MESSAGE_LIMIT_BYTES) };

    const submitted = await submitMessage(execute, '0.0.7001', tooBig);

    expect(submitted.ok).toBe(false);
    expect(!submitted.ok && submitted.data.reason).toBe('too_large');
    expect(seen).toHaveLength(0);
  });

  it('counts bytes, not characters', async () => {
    const { execute } = fakeExecutor({ ok: true, data: receipt({ topicSequenceNumber: 1n }) });
    // 400 three-byte characters: 1,200 bytes in 400 characters
    const submitted = await submitMessage(execute, '0.0.7001', { note: 'क'.repeat(400) });
    expect(!submitted.ok && submitted.data.reason).toBe('too_large');
  });

  it('passes on the network status when the submission is rejected', async () => {
    const { execute } = fakeExecutor({
      ok: false,
      data: { status: 'INVALID_SIGNATURE', receipt: null }
    });
    expect(await submitMessage(execute, '0.0.7001', PAY_RECORD)).toEqual({
      ok: false,
      data: { reason: 'rejected', status: 'INVALID_SIGNATURE' }
    });
  });
});
