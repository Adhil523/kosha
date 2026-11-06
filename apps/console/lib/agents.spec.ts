/* eslint-disable @typescript-eslint/naming-convention -- Mirror Node fields are snake_case */
import { readTokenBalance } from '@/lib/agents';
import { describe, expect, it } from 'vitest';

const TOKEN = '0.0.429274';

describe('readTokenBalance', () => {
  it("reads the settlement token's balance from the Mirror Node answer", () => {
    const json = {
      tokens: [
        { token_id: '0.0.111', balance: 5 },
        { token_id: TOKEN, balance: 1019 }
      ]
    };
    expect(readTokenBalance(json, TOKEN)).toBe('1019');
  });

  it('reads an account without the token as 0', () => {
    expect(readTokenBalance({ tokens: [] }, TOKEN)).toBe('0');
  });

  it('gives null for an answer it cannot read', () => {
    expect(readTokenBalance({ message: 'not found' }, TOKEN)).toBeNull();
  });
});
