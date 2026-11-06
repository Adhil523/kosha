import {
  currentQuarter,
  parseCsv,
  parseTdsExport,
  recentQuarters,
  summarise,
  toCsv
} from '@/lib/tax-report';
import { TDS_EXPORT_FIXTURE } from '@kosha/shared/fixtures';
import { describe, expect, it } from 'vitest';

const HEADER =
  'deducteeRef,considerationPaise,tdsPaise,rateBps,fundedBy,paymentDate,deductionDate,section,hcsSequence,transactionId';
const row = (ref: string, consideration: string, tds: string, bps: number, hcs = '6') =>
  `${ref},${consideration},${tds},${bps},deductee_reserve,2026-11-06,2026-11-06,393(1),${hcs},0.0.4000@1762424400.123456789`;

describe('quarters', () => {
  it('names the financial-year quarter in IST', () => {
    expect(currentQuarter(new Date('2026-11-06T12:00:00Z'))).toBe('2026-Q3');
    expect(currentQuarter(new Date('2027-02-01T00:00:00Z'))).toBe('2026-Q4');
    // 31 March 19:00 UTC is already 1 April in IST
    expect(currentQuarter(new Date('2027-03-31T19:00:00Z'))).toBe('2027-Q1');
  });

  it('lists recent quarters newest first, across the year boundary', () => {
    expect(recentQuarters(new Date('2026-05-01T00:00:00Z'), 3)).toEqual([
      '2026-Q1',
      '2025-Q4',
      '2025-Q3'
    ]);
  });
});

describe('parseCsv', () => {
  it('reads quoted cells with commas, quotes and newlines, and CRLF lines', () => {
    expect(parseCsv('a,"b,c","d ""e""",\r\n"f\ng",h\r\n')).toEqual([
      ['a', 'b,c', 'd "e"', ''],
      ['f\ng', 'h']
    ]);
  });
});

describe('parseTdsExport', () => {
  it("reads Core's export into typed rows, with an empty HCS sequence as null", () => {
    const csv = [
      HEADER,
      row('0.0.6***', '884', '9', 100),
      row('PANNOTAVBL', '884', '177', 2000, '')
    ].join('\r\n');

    const rows = parseTdsExport(`${csv}\r\n`);

    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toMatchObject({ deducteeRef: '0.0.6***', rateBps: 100, hcsSequence: 6 });
    expect(rows?.[1]).toMatchObject({ tdsPaise: '177', hcsSequence: null });
  });

  it('refuses a header or a row that breaks the contract', () => {
    expect(parseTdsExport('deducteeRef,tdsPaise\r\n')).toBeNull();
    expect(parseTdsExport(`${HEADER}\r\n${row('0.0.6***', 'x', '9', 100)}`)).toBeNull();
  });

  it('reads a header-only export as no rows', () => {
    expect(parseTdsExport(`${HEADER}\r\n`)).toEqual([]);
  });
});

describe('toCsv', () => {
  it("writes rows in Core's format, so parseTdsExport reads them back", () => {
    expect(parseTdsExport(toCsv(TDS_EXPORT_FIXTURE))).toEqual(TDS_EXPORT_FIXTURE);
    expect(toCsv([])).toBe(`${HEADER}\r\n`);
  });
});

describe('summarise', () => {
  it('totals the quarter and each deductee, keeping every rate seen', () => {
    const [first] = TDS_EXPORT_FIXTURE;
    if (!first) throw new Error('the export fixture has no rows');
    const other = {
      ...first,
      deducteeRef: 'PANNOTAVBL',
      tdsPaise: first.considerationPaise,
      rateBps: 2000
    };

    const summary = summarise([first, { ...first, rateBps: 2000 }, other]);

    expect(summary.totals).toEqual({ payments: 3, considerationPaise: '2652', tdsPaise: '902' });
    expect(summary.deductees).toEqual([
      {
        deducteeRef: first.deducteeRef,
        payments: 2,
        considerationPaise: '1768',
        tdsPaise: '18',
        rates: [100, 2000]
      },
      {
        deducteeRef: 'PANNOTAVBL',
        payments: 1,
        considerationPaise: '884',
        tdsPaise: '884',
        rates: [2000]
      }
    ]);
  });
});
