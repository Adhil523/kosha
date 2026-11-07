import { parseSource } from './arkiv-publish';
import { filtersFromArgs, usdcToMicro } from './arkiv-query';
import { describe, expect, it } from 'vitest';

describe('arkiv-publish parseSource', () => {
  it('lists an API at the URL its terms come from', () => {
    expect(parseSource('http://localhost:4101')).toEqual({
      termsUrl: 'http://localhost:4101',
      listedUrl: 'http://localhost:4101'
    });
  });

  it('reads terms from one URL and lists another', () => {
    expect(parseSource('http://localhost:4101=https://api.example.com')).toEqual({
      termsUrl: 'http://localhost:4101',
      listedUrl: 'https://api.example.com'
    });
  });
});

describe('arkiv-query filtersFromArgs', () => {
  it('turns flags into listing filters', () => {
    expect(
      filtersFromArgs([
        '--max-usdc',
        '0.2',
        '--level',
        '0',
        '--policy',
        'strict',
        '--rulepack',
        'in-'
      ])
    ).toEqual({
      maxPriceMicroUsdc: 200000n,
      acceptsLevel: 0,
      unverifiedPolicy: 'strict',
      rulepackPrefix: 'in-'
    });
  });

  it('applies no filter when given no flags', () => {
    expect(filtersFromArgs([])).toEqual({});
  });

  it('refuses a level Kosha does not have', () => {
    expect(() => filtersFromArgs(['--level', '3'])).toThrow();
  });

  it('refuses a price with more than six decimals', () => {
    expect(() => usdcToMicro('0.0000001')).toThrow(RangeError);
  });
});
