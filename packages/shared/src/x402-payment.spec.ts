import {
  paymentPayloadSchema,
  paymentRequiredSchema,
  settlementResponseSchema
} from './x402-payment';
import { paymentRequired, splitEntry } from './x402-payment.fixture';
import { describe, expect, it } from 'vitest';

describe('payment required', () => {
  it('parses both accepts entries of the spec example', () => {
    const parsed = paymentRequiredSchema.parse(paymentRequired);
    expect(parsed.accepts.map((entry) => entry.scheme)).toEqual(['kosha-split', 'exact']);
  });

  it('rejects x402 v1, a v1 network name and a timeout over 180 s', () => {
    expect(paymentRequiredSchema.safeParse({ ...paymentRequired, x402Version: 1 }).success).toBe(
      false
    );
    const v1Network = { ...splitEntry, network: 'hedera-testnet' };
    expect(
      paymentRequiredSchema.safeParse({ ...paymentRequired, accepts: [v1Network] }).success
    ).toBe(false);
    const slow = { ...splitEntry, maxTimeoutSeconds: 181 };
    expect(paymentRequiredSchema.safeParse({ ...paymentRequired, accepts: [slow] }).success).toBe(
      false
    );
  });
});

describe('payload and settlement response', () => {
  it('parses a payment payload that echoes the accepted entry', () => {
    const payload = {
      x402Version: 2,
      accepted: splitEntry,
      payload: { transaction: 'CgQQBxgLEgQQBRgD' }
    };
    expect(paymentPayloadSchema.safeParse(payload).success).toBe(true);
    expect(
      paymentPayloadSchema.safeParse({ ...payload, payload: { transaction: 'not base64!' } })
        .success
    ).toBe(false);
  });

  it('parses a success and a failed settlement', () => {
    const success = {
      success: true,
      transaction: '0.0.4000@1762424400.123456789',
      network: 'hedera:testnet',
      payer: '0.0.6001',
      amount: '100000',
      extensions: {
        kosha: {
          hashscanUrl: 'https://hashscan.io/testnet/transaction/0.0.4000-1762424400-123456789',
          hcsSequence: null,
          tdsMicroUsdc: '1019'
        }
      }
    };
    const failure = {
      success: false,
      errorReason: 'invalid_exact_hedera_payload_amount_mismatch',
      transaction: '',
      network: 'hedera:testnet'
    };
    expect(settlementResponseSchema.safeParse(success).success).toBe(true);
    expect(settlementResponseSchema.safeParse(failure).success).toBe(true);
  });
});
