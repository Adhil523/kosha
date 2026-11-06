import { formatConsensusTime, reserveLabel } from '@/lib/payment-format';
import { describe, expect, it } from 'vitest';

describe('reserveLabel', () => {
  it('names the share reserved after the crossing', () => {
    expect(reserveLabel(100)).toBe('1% reserved');
    expect(reserveLabel(2000)).toBe('20% reserved');
    expect(reserveLabel(0)).toBe('No TDS');
  });
});

describe('formatConsensusTime', () => {
  it('shows consensus time in IST', () => {
    expect(formatConsensusTime('2026-11-06T10:21:00.000Z')).toBe('06 Nov 15:51:00');
  });
});
