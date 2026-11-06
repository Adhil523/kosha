import {
  type Client,
  PrecheckStatusError,
  ReceiptStatusError,
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

export type Executor = (transaction: Transaction) => Promise<Executed>;

export const UNKNOWN_EXECUTION_STATUS = 'EXECUTION_ERROR';

// Executes with the client's operator as payer and waits for the receipt
export const clientExecutor =
  (client: Client): Executor =>
  async (transaction) => {
    try {
      const response = await transaction.execute(client);
      return { ok: true, data: await response.getReceipt(client) };
    } catch (error) {
      if (error instanceof ReceiptStatusError) {
        return {
          ok: false,
          data: { status: error.status.toString(), receipt: error.transactionReceipt }
        };
      }
      if (error instanceof PrecheckStatusError) {
        return { ok: false, data: { status: error.status.toString(), receipt: null } };
      }
      return { ok: false, data: { status: UNKNOWN_EXECUTION_STATUS, receipt: null } };
    }
  };
