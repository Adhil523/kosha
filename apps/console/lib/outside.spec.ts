import { CLASSIFICATION_LABELS, outsideSummary } from '@/lib/outside';
import { OUTSIDE_PAYMENTS_FIXTURE } from '@kosha/shared/fixtures';
import { describe, expect, it } from 'vitest';

const [flagged] = OUTSIDE_PAYMENTS_FIXTURE;
if (!flagged) throw new Error('the fixture has no outside payment');

describe('outsideSummary', () => {
  it('counts the pending transfers and adds up their shortfall', () => {
    const second = {
      ...flagged,
      id: 'out_2',
      shortfallPaise: '1000' as typeof flagged.shortfallPaise
    };
    expect(outsideSummary([flagged, second])).toEqual({ pending: 2, shortfallPaise: 1442n });
  });

  it('leaves classified transfers out, whichever way they went', () => {
    const gift = { ...flagged, classification: 'not_consideration_gift' as const, note: 'Diwali' };
    const paid = { ...flagged, id: 'out_3', classification: 'consideration' as const };
    expect(outsideSummary([gift, paid])).toEqual({ pending: 0, shortfallPaise: 0n });
  });

  it('is empty for no transfers', () => {
    expect(outsideSummary([])).toEqual({ pending: 0, shortfallPaise: 0n });
  });
});

describe('CLASSIFICATION_LABELS', () => {
  it('names every classification Core sends', () => {
    expect(Object.keys(CLASSIFICATION_LABELS).sort()).toEqual([
      'consideration',
      'not_consideration_gift',
      'pending'
    ]);
  });
});
