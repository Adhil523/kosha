import {
  type Client,
  PrecheckStatusError,
  type PrivateKey,
  ReceiptStatusError,
  type Transaction,
  type TransactionReceipt
} from '@hiero-ledger/sdk';

export type Ran = { ok: true; data: TransactionReceipt } | { ok: false; data: { status: string } };

// Runs a transaction with Core as operator and fee payer. Extra signers (an account's own key, or
// the other half of a 2-of-2) sign after the freeze. Bootstrap needs the token and topic IDs from
// the receipt, which @kosha/hedera's Executor deliberately doesn't expose.
export type Runner = (transaction: Transaction, signers?: PrivateKey[]) => Promise<Ran>;

export const clientRunner =
  (client: Client): Runner =>
  async (transaction, signers = []) => {
    try {
      transaction.freezeWith(client);
      for (const signer of signers) await transaction.sign(signer);
      const response = await transaction.execute(client);
      return { ok: true, data: await response.getReceipt(client) };
    } catch (error) {
      if (error instanceof ReceiptStatusError || error instanceof PrecheckStatusError) {
        return { ok: false, data: { status: error.status.toString() } };
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      return { ok: false, data: { status: `EXECUTION_ERROR: ${message}` } };
    }
  };
