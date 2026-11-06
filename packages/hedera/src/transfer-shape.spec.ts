import { checkTransferShape, decodeSignedTransfer } from './transfer-verifier';
import {
  SHAPE_INPUT,
  signedVariant,
  VALID_START,
  type Variant,
  withDivergentSecondBody
} from './transfer-verifier.fixture';
import { AccountId, Hbar, TopicMessageSubmitTransaction, TransactionId } from '@hiero-ledger/sdk';
import { describe, expect, it } from 'vitest';

const shapeOf = async (variant: Variant) => {
  const decoded = decodeSignedTransfer(await signedVariant(variant));
  if (!decoded.ok) return decoded;
  return checkTransferShape(decoded.data, SHAPE_INPUT);
};

describe('decodeSignedTransfer', () => {
  it('decodes the quoted transfer with one body per node', async () => {
    const decoded = decodeSignedTransfer(await signedVariant());
    expect(decoded.ok && decoded.data.bodies.length).toBe(3);
  });

  it('refuses bytes that are not a transaction list', () => {
    expect(decodeSignedTransfer('bm90IGEgdHJhbnNhY3Rpb24=')).toEqual({
      ok: false,
      data: { code: 'invalid_payload' }
    });
  });

  it('refuses bodies that differ between nodes', async () => {
    const divergent = withDivergentSecondBody(await signedVariant());
    expect(decodeSignedTransfer(divergent)).toEqual({
      ok: false,
      data: { code: 'invalid_payload' }
    });
  });

  it('refuses a transaction that is not a transfer', async () => {
    const topicMessage = new TopicMessageSubmitTransaction()
      .setTopicId('0.0.7001')
      .setMessage('hi')
      .setTransactionId(TransactionId.generate('0.0.4000'))
      .setNodeAccountIds([AccountId.fromString('0.0.3')])
      .setMaxTransactionFee(new Hbar(1))
      .freeze();
    const base64 = Buffer.from(topicMessage.toBytes()).toString('base64');
    expect(decodeSignedTransfer(base64)).toEqual({ ok: false, data: { code: 'not_transfer' } });
  });
});

describe('checkTransferShape', () => {
  it('passes the quoted transfer', async () => {
    expect(await shapeOf({})).toEqual({ ok: true });
  });

  it.each<[string, Variant]>([
    ['wrong_fee_payer', { feePayer: '0.0.6001' }],
    ['memo_mismatch', { memo: 'kosha:q_other' }],
    ['wrong_nodes', { nodes: ['0.0.3', '0.0.4', '0.0.6'] }],
    ['wrong_nodes', { nodes: ['0.0.3'] }],
    ['fee_too_high', { maxFeeHbar: '2.00000001' }],
    ['valid_start_out_of_window', { validStart: new Date(VALID_START.getTime() + 600_000) }],
    ['hbar_movement', { hbar: true }],
    ['nft_transfer', { nft: true }],
    ['approved_transfer', { approvedDebit: true }]
  ])('reports %s', async (code, variant) => {
    expect(await shapeOf(variant)).toEqual({ ok: false, data: { code } });
  });
});
