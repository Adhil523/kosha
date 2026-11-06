import { proto } from '@hiero-ledger/proto';
import { Hbar, Transaction, TransferTransaction } from '@hiero-ledger/sdk';
import type { ErrorCode } from '@kosha/shared/error-codes';
import type { KoshaSplitRequirements } from '@kosha/shared/x402-payment';

// The verifier protects Core, the fee payer: Core signs whatever body bytes it is handed, so every
// check runs against what Core would actually sign. It is pure; expiry, replay and the payer's
// reserve come from Core's database (A10).

export type VerifierFailure = { ok: false; data: { code: ErrorCode } };
const failure = (code: ErrorCode): VerifierFailure => ({ ok: false, data: { code } });

export type DecodedTransfer =
  | { ok: true; data: { transaction: TransferTransaction; bodies: proto.ITransactionBody[] } }
  | VerifierFailure;

const withoutNode = (body: proto.ITransactionBody): Uint8Array =>
  proto.TransactionBody.encode({ ...body, nodeAccountID: null }).finish();

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

// Decodes payload.transaction. The SDK builds its model from the first node's body only, so every
// body is decoded here and must match the first except for its node.
export const decodeSignedTransfer = (base64: string): DecodedTransfer => {
  let bodies: proto.ITransactionBody[];
  let transaction: Transaction;
  try {
    const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
    const entries = proto.TransactionList.decode(bytes).transactionList;
    if (entries.length === 0 || entries.some((entry) => !entry.signedTransactionBytes?.length)) {
      return failure('invalid_payload');
    }
    bodies = entries.map((entry) =>
      proto.TransactionBody.decode(
        proto.SignedTransaction.decode(entry.signedTransactionBytes ?? new Uint8Array())
          .bodyBytes ?? new Uint8Array()
      )
    );
    transaction = Transaction.fromBytes(bytes);
  } catch {
    return failure('invalid_payload');
  }

  const [first] = bodies;
  if (!first || bodies.some((body) => !sameBytes(withoutNode(body), withoutNode(first)))) {
    return failure('invalid_payload');
  }
  if (!(transaction instanceof TransferTransaction) || !first.cryptoTransfer) {
    return failure('not_transfer');
  }
  return { ok: true, data: { transaction, bodies } };
};

export type ShapeCheckInput = {
  requirements: KoshaSplitRequirements;
  maxTransactionFeeHbar: string;
  // The quote's lifetime; the transaction's valid start must fall inside it
  window: { notBefore: Date; notAfter: Date };
};

const sortedIds = (ids: readonly { toString(): string }[]): string =>
  ids
    .map((id) => id.toString())
    .sort()
    .join(',');

const hasApproval = (body: proto.ITransactionBody): boolean => {
  const transfer = body.cryptoTransfer;
  const hbar = transfer?.transfers?.accountAmounts ?? [];
  const tokens = (transfer?.tokenTransfers ?? []).flatMap((list) => list.transfers ?? []);
  return [...hbar, ...tokens].some((amount) => amount.isApproval === true);
};

// Everything except the token legs: who pays the fee, the memo, the nodes, the fee cap, the
// valid start, and no HBAR, NFT or allowance movement.
export const checkTransferShape = (
  { transaction, bodies }: { transaction: TransferTransaction; bodies: proto.ITransactionBody[] },
  { requirements, maxTransactionFeeHbar, window }: ShapeCheckInput
): { ok: true } | VerifierFailure => {
  const { feePayer } = requirements.extra;
  const { memo, nodeAccountIds } = requirements.extra.kosha;
  const transactionId = transaction.transactionId;

  if (transactionId?.accountId?.toString() !== feePayer) return failure('wrong_fee_payer');
  if (transaction.transactionMemo !== memo) return failure('memo_mismatch');
  const nodes = transaction.nodeAccountIds ?? [];
  if (bodies.length !== nodeAccountIds.length || sortedIds(nodes) !== sortedIds(nodeAccountIds)) {
    return failure('wrong_nodes');
  }
  const fee = transaction.maxTransactionFee;
  if (!fee || fee.toTinybars().greaterThan(new Hbar(maxTransactionFeeHbar).toTinybars())) {
    return failure('fee_too_high');
  }
  const validStart = transactionId.validStart?.toDate();
  if (!validStart || validStart < window.notBefore || validStart > window.notAfter) {
    return failure('valid_start_out_of_window');
  }
  if (transaction.hbarTransfers.size > 0) return failure('hbar_movement');
  if (transaction.nftTransfers.size > 0) return failure('nft_transfer');
  if (bodies.some(hasApproval)) return failure('approved_transfer');
  return { ok: true };
};
