import type { MirrorClient } from '@kosha/hedera/mirror';
import { transactionIdSchema } from '@kosha/shared/ids';
import { toMirrorTransactionId } from '@kosha/shared/links';
import { setTimeout as sleep } from 'node:timers/promises';

// After a receipt timeout, the Mirror Node says whether the transaction reached consensus. It lags
// consensus by a few seconds, so it is asked a few times before Core gives up and leaves the
// payment pending. Core never resubmits the transaction.

export type ReconcileOptions = {
  attempts: number;
  delayMs: number;
  wait?: (ms: number) => Promise<unknown>;
};

export const mirrorReconciler =
  (mirror: Pick<MirrorClient, 'transactionById'>, options: ReconcileOptions) =>
  async (transactionId: string): Promise<'settled' | 'failed' | 'unknown'> => {
    const parsed = transactionIdSchema.safeParse(transactionId);
    if (!parsed.success) return 'unknown';
    const mirrorId = toMirrorTransactionId(parsed.data);
    const wait = options.wait ?? sleep;

    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      const found = await mirror.transactionById(mirrorId);
      if (found.ok) return found.data.result === 'SUCCESS' ? 'settled' : 'failed';
      if (attempt < options.attempts) await wait(options.delayMs);
    }
    return 'unknown';
  };
