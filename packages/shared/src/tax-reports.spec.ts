import { signedAmountSchema } from './money';
import { monthSchema, outsideClassifySchema, quarterSchema } from './tax-reports';
import { describe, expect, it } from 'vitest';

describe('tax reports', () => {
  it('requires a note when a transfer is marked as a gift', () => {
    expect(outsideClassifySchema.safeParse({ classification: 'consideration' }).success).toBe(true);
    expect(
      outsideClassifySchema.safeParse({ classification: 'not_consideration_gift' }).success
    ).toBe(false);
    expect(
      outsideClassifySchema.safeParse({
        classification: 'not_consideration_gift',
        note: 'Funding from spouse'
      }).success
    ).toBe(true);
  });

  it('accepts months and quarters in their own formats only', () => {
    expect(monthSchema.safeParse('2026-11').success).toBe(true);
    expect(monthSchema.safeParse('2026-13').success).toBe(false);
    expect(quarterSchema.safeParse('2026-Q3').success).toBe(true);
    expect(quarterSchema.safeParse('2026-Q5').success).toBe(false);
  });

  it('allows a negative gain but not a negative zero or a leading zero', () => {
    expect(signedAmountSchema.safeParse('-250').success).toBe(true);
    expect(signedAmountSchema.safeParse('-0').success).toBe(false);
    expect(signedAmountSchema.safeParse('007').success).toBe(false);
  });
});
