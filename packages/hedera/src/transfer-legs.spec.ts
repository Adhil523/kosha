import { decodeSignedTransfer, verifyPayerSignature, verifyTransfer } from './transfer-verifier';
import {
  PAYER_KEY,
  SHAPE_INPUT,
  signedVariant,
  type Variant,
  withoutSecondSignature
} from './transfer-verifier.fixture';
import { PrivateKey, type TransferTransaction } from '@hiero-ledger/sdk';
import { accountIdSchema } from '@kosha/shared/ids';
import { describe, expect, it } from 'vitest';

const INPUT = { ...SHAPE_INPUT, expectedReserveAccount: accountIdSchema.parse('0.0.6101') };

const verifyVariant = async (variant: Variant, input = INPUT) =>
  verifyTransfer(await signedVariant(variant), input);

const transactionOf = (base64: string): TransferTransaction => {
  const decoded = decodeSignedTransfer(base64);
  if (!decoded.ok) throw new Error(decoded.data.code);
  return decoded.data.transaction;
};

describe('verifyTransfer', () => {
  it('passes the quoted transfer and names the payer', async () => {
    const verified = await verifyVariant({});
    expect(verified.ok && verified.data.payer).toBe('0.0.6001');
  });

  it("refuses a split transfer that doesn't declare the token's 6 decimals", async () => {
    for (const decimals of [null, 8]) {
      const verified = await verifyVariant({ decimals });
      expect(verified.ok ? 'ok' : verified.data.code).toBe('wrong_token');
    }
  });

  it.each<[string, Variant]>([
    [
      'transfer_count',
      {
        legs: [
          ['0.0.6001', -101020n],
          ['0.0.5001', 100000n],
          ['0.0.6101', 1019n],
          ['0.0.7777', 1n]
        ]
      }
    ],
    [
      'amount_mismatch',
      {
        legs: [
          ['0.0.6001', -101018n],
          ['0.0.5001', 99999n],
          ['0.0.6101', 1019n]
        ]
      }
    ],
    ['wrong_token', { token: '0.0.429275' }],
    [
      'multiple_debits',
      {
        legs: [
          ['0.0.6001', -100000n],
          ['0.0.6002', -1019n],
          ['0.0.5001', 100000n],
          ['0.0.6101', 1019n]
        ]
      }
    ],
    ['memo_mismatch', { memo: 'kosha:q_other' }],
    ['hbar_movement', { hbar: true }]
  ])('reports %s', async (code, variant) => {
    expect(await verifyVariant(variant)).toEqual({ ok: false, data: { code } });
  });

  it('refuses a reserve leg that is not the quoted agent’s reserve', async () => {
    const otherReserve = { ...INPUT, expectedReserveAccount: accountIdSchema.parse('0.0.6999') };
    expect(await verifyVariant({}, otherReserve)).toEqual({
      ok: false,
      data: { code: 'reserve_not_payers' }
    });
  });
});

describe('verifyPayerSignature', () => {
  it('accepts the payer’s signature on every node', async () => {
    const transaction = transactionOf(await signedVariant());
    expect(verifyPayerSignature(transaction, PAYER_KEY.publicKey)).toEqual({ ok: true });
  });

  it.each<[string, () => Promise<string>]>([
    ['unsigned', () => signedVariant({ unsigned: true })],
    ['signed by the wrong key', () => signedVariant({ key: PrivateKey.generateED25519() })],
    ['signed for only some nodes', async () => withoutSecondSignature(await signedVariant())]
  ])('refuses a transfer %s', async (_case, build) => {
    const transaction = transactionOf(await build());
    expect(verifyPayerSignature(transaction, PAYER_KEY.publicKey)).toEqual({
      ok: false,
      data: { code: 'bad_signature' }
    });
  });
});
