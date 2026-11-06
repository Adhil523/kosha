import { deducteeRef, quarterBounds, tdsPaiseOf, toTdsCsv } from './tds-export';
import { TDS_EXPORT_FIXTURE } from '@kosha/shared/fixtures';
import { quarterOf } from '@kosha/tax-engine/ist-calendar';
import { paiseToMicroUsdc } from '@kosha/tax-engine/minor-units';
import { describe, expect, it } from 'vitest';

describe('quarterBounds', () => {
  it('gives the IST quarter of an April financial year', () => {
    expect(quarterBounds('2026-Q3', '04-01')).toEqual({
      start: new Date('2026-09-30T18:30:00Z'),
      end: new Date('2026-12-31T18:30:00Z')
    });
    expect(quarterBounds('2026-Q4', '04-01')?.end).toEqual(new Date('2027-03-31T18:30:00Z'));
  });

  it('agrees with the tax engine on which quarter each edge belongs to', () => {
    const bounds = quarterBounds('2026-Q1', '04-01');
    if (!bounds) throw new Error('no bounds');
    expect(quarterOf(bounds.start).key).toBe('2026-Q1');
    expect(quarterOf(new Date(bounds.end.getTime() - 1)).key).toBe('2026-Q1');
    expect(quarterOf(bounds.end).key).toBe('2026-Q2');
  });

  it('refuses a key that is not a quarter', () => {
    expect(quarterBounds('2026-Q5', '04-01')).toBeNull();
  });
});

describe('tdsPaiseOf', () => {
  it("recovers the spec's 9 paise from 1019 micro-USDC at ₹88.40", () => {
    expect(tdsPaiseOf(1019n, 88_400_000n)).toBe(9n);
  });

  it('inverts the tax engine’s conversion for every amount and a spread of rates', () => {
    for (const rate of [1_000_000n, 83_123_456n, 88_400_000n, 9_999_000_000n]) {
      for (let paise = 0n; paise <= 5_000n; paise += 7n) {
        expect(tdsPaiseOf(paiseToMicroUsdc(paise, rate), rate)).toBe(paise);
      }
    }
  });
});

describe('deducteeRef', () => {
  it('masks the account and marks a payer with no PAN', () => {
    expect(deducteeRef('hedera:testnet:0.0.6001', true)).toBe('0.0.6***');
    expect(deducteeRef('hedera:testnet:0.0.6003', false)).toBe('PANNOTAVBL 0.0.6***');
  });
});

describe('toTdsCsv', () => {
  it('writes the schema keys as the header and quotes cells that need it', () => {
    const [row] = TDS_EXPORT_FIXTURE;
    if (!row) throw new Error('fixture');
    const csv = toTdsCsv([{ ...row, deducteeRef: 'A, "B"' }]);
    expect(csv.split('\r\n')[0]).toBe(
      'deducteeRef,considerationPaise,tdsPaise,rateBps,fundedBy,paymentDate,deductionDate,section,hcsSequence,transactionId'
    );
    expect(csv.split('\r\n')[1]?.startsWith('"A, ""B""",884,9,100,deductee_reserve,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
