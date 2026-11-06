import type { Executor } from './executor';
import { AccountId, TopicMessageSubmitTransaction, TransactionId } from '@hiero-ledger/sdk';

// Kosha's HCS records fit in one message, so each is one transaction and one sequence number
export const HCS_MESSAGE_LIMIT_BYTES = 1024;

// A receipt that succeeded without a sequence number: the message landed, its number is unknown
export const NO_SEQUENCE_STATUS = 'NO_SEQUENCE_NUMBER';

export type HcsJson = string | number | boolean | null | HcsJson[] | { [key: string]: HcsJson };

export type Submitted =
  // runningHash: the topic's running hash after this message, hex; null if the receipt had none
  | { ok: true; data: { sequence: number; runningHash: string | null } }
  | { ok: false; data: { reason: 'too_large'; bytes: number } }
  | { ok: false; data: { reason: 'rejected'; status: string } };

// A fresh transaction ID for the payer. A caller that stores it before submitting can ask the
// Mirror Node later whether that submission reached consensus, instead of posting twice.
export const newTransactionId = (payer: string): string =>
  TransactionId.generate(AccountId.fromString(payer)).toString();

// Submits one JSON message. Every Kosha topic has Core's key as its submit key, and Core's client
// is the operator, so the operator's signature satisfies it.
export const submitMessage = async (
  execute: Executor,
  topicId: string,
  message: HcsJson,
  transactionId?: string
): Promise<Submitted> => {
  const text = JSON.stringify(message);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > HCS_MESSAGE_LIMIT_BYTES) return { ok: false, data: { reason: 'too_large', bytes } };

  const transaction = new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(text)
    .setMaxChunks(1);
  if (transactionId) transaction.setTransactionId(TransactionId.fromString(transactionId));
  const executed = await execute(transaction);
  if (!executed.ok)
    return { ok: false, data: { reason: 'rejected', status: executed.data.status } };

  const sequence = executed.data.topicSequenceNumber;
  if (!sequence) return { ok: false, data: { reason: 'rejected', status: NO_SEQUENCE_STATUS } };
  const hash = executed.data.topicRunningHash;
  return {
    ok: true,
    data: {
      sequence: Number(sequence.toString()),
      runningHash: hash ? Buffer.from(hash).toString('hex') : null
    }
  };
};
