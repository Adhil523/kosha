import {
  AGENTS_FIXTURE,
  AGGREGATES_FIXTURE,
  CHALLANS_FIXTURE,
  LEDGER_PAGE_FIXTURE,
  MONTHLY_CLOSE_FIXTURE,
  OUTSIDE_PAYMENTS_FIXTURE,
  PAYER_REPORT_FIXTURE,
  POLICY_FIXTURE,
  RELEASES_FIXTURE,
  STREAM_EVENTS_FIXTURE,
  SUPPORTED_FIXTURE,
  TDS_EXPORT_FIXTURE
} from './fixtures';
import { amountToBigint } from './money';
import { describe, expect, it } from 'vitest';

describe('fixtures', () => {
  // Loading the module already parsed every fixture through its schema; this pins that none is empty
  it.each(
    Object.entries({
      AGENTS_FIXTURE,
      AGGREGATES_FIXTURE,
      CHALLANS_FIXTURE,
      LEDGER_ROWS: LEDGER_PAGE_FIXTURE.rows,
      MONTHLY_ROWS: MONTHLY_CLOSE_FIXTURE.rows,
      OUTSIDE_PAYMENTS_FIXTURE,
      PAYER_REPORT_FIXTURE,
      RELEASES_FIXTURE,
      STREAM_EVENTS_FIXTURE,
      TDS_EXPORT_FIXTURE
    })
  )('%s has examples', (_name, rows) => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('covers every ledger case the Console renders', () => {
    // receiver-in deducts from the first rupee: 1% verified, 20% unverified, nothing non-resident
    const reasons = new Set(LEDGER_PAGE_FIXTURE.rows.map((row) => row.reason));
    expect(reasons).toEqual(new Set(['first_rupee', 'non_resident']));
    const rates = new Set(LEDGER_PAGE_FIXTURE.rows.map((row) => row.rateBps));
    expect(rates).toEqual(new Set([0, 100, 2000]));
    expect(LEDGER_PAGE_FIXTURE.rows.some((row) => row.mode === 'compat')).toBe(true);
    expect(LEDGER_PAGE_FIXTURE.rows.some((row) => row.sample)).toBe(true);
  });

  it('keeps the monthly close total equal to its rows', () => {
    const sum = MONTHLY_CLOSE_FIXTURE.rows.reduce(
      (total, row) => total + amountToBigint(row.tdsPaise),
      0n
    );
    expect(sum).toBe(amountToBigint(MONTHLY_CLOSE_FIXTURE.totalTdsPaise));
  });

  it('includes one stream event of each type', () => {
    expect(STREAM_EVENTS_FIXTURE.map((event) => event.type)).toEqual([
      'payment.settled',
      'tds.withheld',
      'threshold.near',
      'outside.payment'
    ]);
  });

  it('has a policy and a supported response with both schemes', () => {
    expect(POLICY_FIXTURE.acceptRulepacks).toContain('in-2026.*');
    expect(SUPPORTED_FIXTURE.kinds.map((kind) => kind.scheme)).toEqual(['kosha-split', 'exact']);
  });
});
