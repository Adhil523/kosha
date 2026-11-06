import {
  challanFor,
  currentMonth,
  monthLabel,
  recentMonths,
  RELEASE_STATUS_LABELS
} from '@/lib/monthly';
import { CHALLANS_FIXTURE } from '@kosha/shared/fixtures';
import { monthSchema, releaseRowSchema } from '@kosha/shared/tax-reports';
import { describe, expect, it } from 'vitest';

describe('currentMonth', () => {
  it('reads the month on the IST clock', () => {
    expect(currentMonth(new Date('2026-11-06T12:00:00Z'))).toBe('2026-11');
    // 1 December 00:10 IST is still 30 November in UTC
    expect(currentMonth(new Date('2026-11-30T18:40:00Z'))).toBe('2026-12');
  });
});

describe('recentMonths', () => {
  it('counts back across a new year, newest first', () => {
    expect(recentMonths(new Date('2027-02-10T12:00:00Z'), 4)).toEqual([
      '2027-02',
      '2027-01',
      '2026-12',
      '2026-11'
    ]);
  });
});

describe('monthLabel', () => {
  it('names the month and year', () => {
    expect(monthLabel(monthSchema.parse('2026-11'))).toBe('November 2026');
  });
});

describe('challanFor', () => {
  it('finds the month’s challan, or none', () => {
    expect(challanFor(CHALLANS_FIXTURE, monthSchema.parse('2026-10'))?.id).toBe('chl_1');
    expect(challanFor(CHALLANS_FIXTURE, monthSchema.parse('2026-11'))).toBeNull();
  });
});

describe('RELEASE_STATUS_LABELS', () => {
  it('names every status Core sends', () => {
    expect(Object.keys(RELEASE_STATUS_LABELS).sort()).toEqual(
      [...releaseRowSchema.shape.status.options].sort()
    );
  });
});
