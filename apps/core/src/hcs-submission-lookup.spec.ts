import { mirrorSubmissionLookup } from './hcs-submission-lookup';
import type { MirrorClient, MirrorResult, MirrorTransaction } from '@kosha/hedera/mirror';
import { describe, expect, it } from 'vitest';

const ID = '0.0.4000@1794911400.000000001';
const VALID_START_MS = 1794911400_000;

const landed = (result: string): MirrorResult<MirrorTransaction> => ({
  ok: true,
  data: {
    transactionId: '0.0.4000-1794911400-000000001',
    consensusTimestamp: '1794911401.000000002',
    result,
    name: 'CONSENSUSSUBMITMESSAGE',
    memo: '',
    tokenTransfers: []
  }
});

const fakeMirror = (
  transaction: MirrorResult<MirrorTransaction>
): Pick<MirrorClient, 'transactionById' | 'topicMessageAt'> => ({
  transactionById: async () => transaction,
  topicMessageAt: async (timestamp) =>
    timestamp === '1794911401.000000002'
      ? { ok: true, data: { topicId: '0.0.7100', sequence: 42 } }
      : { ok: false, data: { reason: 'not_found' } }
});

const at = (ms: number) => () => new Date(ms);

describe('mirrorSubmissionLookup', () => {
  it('finds the sequence number of a submission that reached consensus', async () => {
    const lookup = mirrorSubmissionLookup(fakeMirror(landed('SUCCESS')));
    expect(await lookup(ID)).toEqual({ state: 'published', sequence: 42 });
  });

  it('reports a submission that failed at consensus as absent', async () => {
    const lookup = mirrorSubmissionLookup(fakeMirror(landed('INVALID_SIGNATURE')));
    expect(await lookup(ID)).toEqual({ state: 'absent' });
  });

  it('waits on a missing submission until its valid duration has passed', async () => {
    const missing = fakeMirror({ ok: false, data: { reason: 'not_found', status: 404 } });
    expect(await mirrorSubmissionLookup(missing, at(VALID_START_MS + 30_000))(ID)).toEqual({
      state: 'unknown'
    });
    expect(await mirrorSubmissionLookup(missing, at(VALID_START_MS + 600_000))(ID)).toEqual({
      state: 'absent'
    });
  });

  it('treats a Mirror Node outage as unknown', async () => {
    const down = fakeMirror({ ok: false, data: { reason: 'http_error', status: 503 } });
    expect(await mirrorSubmissionLookup(down, at(VALID_START_MS + 600_000))(ID)).toEqual({
      state: 'unknown'
    });
  });
});
