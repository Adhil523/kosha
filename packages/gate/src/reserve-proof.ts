import { createMirrorClient, type FetchLike } from '@kosha/hedera/mirror';
import { SCHEMES } from '@kosha/shared/headers';
import { type TransactionId } from '@kosha/shared/ids';
import { toMirrorTransactionId } from '@kosha/shared/links';
import { type PaymentRequirements } from '@kosha/shared/x402-payment';

export const DEFAULT_MIRROR_URL = 'https://testnet.mirrornode.hedera.com';
// The Mirror Node trails consensus by a few seconds; past this, the proof is left unconfirmed
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 1_000;
const SUCCESS = 'SUCCESS';

export type ReserveProof =
  // Every tds_reserve leg is credited on-chain with at least the quoted amount
  | { status: 'proven' }
  // Nothing to prove: the compatibility scheme, or no TDS on this payment
  | { status: 'skipped' }
  // The Mirror Node didn't show the transaction in time; Core's word stands
  | { status: 'unconfirmed' }
  | { status: 'failed'; reason: 'reserve_short' | 'transaction_failed' | 'invalid_response' };

export type ReserveProofOptions = {
  mirrorUrl?: string;
  timeoutMs?: number;
  pollMs?: number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// What each reserve account is owed by the quote, summed per account
const reserveOwed = (requirements: PaymentRequirements): Map<string, bigint> => {
  const owed = new Map<string, bigint>();
  if (requirements.scheme !== SCHEMES.koshaSplit) return owed;
  for (const transfer of requirements.extra.kosha.transfers) {
    if (transfer.leg !== 'tds_reserve' || transfer.amount === '0') continue;
    owed.set(transfer.account, (owed.get(transfer.account) ?? 0n) + BigInt(transfer.amount));
  }
  return owed;
};

// Spec Component 2, step 3: Gate checks the chain, not Core's word, that the payer's reserve
// received the quoted TDS before the API serves the request.
export const createReserveProver = (options: ReserveProofOptions = {}) => {
  const mirror = createMirrorClient(options.mirrorUrl ?? DEFAULT_MIRROR_URL, options.fetch);
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const attempts = Math.max(1, Math.ceil((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / pollMs));
  const sleep = options.sleep ?? wait;

  return async (
    transactionId: TransactionId,
    requirements: PaymentRequirements
  ): Promise<ReserveProof> => {
    const owed = reserveOwed(requirements);
    if (owed.size === 0) return { status: 'skipped' };

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const found = await mirror.transactionById(toMirrorTransactionId(transactionId));
      if (found.ok) {
        const transaction = found.data;
        if (transaction.result !== SUCCESS)
          return { status: 'failed', reason: 'transaction_failed' };
        for (const [account, amount] of owed) {
          const credited = transaction.tokenTransfers
            .filter((move) => move.tokenId === requirements.asset && move.account === account)
            .reduce((sum, move) => (move.amount > 0n ? sum + move.amount : sum), 0n);
          if (credited < amount) return { status: 'failed', reason: 'reserve_short' };
        }
        return { status: 'proven' };
      }
      if (found.data.reason === 'invalid_response') {
        return { status: 'failed', reason: 'invalid_response' };
      }
      // not_found or an HTTP error: most likely Mirror Node lag, so try again
      if (attempt < attempts) await sleep(pollMs);
    }
    return { status: 'unconfirmed' };
  };
};

export type ReserveProver = ReturnType<typeof createReserveProver>;
