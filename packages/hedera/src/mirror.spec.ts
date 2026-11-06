/* eslint-disable @typescript-eslint/naming-convention -- the Mirror Node REST API names its fields in snake_case; these schemas mirror that contract */
import { createMirrorClient, type FetchLike } from './mirror';
import { describe, expect, it } from 'vitest';

const BASE = 'https://testnet.mirrornode.hedera.com';
const memo = (text: string) => Buffer.from(text).toString('base64');

// Serves canned responses by path and records every URL requested
const fakeFetch = (routes: Record<string, { status?: number; body: unknown }>) => {
  const requested: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    requested.push(url);
    const route = routes[url.replace(BASE, '')];
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    const status = route.status ?? 200;
    return { ok: status < 400, status, json: async () => route.body };
  };
  return { fetchImpl, requested };
};

const transfer = (id: string, timestamp: string, moves: [string, number][], text = '') => ({
  transaction_id: id,
  consensus_timestamp: timestamp,
  result: 'SUCCESS',
  name: 'CRYPTOTRANSFER',
  memo_base64: memo(text),
  token_transfers: moves.map(([account, amount]) => ({ token_id: '0.0.429274', account, amount }))
});

describe('mirror client', () => {
  it('reads an account key', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/v1/accounts/0.0.6001': {
        body: { account: '0.0.6001', key: { _type: 'ED25519', key: 'ab12' } }
      }
    });
    const mirror = createMirrorClient(`${BASE}/`, fetchImpl);
    expect(await mirror.accountKey('0.0.6001')).toEqual({
      ok: true,
      data: { type: 'ED25519', hex: 'ab12' }
    });
    expect(await mirror.accountKey('0.0.9999')).toEqual({
      ok: false,
      data: { reason: 'not_found', status: 404 }
    });
  });

  it('reads an account memo', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/v1/accounts/0.0.6001': {
        body: { account: '0.0.6001', memo: 'hcs-11:hcs://1/0.0.7001' }
      }
    });
    const mirror = createMirrorClient(BASE, fetchImpl);
    expect(await mirror.accountMemo('0.0.6001')).toEqual({
      ok: true,
      data: 'hcs-11:hcs://1/0.0.7001'
    });
  });

  it('reads a transaction with its token transfers and decoded memo', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/v1/transactions/0.0.4000-1762424400-000000001': {
        body: {
          transactions: [
            transfer(
              '0.0.4000-1762424400-000000001',
              '1762424402.1',
              [
                ['0.0.6001', -101019],
                ['0.0.5001', 100000],
                ['0.0.6101', 1019]
              ],
              'kosha:q_7f3a'
            )
          ]
        }
      }
    });
    const result = await createMirrorClient(BASE, fetchImpl).transactionById(
      '0.0.4000-1762424400-000000001'
    );
    expect(result.ok && result.data.memo).toBe('kosha:q_7f3a');
    expect(result.ok && result.data.tokenTransfers.map((t) => [t.account, t.amount])).toEqual([
      ['0.0.6001', -101019n],
      ['0.0.5001', 100000n],
      ['0.0.6101', 1019n]
    ]);
  });

  it('collects credits across pages and returns the last timestamp as the cursor', async () => {
    const first = `/api/v1/transactions?account.id=0.0.5001&transactiontype=CRYPTOTRANSFER&timestamp=gt:100.0&order=asc&limit=100`;
    const second = '/api/v1/transactions?account.id=0.0.5001&timestamp=gt:200.0&page=2';
    const { fetchImpl, requested } = fakeFetch({
      [first]: {
        body: {
          transactions: [
            transfer(
              'a',
              '150.0',
              [
                ['0.0.6001', -500],
                ['0.0.5001', 500]
              ],
              'gift'
            ),
            transfer('b', '200.0', [
              ['0.0.5001', -10],
              ['0.0.7000', 10]
            ])
          ],
          links: { next: second }
        }
      },
      [second]: {
        body: {
          transactions: [
            transfer('c', '250.0', [
              ['0.0.6002', -9],
              ['0.0.5001', 9]
            ])
          ],
          links: { next: null }
        }
      }
    });

    const result = await createMirrorClient(BASE, fetchImpl).tokenCreditsSince(
      '0.0.5001',
      '0.0.429274',
      '100.0'
    );

    expect(requested).toHaveLength(2);
    expect(result).toEqual({
      ok: true,
      data: {
        credits: [
          {
            transactionId: 'a',
            consensusTimestamp: '150.0',
            memo: 'gift',
            amount: 500n,
            from: ['0.0.6001']
          },
          {
            transactionId: 'c',
            consensusTimestamp: '250.0',
            memo: '',
            amount: 9n,
            from: ['0.0.6002']
          }
        ],
        cursor: '250.0'
      }
    });
  });

  it('reports a schedule as pending, executed or deleted', async () => {
    const schedule = (executed: string | null, deleted: boolean) => ({
      schedule_id: '0.0.8001',
      executed_timestamp: executed,
      deleted,
      expiration_time: '1763029200.0',
      payer_account_id: '0.0.4000'
    });
    const { fetchImpl } = fakeFetch({
      '/api/v1/schedules/0.0.8001': { body: schedule('1762430000.5', false) },
      '/api/v1/schedules/0.0.8002': { body: schedule(null, false) },
      '/api/v1/schedules/0.0.8003': { body: schedule(null, true) }
    });
    const mirror = createMirrorClient(BASE, fetchImpl);
    const statuses = await Promise.all(
      ['0.0.8001', '0.0.8002', '0.0.8003'].map(async (id) => {
        const result = await mirror.scheduleStatus(id);
        return result.ok ? result.data.status : result.data.reason;
      })
    );
    expect(statuses).toEqual(['executed', 'pending', 'deleted']);
  });

  it('reports server errors, bad bodies and network failures', async () => {
    const { fetchImpl } = fakeFetch({
      '/api/v1/accounts/0.0.1': { status: 503, body: {} },
      '/api/v1/accounts/0.0.2': { body: { unexpected: true } }
    });
    const mirror = createMirrorClient(BASE, fetchImpl);
    expect((await mirror.accountKey('0.0.1')).data).toEqual({ reason: 'http_error', status: 503 });
    expect((await mirror.accountKey('0.0.2')).data).toMatchObject({ reason: 'invalid_response' });

    const offline = createMirrorClient(BASE, async () => {
      throw new Error('offline');
    });
    expect((await offline.accountKey('0.0.3')).data).toEqual({ reason: 'http_error' });
  });
});
