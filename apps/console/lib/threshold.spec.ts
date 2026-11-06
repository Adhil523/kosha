import { counterState, paiseToMicro, parseFxPaisePerUsd } from '@/lib/threshold';
import { aggregateRowSchema } from '@kosha/shared/console-api';
import { AGGREGATES_FIXTURE } from '@kosha/shared/fixtures';
import { describe, expect, it } from 'vitest';

const [resident, unverified] = AGGREGATES_FIXTURE;
const withValues = (fields: Record<string, unknown>) =>
  aggregateRowSchema.parse({ ...resident, ...fields });

describe('counterState', () => {
  it('shows a crossed verified payer as 1% reserved', () => {
    expect(counterState(resident)).toMatchObject({
      fillPct: 100,
      crossed: true,
      near: true,
      status: '1% reserved'
    });
  });

  it('marks the tolerance for an unverified payer and turns amber at 90%', () => {
    expect(counterState(unverified)).toEqual({
      fillPct: 45,
      tolerancePct: 50,
      near: true,
      crossed: false,
      status: 'Nearing the limit'
    });
  });

  it('shows a crossed unverified payer as 20% reserved', () => {
    const crossed = {
      ...unverified,
      valuePaise: unverified.tolerancePaise ?? unverified.valuePaise,
      pct: 100
    };
    expect(counterState(crossed).status).toBe('20% reserved');
  });

  it('counts outside payments towards the threshold', () => {
    const state = counterState(
      withValues({ valuePaise: '300000', outsideValuePaise: '200000', pct: 50 })
    );
    expect(state).toMatchObject({ fillPct: 50, near: false, status: 'Under the limit' });
  });

  it('never reports TDS here for a non-resident payer', () => {
    expect(counterState(withValues({ payerResidency: 'non_resident' })).status).toBe(
      'Non-resident: no TDS here'
    );
  });
});

describe('FX helpers', () => {
  it('parses the demo rate into paise per USD', () => {
    expect(parseFxPaisePerUsd('88.40')).toBe(8840n);
    expect(parseFxPaisePerUsd('88.4')).toBe(8840n);
    expect(parseFxPaisePerUsd('88')).toBe(8800n);
    expect(parseFxPaisePerUsd('abc')).toBeNull();
    expect(parseFxPaisePerUsd(undefined)).toBeNull();
  });

  it('converts ₹10,000 to USDC at ₹88.40', () => {
    expect(paiseToMicro(1_000_000n, 8840n)).toBe(113_122_171n);
  });
});
