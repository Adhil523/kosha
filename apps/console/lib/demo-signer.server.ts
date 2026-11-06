import 'server-only';
import { type DemoSigner } from '@/lib/demo-signer';
import { AccountId, ScheduleSignTransaction, TransactionId } from '@hiero-ledger/sdk';
import { parsePrivateKey } from '@kosha/hedera/client';

// The three settlement nodes Core quotes; a ScheduleSign may go to any of them
const NODE_ACCOUNT_IDS = ['0.0.3', '0.0.4', '0.0.5'];

export type Signed = { ok: true; data: string } | { ok: false; data: { message: string } };

// A ScheduleSignTransaction for the release's schedule, frozen with the agent as payer and signed
// by its key, as base64 bytes. Core relays it unchanged; with both keys of the 2-of-2 it runs.
export const signScheduleSign = async (scheduleId: string, signer: DemoSigner): Promise<Signed> => {
  const key = parsePrivateKey(signer.privateKey);
  if (!key.ok)
    return { ok: false, data: { message: `the key for ${signer.accountId} is not usable` } };
  const transaction = new ScheduleSignTransaction()
    .setScheduleId(scheduleId)
    .setTransactionId(TransactionId.generate(AccountId.fromString(signer.accountId)))
    .setNodeAccountIds(NODE_ACCOUNT_IDS.map((id) => AccountId.fromString(id)))
    .freeze();
  await transaction.sign(key.data);
  return { ok: true, data: Buffer.from(transaction.toBytes()).toString('base64') };
};
