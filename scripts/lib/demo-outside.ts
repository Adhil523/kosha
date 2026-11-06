import { TransferTransaction } from '@hiero-ledger/sdk';
import { buildClient } from '@kosha/hedera/client';

// Demo step 7 (B24): a payer paying an API directly, outside Kosha. A plain token transfer from
// the agent's own account to the receiver's wallet, with a memo that is not `kosha:*`, so Core
// did not settle it and its watcher (A19) flags it.

export const OUTSIDE_MEMO = 'demo: paid directly, outside Kosha';

export type DirectTransfer = {
  network: string;
  tokenId: string;
  from: { accountId: string; privateKey: string };
  to: string;
  micro: number;
};

export type Sent = { ok: true; data: string } | { ok: false; data: string };

// The agent signs and pays the fee itself: Core is not involved at all. Returns the SDK's
// transaction ID ("0.0.1001@1762425000.000000001").
export const sendDirect = async (transfer: DirectTransfer): Promise<Sent> => {
  const built = buildClient({
    network: transfer.network,
    operatorId: transfer.from.accountId,
    privateKey: transfer.from.privateKey
  });
  if (!built.ok) return { ok: false, data: `no client for ${transfer.from.accountId}` };
  const { client } = built.data;
  try {
    const response = await new TransferTransaction()
      .addTokenTransfer(transfer.tokenId, transfer.from.accountId, -transfer.micro)
      .addTokenTransfer(transfer.tokenId, transfer.to, transfer.micro)
      .setTransactionMemo(OUTSIDE_MEMO)
      .execute(client);
    await response.getReceipt(client);
    return { ok: true, data: response.transactionId.toString() };
  } catch (error) {
    return { ok: false, data: `the direct transfer failed: ${String(error)}` };
  } finally {
    client.close();
  }
};

const parts = (transactionId: string) => {
  const [payer = '', valid = ''] = transactionId.split('@');
  const [seconds = '', nanos = '0'] = valid.split('.');
  return { payer, seconds, nanos: Number(nanos) };
};

// Core and the SDK may pad the nanoseconds differently; compare the parts, not the text
export const sameTransaction = (left: string, right: string): boolean => {
  const a = parts(left);
  const b = parts(right);
  return a.payer === b.payer && a.seconds === b.seconds && a.nanos === b.nanos;
};
