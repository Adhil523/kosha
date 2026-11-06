import { ERROR_CODES, errorResponseSchema, toX402Reason } from './error-codes';
import { describe, expect, it } from 'vitest';

describe('error codes', () => {
  it('has no duplicates', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('parses an error response and rejects an unknown code', () => {
    expect(errorResponseSchema.safeParse({ error: 'replay' }).success).toBe(true);
    expect(errorResponseSchema.safeParse({ error: 'something_else' }).success).toBe(false);
  });

  it('maps direct equivalents to the standard x402 reasons', () => {
    expect(toX402Reason('amount_mismatch')).toBe('invalid_exact_hedera_payload_amount_mismatch');
    expect(toX402Reason('unsupported_scheme')).toBe('unsupported_scheme');
  });

  it('falls back to invalid_payload for Kosha-only codes', () => {
    expect(toX402Reason('reserve_not_payers')).toBe('invalid_payload');
    expect(toX402Reason('policy_daily')).toBe('invalid_payload');
  });
});
