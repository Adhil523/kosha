import { financialYear, istDayKey, quarterOf } from './ist-calendar';
import { describe, expect, it } from 'vitest';

// 2027-04-01 00:00 IST is 2027-03-31 18:30 UTC.
const LAST_SECOND_OF_FY_2026_27 = new Date('2027-03-31T18:29:59Z');
const FIRST_SECOND_OF_FY_2027_28 = new Date('2027-03-31T18:30:00Z');

describe('financialYear', () => {
  it('changes year at midnight IST on 1 April, not midnight UTC', () => {
    expect(financialYear(LAST_SECOND_OF_FY_2026_27)).toBe('2026-27');
    expect(financialYear(FIRST_SECOND_OF_FY_2027_28)).toBe('2027-28');
  });

  it('places January to March in the year that started the previous April', () => {
    expect(financialYear(new Date('2027-01-15T06:00:00Z'))).toBe('2026-27');
  });

  it('pads the century rollover', () => {
    expect(financialYear(new Date('2099-06-01T00:00:00Z'))).toBe('2099-00');
  });

  it('honours a different start month', () => {
    expect(financialYear(new Date('2026-06-01T00:00:00Z'), '07-01')).toBe('2025-26');
    expect(financialYear(new Date('2026-07-01T00:00:00Z'), '07-01')).toBe('2026-27');
  });

  it('rejects a start that is not the 1st of a month', () => {
    expect(() => financialYear(new Date(), '04-15')).toThrow(RangeError);
  });

  it('rejects an invalid date', () => {
    expect(() => financialYear(new Date('not a date'))).toThrow(RangeError);
  });
});

describe('istDayKey', () => {
  it('rolls over at 18:30 UTC', () => {
    expect(istDayKey(new Date('2026-11-06T18:29:59Z'))).toBe('2026-11-06');
    expect(istDayKey(new Date('2026-11-06T18:30:00Z'))).toBe('2026-11-07');
  });

  it('is already the next day in IST shortly before UTC midnight', () => {
    expect(istDayKey(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01');
  });
});

describe('quarterOf', () => {
  it('puts the last second of March (IST) in Q4 of the old year', () => {
    expect(quarterOf(LAST_SECOND_OF_FY_2026_27)).toEqual({
      financialYear: '2026-27',
      quarter: 4,
      key: '2026-Q4'
    });
  });

  it('puts the first second of April (IST) in Q1 of the new year', () => {
    expect(quarterOf(FIRST_SECOND_OF_FY_2027_28)).toEqual({
      financialYear: '2027-28',
      quarter: 1,
      key: '2027-Q1'
    });
  });

  it.each([
    ['2026-05-10T00:00:00Z', 1],
    ['2026-08-10T00:00:00Z', 2],
    ['2026-11-06T00:00:00Z', 3],
    ['2027-02-10T00:00:00Z', 4]
  ] as const)('%s is Q%i', (iso, quarter) => {
    expect(quarterOf(new Date(iso)).quarter).toBe(quarter);
  });

  it('labels October to December 2026 as 2026-Q3', () => {
    expect(quarterOf(new Date('2026-10-01T00:00:00Z')).key).toBe('2026-Q3');
  });
});
