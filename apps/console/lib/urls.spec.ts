import { URLS } from '@/lib/urls';
import { describe, expect, it } from 'vitest';

describe('URLS.core', () => {
  it('builds Core read URLs with an encoded query', () => {
    expect(URLS.core.ledger('http://localhost:4100', { receiverId: 'rcv in', limit: '50' })).toBe(
      'http://localhost:4100/v1/ledger?receiverId=rcv+in&limit=50'
    );
    expect(URLS.core.aggregates('http://localhost:4100/', 'rcv_in')).toBe(
      'http://localhost:4100/v1/aggregates?receiverId=rcv_in'
    );
    expect(URLS.core.stream('http://core.test', 'rcv_in')).toBe(
      'http://core.test/v1/stream?receiverId=rcv_in'
    );
  });
});
