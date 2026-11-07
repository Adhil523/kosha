import { filtersFromChoices, formatMicroUsdc } from './directory';
import { describe, expect, it } from 'vitest';

describe('filtersFromChoices', () => {
  it('applies no filter when every choice is "any"', () => {
    expect(filtersFromChoices({ maxPrice: '', level: '', policy: '' })).toEqual({});
  });

  it('turns offered choices into listing filters', () => {
    expect(filtersFromChoices({ maxPrice: '100000', level: '0', policy: 'strict' })).toEqual({
      maxPriceMicroUsdc: 100000n,
      acceptsLevel: 0,
      unverifiedPolicy: 'strict'
    });
  });

  it('ignores a value the filters never offered', () => {
    expect(filtersFromChoices({ maxPrice: '1', level: '7', policy: 'lenient' })).toEqual({});
  });
});

describe('formatMicroUsdc', () => {
  it('shows at least two decimals', () => {
    expect(formatMicroUsdc(100000n)).toBe('0.10');
    expect(formatMicroUsdc(2000000n)).toBe('2.00');
  });

  it('keeps significant micro-units', () => {
    expect(formatMicroUsdc(101019n)).toBe('0.101019');
  });
});
