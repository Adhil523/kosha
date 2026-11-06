import { istFinancialYearStart, spendSummary } from '@/lib/spend';
import { LEDGER_PAGE_FIXTURE } from '@kosha/shared/fixtures';
import { describe, expect, it } from 'vitest';

const [base] = LEDGER_PAGE_FIXTURE.rows;
if (!base) throw new Error('the ledger fixture has no rows');

const row = (consensusAt: string, receiverId: string, priceMicro: string, tdsMicro: string) => ({
  ...base,
  consensusAt,
  receiverId,
  priceMicro: priceMicro as typeof base.priceMicro,
  tdsMicro: tdsMicro as typeof base.tdsMicro
});

const NOW = new Date('2026-11-06T12:00:00Z');

describe('istFinancialYearStart', () => {
  it('starts on 1 April IST, in the previous calendar year before April', () => {
    expect(istFinancialYearStart(NOW).toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(istFinancialYearStart(new Date('2027-03-31T18:00:00Z')).toISOString()).toBe(
      '2026-03-31T18:30:00.000Z'
    );
    // 1 April 00:10 IST is still 31 March in UTC
    expect(istFinancialYearStart(new Date('2027-03-31T18:40:00Z')).toISOString()).toBe(
      '2027-03-31T18:30:00.000Z'
    );
  });
});

describe('spendSummary', () => {
  const rows = [
    row('2026-11-06T10:00:00Z', 'rcv_in', '100000', '1019'),
    row('2026-11-06T09:00:00Z', 'rcv_in', '100000', '0'),
    // 5 November 23:00 UTC is 6 November 04:30 IST
    row('2026-11-05T23:00:00Z', 'rcv_global', '50000', '0'),
    row('2026-11-04T08:00:00Z', 'rcv_in', '250000', '2500'),
    // Last financial year: left out
    row('2026-03-01T08:00:00Z', 'rcv_in', '999000', '0')
  ];

  it('totals the year by API and by IST day, newest day first', () => {
    const summary = spendSummary(rows, { now: NOW, fyBudgetMicro: null });

    expect(summary).toMatchObject({ priceMicro: '500000', tdsMicro: '3519' });
    expect(summary.byApi).toEqual([
      { key: 'rcv_global', payments: 1, priceMicro: '50000', tdsMicro: '0' },
      { key: 'rcv_in', payments: 3, priceMicro: '450000', tdsMicro: '3519' }
    ]);
    expect(summary.byDay.map((line) => [line.key, line.payments])).toEqual([
      ['2026-11-06', 3],
      ['2026-11-04', 1]
    ]);
  });

  it('counts the TDS against the budget, and never goes below zero', () => {
    expect(spendSummary(rows, { now: NOW, fyBudgetMicro: 1_000_000n })).toMatchObject({
      budgetMicro: '1000000',
      budgetLeftMicro: '496481'
    });
    expect(spendSummary(rows, { now: NOW, fyBudgetMicro: 100n })).toMatchObject({
      budgetLeftMicro: '0'
    });
  });

  it('has no budget fields without a policy', () => {
    expect(spendSummary([], { now: NOW, fyBudgetMicro: null })).toMatchObject({
      priceMicro: '0',
      budgetMicro: null,
      budgetLeftMicro: null,
      byApi: [],
      byDay: []
    });
  });
});
