import { demoFixedFx, parseInrPerUsd } from './fx';
import { describe, expect, it } from 'vitest';

describe('parseInrPerUsd', () => {
  it.each([
    ['88.40', 88_400_000n],
    ['88.4', 88_400_000n],
    ['88', 88_000_000n],
    ['83.123456', 83_123_456n],
    [' 90.5 ', 90_500_000n]
  ])('parses %j exactly', (text, micro) => {
    expect(parseInrPerUsd(text)).toEqual({ ok: true, data: micro });
  });

  it.each(['', '0', '0.000000', '-88.4', '88.1234567', '8e1', 'eighty'])('refuses %j', (text) => {
    expect(parseInrPerUsd(text)).toEqual({ ok: false, data: { reason: 'invalid_rate' } });
  });
});

describe('demoFixedFx', () => {
  it('returns the configured rate stamped with the read time', async () => {
    const asOf = new Date('2026-11-06T10:30:00Z');
    const fx = demoFixedFx('88.40', () => asOf);
    expect(await fx?.current()).toEqual({
      inrPerUsdMicro: 88_400_000n,
      asOf,
      source: 'demo-fixed'
    });
  });

  it('refuses to build from an invalid rate', () => {
    expect(demoFixedFx('n/a')).toBeNull();
  });
});
