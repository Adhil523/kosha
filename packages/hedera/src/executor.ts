import {
  type Client,
  PrecheckStatusError,
  type PrivateKey,
  ReceiptStatusError,
  Status,
  type Transaction
} from '@hiero-ledger/sdk';

// What the helpers read from a receipt. The SDK's TransactionReceipt satisfies it, and test fakes
// can too, so no helper needs a live network to be tested.
export type ReceiptLike = {
  topicSequenceNumber: { toString(): string } | null;
  accountId: { toString(): string } | null;
  scheduleId: { toString(): string } | null;
};

// A failed execution keeps the network status (e.g. INVALID_SIGNATURE) and, when the network
// returned one, the receipt: IDENTICAL_SCHEDULE_ALREADY_CREATED carries the existing schedule ID.
export type Executed =
  | { ok: true; data: ReceiptLike }
  | { ok: false; data: { status: string; receipt: ReceiptLike | null } };

// Extra signers sign after the operator freezes the transaction, e.g. an agent co-signing a
// scheduled release
export type Executor = (transaction: Transaction, signers?: PrivateKey[]) => Promise<Executed>;

// The network may or may not have run the transaction; callers ask the Mirror Node, never resubmit
export const UNKNOWN_EXECUTION_STATUS = 'EXECUTION_ERROR';

// Executes with the client's operator as payer and waits for the receipt
export const clientExecutor =
  (client: Client): Executor =>
  async (transaction, signers = []) => {
    try {
      if (signers.length > 0) transaction.freezeWith(client);
      for (const signer of signers) await transaction.sign(signer);
      const response = await transaction.execute(client);
      return { ok: true, data: await response.getReceipt(client) };
    } catch (error) {
      if (error instanceof ReceiptStatusError) {
        return {
          ok: false,
          data: { status: error.status.toString(), receipt: error.transactionReceipt }
        };
      }
      // The SDK resends the same transaction ID to another node when one is unreachable, so a
      // duplicate may mean the first submission reached consensus: the outcome is unknown
      if (error instanceof PrecheckStatusError && error.status !== Status.DuplicateTransaction) {
        return { ok: false, data: { status: error.status.toString(), receipt: null } };
      }
      return { ok: false, data: { status: UNKNOWN_EXECUTION_STATUS, receipt: null } };
    }
  };
