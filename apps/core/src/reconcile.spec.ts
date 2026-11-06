import { mirrorReconciler } from './reconcile';
import type { MirrorResult, MirrorTransaction } from '@kosha/hedera/mirror';
import { describe, expect, it } from 'vitest';

const TX = '0.0.4000@1794911400.000000000';
const OPTIONS = { attempts: 3, delayMs: 1, wait: async () => undefined };

const found = (result: string): MirrorResult<MirrorTransaction> => ({
  ok: true,
  data: {
    transactionId: '0.0.4000-1794911400-000000000',
    consensusTimestamp: '1794911402.000000001',
    result,
    name: 'CRYPTOTRANSFER',
    memo: 'kosha:q_7f3a',
    tokenTransfers: []
  }
});

const mirrorAnswering = (...answers: MirrorResult<MirrorTransaction>[]) => {
  const asked: string[] = [];
  const mirror = {
    transactionById: async (id: string): Promise<MirrorResult<MirrorTransaction>> => {
      asked.push(id);
      return answers.shift() ?? { ok: false, data: { reason: 'not_found' } };
    }
  };
  return { mirror, asked };
};

describe('mirrorReconciler', () => {
  it('reads the consensus result, by the Mirror form of the transaction ID', async () => {
    const success = mirrorAnswering(found('SUCCESS'));
    expect(await mirrorReconciler(success.mirror, OPTIONS)(TX)).toBe('settled');
    expect(success.asked).toEqual(['0.0.4000-1794911400-000000000']);

    const failure = mirrorAnswering(found('INSUFFICIENT_TOKEN_BALANCE'));
    expect(await mirrorReconciler(failure.mirror, OPTIONS)(TX)).toBe('failed');
  });

  it('waits for a lagging Mirror Node, then gives up as unknown', async () => {
    const lagging = mirrorAnswering({ ok: false, data: { reason: 'not_found' } }, found('SUCCESS'));
    expect(await mirrorReconciler(lagging.mirror, OPTIONS)(TX)).toBe('settled');
    expect(lagging.asked).toHaveLength(2);

    const missing = mirrorAnswering();
    expect(await mirrorReconciler(missing.mirror, OPTIONS)(TX)).toBe('unknown');
    expect(missing.asked).toHaveLength(3);
    expect(await mirrorReconciler(missing.mirror, OPTIONS)('not-a-transaction')).toBe('unknown');
  });
});
