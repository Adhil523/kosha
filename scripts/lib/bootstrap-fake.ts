import type { BootstrapContext } from './bootstrap-context';
import type { EnvValues } from './env-file';
import type { Ran, Runner } from './hedera-run';
import {
  AccountId,
  PrivateKey,
  type Transaction,
  type TransactionReceipt
} from '@hiero-ledger/sdk';

// Test double for bootstrap steps: records each transaction and answers with scripted receipts
export type FakeContext = BootstrapContext & {
  transactions: Transaction[];
  saved: Record<string, string>;
};

type ReceiptFields = Partial<Record<'accountId' | 'tokenId' | 'topicId', string>>;

export const receipt = (fields: ReceiptFields): Ran => ({
  ok: true,
  data: Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, { toString: () => value }])
  ) as unknown as TransactionReceipt
});

export const fakeContext = (env: EnvValues, answer: (tx: Transaction) => Ran): FakeContext => {
  const transactions: Transaction[] = [];
  const saved: Record<string, string> = {};
  const run: Runner = async (transaction) => {
    transactions.push(transaction);
    return answer(transaction);
  };
  return {
    run,
    coreId: AccountId.fromString('0.0.1001'),
    coreKey: PrivateKey.generateED25519(),
    mirrorUrl: 'https://mirror.test',
    env,
    save: (updates) => {
      Object.assign(saved, updates);
      Object.assign(env, updates);
    },
    transactions,
    saved
  };
};
