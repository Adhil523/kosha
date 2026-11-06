import type { Executor } from './executor';
import { TopicMessageSubmitTransaction } from '@hiero-ledger/sdk';

// Kosha's HCS records fit in one message, so each is one transaction and one sequence number
export const HCS_MESSAGE_LIMIT_BYTES = 1024;

export type HcsJson = string | number | boolean | null | HcsJson[] | { [key: string]: HcsJson };

export type Submitted =
  | { ok: true; data: { sequence: number } }
  | { ok: false; data: { reason: 'too_large'; bytes: number } }
  | { ok: false; data: { reason: 'rejected'; status: string } };

// Submits one JSON message. Every Kosha topic has Core's key as its submit key, and Core's client
// is the operator, so the operator's signature satisfies it.
export const submitMessage = async (
  execute: Executor,
  topicId: string,
  message: HcsJson
): Promise<Submitted> => {
  const text = JSON.stringify(message);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > HCS_MESSAGE_LIMIT_BYTES) return { ok: false, data: { reason: 'too_large', bytes } };

  const transaction = new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(text)
    .setMaxChunks(1);
  const executed = await execute(transaction);
  if (!executed.ok)
    return { ok: false, data: { reason: 'rejected', status: executed.data.status } };

  const sequence = executed.data.topicSequenceNumber;
  if (!sequence) return { ok: false, data: { reason: 'rejected', status: 'NO_SEQUENCE_NUMBER' } };
  return { ok: true, data: { sequence: Number(sequence.toString()) } };
};
