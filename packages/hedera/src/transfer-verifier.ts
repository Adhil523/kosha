import { proto } from '@hiero-ledger/proto';
import { Hbar, type PublicKey, Transaction, TransferTransaction } from '@hiero-ledger/sdk';
import type { ErrorCode } from '@kosha/shared/error-codes';
import { type AccountId, accountIdSchema } from '@kosha/shared/ids';
import { amountToBigint } from '@kosha/shared/money';
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

// The quote fields the verifier checks. Core builds them from its stored quote, never from the
// request, because the client sends paymentRequirements too. A full KoshaSplitRequirements fits.
type SplitTerms = KoshaSplitRequirements['extra']['kosha'];
export type VerifiableQuote = Pick<KoshaSplitRequirements, 'asset'> & {
  extra: Pick<KoshaSplitRequirements['extra'], 'feePayer'> & {
    kosha: Pick<SplitTerms, 'memo' | 'nodeAccountIds' | 'totalMicro' | 'transfers'>;
  };
};

export type ShapeCheckInput = {
  requirements: VerifiableQuote;
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
  return checkTransferLimits({ transaction, bodies }, { maxTransactionFeeHbar, window });
};

// What every scheme Core pays the fee for must respect: the fee cap, a valid start inside the
// quote window, and no HBAR, NFT or allowance movement
export const checkTransferLimits = (
  { transaction, bodies }: { transaction: TransferTransaction; bodies: proto.ITransactionBody[] },
  { maxTransactionFeeHbar, window }: Pick<ShapeCheckInput, 'maxTransactionFeeHbar' | 'window'>
): { ok: true } | VerifierFailure => {
  const transactionId = transaction.transactionId;
  const fee = transaction.maxTransactionFee;
  if (!fee || fee.toTinybars().greaterThan(new Hbar(maxTransactionFeeHbar).toTinybars())) {
    return failure('fee_too_high');
  }
  const validStart = transactionId?.validStart?.toDate();
  if (!validStart || validStart < window.notBefore || validStart > window.notAfter) {
    return failure('valid_start_out_of_window');
  }
  if (transaction.hbarTransfers.size > 0) return failure('hbar_movement');
  if (transaction.nftTransfers.size > 0) return failure('nft_transfer');
  if (bodies.some(hasApproval)) return failure('approved_transfer');
  return { ok: true };
};

export type LegsCheckInput = {
  requirements: Pick<VerifiableQuote, 'asset'> & {
    extra: { kosha: Pick<SplitTerms, 'totalMicro' | 'transfers'> };
  };
  // The reserve registered to the agent the quote was issued to (mode C); null if it has none
  expectedReserveAccount: AccountId | null;
};

// The token legs must be exactly the quote's: one token (the asset), one debit (the payer, for the
// total), and each quoted credit, with the TDS going to the quoted agent's own reserve.
export const checkTransferLegs = (
  transaction: TransferTransaction,
  { requirements, expectedReserveAccount }: LegsCheckInput
): { ok: true; data: { payer: AccountId } } | VerifierFailure => {
  const tokens = [...transaction.tokenTransfers];
  const [onlyToken] = tokens;
  if (tokens.length !== 1 || !onlyToken) return failure('token_count');
  const [tokenId, moves] = onlyToken;
  if (tokenId.toString() !== requirements.asset) return failure('wrong_token');

  const entries = [...moves].map(
    ([account, amount]) => [account.toString(), BigInt(amount.toString())] as const
  );
  const debits = entries.filter(([, amount]) => amount < 0n);
  const [debit] = debits;
  if (debits.length > 1) return failure('multiple_debits');
  if (!debit) return failure('amount_mismatch');

  const [payer] = debit;
  const { transfers, totalMicro } = requirements.extra.kosha;
  const expected = new Map<string, bigint>([[payer, -amountToBigint(totalMicro)]]);
  for (const leg of transfers) expected.set(leg.account, amountToBigint(leg.amount));
  if (entries.length !== expected.size) return failure('transfer_count');
  if (entries.some(([account, amount]) => expected.get(account) !== amount)) {
    return failure('amount_mismatch');
  }

  const reserveLeg = transfers.find((leg) => leg.leg === 'tds_reserve');
  if (reserveLeg && reserveLeg.account !== expectedReserveAccount) {
    return failure('reserve_not_payers');
  }
  return { ok: true, data: { payer: accountIdSchema.parse(payer) } };
};

export type VerifiedTransfer =
  { ok: true; data: { transaction: TransferTransaction; payer: AccountId } } | VerifierFailure;

// Everything except the payer's signature, which needs the payer's key from the Mirror Node, and
// the payer is only known once the legs are checked.
export const verifyTransfer = (
  base64: string,
  input: ShapeCheckInput & LegsCheckInput
): VerifiedTransfer => {
  const decoded = decodeSignedTransfer(base64);
  if (!decoded.ok) return decoded;
  const shape = checkTransferShape(decoded.data, input);
  if (!shape.ok) return shape;
  const legs = checkTransferLegs(decoded.data.transaction, input);
  if (!legs.ok) return legs;
  return { ok: true, data: { transaction: decoded.data.transaction, payer: legs.data.payer } };
};

// The payer's key must have signed the body for every node
export const verifyPayerSignature = (
  transaction: TransferTransaction,
  payerKey: PublicKey
): { ok: true } | VerifierFailure =>
  payerKey.verifyTransaction(transaction) ? { ok: true } : failure('bad_signature');
