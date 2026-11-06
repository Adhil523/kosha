/* eslint-disable @typescript-eslint/naming-convention -- fake Mirror Node bodies use its snake_case fields */
import { createReserveProver } from './reserve-proof';
import { transactionIdSchema } from '@kosha/shared/ids';
import { paymentRequirementsSchema } from '@kosha/shared/x402-payment';
import * as fixture from '@kosha/shared/x402-payment.fixture';
import { describe, expect, it, vi } from 'vitest';

const TX = transactionIdSchema.parse('0.0.6001@1762424000.000000001');
const splitEntry = paymentRequirementsSchema.parse(fixture.splitEntry);
const exactEntry = paymentRequirementsSchema.parse(fixture.exactEntry);
const TOKEN = splitEntry.asset;
const RESERVE = '0.0.6101';

type Transfer = { token_id: string; account: string; amount: number };

const mirrorTransaction = (transfers: Transfer[], result = 'SUCCESS') => ({
  transactions: [
    {
      transaction_id: '0.0.6001-1762424000-000000001',
      consensus_timestamp: '1762424002.000000001',
      result,
      name: 'CRYPTOTRANSFER',
      memo_base64: null,
      token_transfers: transfers
    }
  ]
});

const SPLIT_ON_CHAIN: Transfer[] = [
  { token_id: TOKEN, account: '0.0.6001', amount: -101019 },
  { token_id: TOKEN, account: '0.0.5001', amount: 100000 },
  { token_id: TOKEN, account: RESERVE, amount: 1019 }
];

// Answers each Mirror Node call with the next reply; 404 once the replies run out
const fakeMirror = (...replies: { status: number; body?: unknown }[]) => {
  const fetchMock = vi.fn(async (url: string) => {
    expect(url).toBe('https://mirror.test/api/v1/transactions/0.0.6001-1762424000-000000001');
    const reply = replies.shift() ?? { status: 404 };
    return Response.json(reply.body ?? {}, { status: reply.status });
  });
  const sleep = vi.fn(async () => {});
  const prove = createReserveProver({
    mirrorUrl: 'https://mirror.test',
    fetch: fetchMock,
    sleep,
    timeoutMs: 3_000,
    pollMs: 1_000
  });
  return { prove, fetchMock, sleep };
};

describe('reserve proof', () => {
  it('proves a split whose reserve leg is credited on-chain', async () => {
    const { prove } = fakeMirror({ status: 200, body: mirrorTransaction(SPLIT_ON_CHAIN) });
    expect(await prove(TX, splitEntry)).toEqual({ status: 'proven' });
  });

  it('waits out Mirror Node lag, then proves', async () => {
    const { prove, sleep } = fakeMirror(
      { status: 404 },
      { status: 200, body: mirrorTransaction(SPLIT_ON_CHAIN) }
    );
    expect(await prove(TX, splitEntry)).toEqual({ status: 'proven' });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('fails when the reserve leg is short', async () => {
    const short = SPLIT_ON_CHAIN.map((t) => (t.account === RESERVE ? { ...t, amount: 1018 } : t));
    const { prove } = fakeMirror({ status: 200, body: mirrorTransaction(short) });
    expect(await prove(TX, splitEntry)).toEqual({ status: 'failed', reason: 'reserve_short' });
  });

  it('fails when the reserve leg is missing or paid in another token', async () => {
    const otherToken = SPLIT_ON_CHAIN.map((t) =>
      t.account === RESERVE ? { ...t, token_id: '0.0.999' } : t
    );
    const { prove } = fakeMirror({ status: 200, body: mirrorTransaction(otherToken) });
    expect(await prove(TX, splitEntry)).toEqual({ status: 'failed', reason: 'reserve_short' });
  });

  it('fails when the transaction did not succeed', async () => {
    const { prove } = fakeMirror({
      status: 200,
      body: mirrorTransaction(SPLIT_ON_CHAIN, 'INSUFFICIENT_TOKEN_BALANCE')
    });
    expect(await prove(TX, splitEntry)).toEqual({ status: 'failed', reason: 'transaction_failed' });
  });

  it('times out cleanly as unconfirmed when the Mirror Node never shows it', async () => {
    const { prove, fetchMock, sleep } = fakeMirror();
    expect(await prove(TX, splitEntry)).toEqual({ status: 'unconfirmed' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('skips the compatibility scheme without calling the Mirror Node', async () => {
    const { prove, fetchMock } = fakeMirror();
    expect(await prove(TX, exactEntry)).toEqual({ status: 'skipped' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
