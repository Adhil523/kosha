import { sameTransaction } from './demo-outside';
import { describe, expect, it } from 'vitest';

describe('sameTransaction', () => {
  it('matches one transaction whatever the nanosecond padding', () => {
    expect(sameTransaction('0.0.1001@1762425000.000000001', '0.0.1001@1762425000.1')).toBe(true);
    expect(sameTransaction('0.0.1001@1762425000.5', '0.0.1001@1762425000.5')).toBe(true);
  });

  it('tells apart another payer, second or nanosecond', () => {
    const id = '0.0.1001@1762425000.000000001';
    expect(sameTransaction(id, '0.0.1002@1762425000.000000001')).toBe(false);
    expect(sameTransaction(id, '0.0.1001@1762425001.000000001')).toBe(false);
    expect(sameTransaction(id, '0.0.1001@1762425000.000000002')).toBe(false);
  });
});
