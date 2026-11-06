import type { MirrorClient } from '@kosha/hedera/mirror';
import { transactionIdSchema } from '@kosha/shared/ids';
import { toMirrorTransactionId } from '@kosha/shared/links';

// A transaction can reach consensus only within its valid duration (120 s by default). Past that,
// with a margin for Mirror Node lag, a transaction the Mirror Node doesn't know never landed.
const LANDS_WITHIN_SECONDS = 120 + 60;

export type PriorSubmission =
  | { state: 'published'; sequence: number; runningHash: string }
  | { state: 'absent' }
  | { state: 'unknown' };

// What became of an earlier HCS submission: published (with its sequence number), absent (safe to
// submit again), or unknown (it may still land, so the message waits)
export const mirrorSubmissionLookup =
  (
    mirror: Pick<MirrorClient, 'transactionById' | 'topicMessageAt'>,
    now: () => Date = () => new Date()
  ) =>
  async (transactionId: string): Promise<PriorSubmission> => {
    const parsed = transactionIdSchema.safeParse(transactionId);
    if (!parsed.success) return { state: 'absent' };

    const found = await mirror.transactionById(toMirrorTransactionId(parsed.data));
    if (found.ok) {
      if (found.data.result !== 'SUCCESS') return { state: 'absent' };
      const message = await mirror.topicMessageAt(found.data.consensusTimestamp);
      return message.ok
        ? {
            state: 'published',
            sequence: message.data.sequence,
            runningHash: message.data.runningHash
          }
        : { state: 'unknown' };
    }
    if (found.data.reason !== 'not_found') return { state: 'unknown' };

    const validStartSeconds = Number(parsed.data.split('@')[1]?.split('.')[0]);
    const landsBy = (validStartSeconds + LANDS_WITHIN_SECONDS) * 1000;
    return now().getTime() > landsBy ? { state: 'absent' } : { state: 'unknown' };
  };
