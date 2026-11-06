import { proto } from '@hiero-ledger/proto';
import {
  AccountId,
  Hbar,
  NftId,
  PrivateKey,
  Timestamp,
  TokenId,
  TransactionId,
  TransferTransaction
} from '@hiero-ledger/sdk';
import { type KoshaSplitRequirements, paymentRequiredSchema } from '@kosha/shared/x402-payment';
import { paymentRequired, splitEntry } from '@kosha/shared/x402-payment.fixture';

// Signed transactions for the verifier tests: the spec's quote, and one variant per way a payer
// could tamper with it.

const [entry] = paymentRequiredSchema.parse({ ...paymentRequired, accepts: [splitEntry] }).accepts;
if (entry?.scheme !== 'kosha-split') throw new Error('[verifier-fixture]: expected kosha-split');
export const QUOTE: KoshaSplitRequirements = entry;

export const PAYER_KEY = PrivateKey.generateED25519();
export const VALID_START = new Date('2026-11-06T10:30:00Z');
export const SHAPE_INPUT = {
  requirements: QUOTE,
  maxTransactionFeeHbar: '2',
  window: {
    notBefore: new Date(VALID_START.getTime() - 60_000),
    notAfter: new Date(VALID_START.getTime() + 120_000)
  }
};

const ASSET = '0.0.429274';
export const QUOTED_LEGS: [string, bigint][] = [
  ['0.0.6001', -101019n],
  ['0.0.5001', 100000n],
  ['0.0.6101', 1019n]
];

export type Variant = {
  feePayer?: string;
  memo?: string;
  nodes?: string[];
  maxFeeHbar?: string;
  validStart?: Date;
  token?: string;
  legs?: [string, bigint][];
  approvedDebit?: boolean;
  hbar?: boolean;
  nft?: boolean;
  key?: PrivateKey;
  unsigned?: boolean;
};

export const signedVariant = async (variant: Variant = {}): Promise<string> => {
  const token = TokenId.fromString(variant.token ?? ASSET);
  const transaction = new TransferTransaction()
    .setTransactionId(
      TransactionId.withValidStart(
        AccountId.fromString(variant.feePayer ?? '0.0.4000'),
        Timestamp.fromDate(variant.validStart ?? VALID_START)
      )
    )
    .setNodeAccountIds(
      (variant.nodes ?? ['0.0.3', '0.0.4', '0.0.5']).map((node) => AccountId.fromString(node))
    )
    .setTransactionMemo(variant.memo ?? 'kosha:q_7f3a')
    .setMaxTransactionFee(new Hbar(variant.maxFeeHbar ?? '2'));

  for (const [account, amount] of variant.legs ?? QUOTED_LEGS) {
    if (variant.approvedDebit && amount < 0n) {
      transaction.addApprovedTokenTransfer(token, account, amount);
    } else {
      transaction.addTokenTransfer(token, account, amount);
    }
  }
  if (variant.hbar) {
    transaction.addHbarTransfer('0.0.4000', new Hbar(-1)).addHbarTransfer('0.0.6001', new Hbar(1));
  }
  if (variant.nft) {
    transaction.addNftTransfer(
      new NftId(TokenId.fromString('0.0.9000'), 1),
      '0.0.4000',
      '0.0.6001'
    );
  }

  transaction.freeze();
  const signed = variant.unsigned ? transaction : await transaction.sign(variant.key ?? PAYER_KEY);
  return Buffer.from(signed.toBytes()).toString('base64');
};

// Rewrites the second node's body (keeping its signature map), so the bodies no longer match
export const withDivergentSecondBody = (base64: string): string => {
  const list = proto.TransactionList.decode(Buffer.from(base64, 'base64'));
  const second = list.transactionList[1];
  if (!second?.signedTransactionBytes) throw new Error('[verifier-fixture]: needs two nodes');
  const signed = proto.SignedTransaction.decode(second.signedTransactionBytes);
  const body = proto.TransactionBody.decode(signed.bodyBytes ?? new Uint8Array());
  body.memo = 'kosha:q_divergent';
  signed.bodyBytes = proto.TransactionBody.encode(body).finish();
  second.signedTransactionBytes = proto.SignedTransaction.encode(signed).finish();
  return Buffer.from(proto.TransactionList.encode(list).finish()).toString('base64');
};

// Drops the payer's signature from the second node's body only
export const withoutSecondSignature = (base64: string): string => {
  const list = proto.TransactionList.decode(Buffer.from(base64, 'base64'));
  const second = list.transactionList[1];
  if (!second?.signedTransactionBytes) throw new Error('[verifier-fixture]: needs two nodes');
  const signed = proto.SignedTransaction.decode(second.signedTransactionBytes);
  signed.sigMap = { sigPair: [] };
  second.signedTransactionBytes = proto.SignedTransaction.encode(signed).finish();
  return Buffer.from(proto.TransactionList.encode(list).finish()).toString('base64');
};
