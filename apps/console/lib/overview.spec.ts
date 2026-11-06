import { istDateKey, istMonthStart, overviewStats } from '@/lib/overview';
import { type LedgerRow, ledgerRowSchema } from '@kosha/shared/console-api';
import { LEDGER_PAGE_FIXTURE } from '@kosha/shared/fixtures';
import { describe, expect, it } from 'vitest';

const base = LEDGER_PAGE_FIXTURE.rows[0];
const row = (consensusAt: string, priceMicro: string, tdsMicro = '0'): LedgerRow =>
  ledgerRowSchema.parse({ ...base, paymentId: consensusAt, consensusAt, priceMicro, tdsMicro });

// 2026-11-06 15:51:00 IST
const NOW = new Date('2026-11-06T10:21:00.000Z');

describe('IST calendar helpers', () => {
  it('keys days by Indian time, so 20:00 UTC is already tomorrow', () => {
    expect(istDateKey(new Date('2026-11-05T20:00:00Z'))).toBe('2026-11-06');
  });

  it('starts the month at IST midnight', () => {
    expect(istMonthStart(NOW).toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });
});

describe('overviewStats', () => {
  it('splits earnings by IST day and month and sums the TDS reserved', () => {
    const stats = overviewStats(
      [
        row('2026-11-06T10:20:30Z', '100000', '1019'),
        row('2026-11-06T02:00:00Z', '250000'),
        row('2026-11-01T00:00:00Z', '50000', '20023'),
        row('2026-10-31T17:00:00Z', '900000', '9000')
      ],
      NOW
    );
    expect(stats).toEqual({
      todayMicro: '350000',
      monthMicro: '400000',
      tdsMonthMicro: '21042',
      paymentsLastMinute: 1
    });
  });

  it('counts payments in the last minute only', () => {
    const rows = ['10:20:01', '10:20:59', '10:19:59', '10:21:30'].map((time) =>
      row(`2026-11-06T${time}Z`, '100000')
    );
    expect(overviewStats(rows, NOW).paymentsLastMinute).toBe(2);
  });

  it('is all zeros with no payments', () => {
    expect(overviewStats([], NOW)).toEqual({
      todayMicro: '0',
      monthMicro: '0',
      tdsMonthMicro: '0',
      paymentsLastMinute: 0
    });
  });
});
