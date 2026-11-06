import { prependLedgerRow } from '@/lib/ledger-cache';
import { LEDGER_PAGE_FIXTURE } from '@kosha/shared/fixtures';
import { describe, expect, it } from 'vitest';

const [newest, second] = LEDGER_PAGE_FIXTURE.rows;

describe('prependLedgerRow', () => {
  it('puts a streamed payment on top and keeps the cursor', () => {
    const page = { rows: LEDGER_PAGE_FIXTURE.rows.slice(1), nextCursor: 'cur_1' };
    const next = prependLedgerRow(page, newest);
    expect(next.rows[0]).toBe(newest);
    expect(next.rows).toHaveLength(LEDGER_PAGE_FIXTURE.rows.length);
    expect(next.nextCursor).toBe('cur_1');
  });

  it('replaces a row the poll already fetched instead of duplicating it', () => {
    const next = prependLedgerRow(LEDGER_PAGE_FIXTURE, { ...newest, hcsSequence: 999 });
    expect(next.rows.filter((row) => row.paymentId === newest.paymentId)).toHaveLength(1);
    expect(next.rows[0].hcsSequence).toBe(999);
    expect(next.rows[1]).toBe(second);
  });

  it('starts a page when nothing is cached yet', () => {
    expect(prependLedgerRow(undefined, newest)).toEqual({ rows: [newest], nextCursor: null });
  });
});
