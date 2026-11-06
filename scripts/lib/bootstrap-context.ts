import { type EnvValues, hasValue, writeEnvValues } from './env-file';
import type { Runner } from './hedera-run';
import type { AccountId, PrivateKey } from '@hiero-ledger/sdk';

export type BootstrapContext = {
  run: Runner;
  coreId: AccountId;
  coreKey: PrivateKey;
  mirrorUrl: string;
  // The env file as bootstrap last wrote it; `save` keeps it current
  env: EnvValues;
  save: (updates: Record<string, string>) => void;
};

export const bootstrapLog = (message: string): void => console.info(`[bootstrap]: ${message}`);

// Persists right after each creation, so a crash halfway never loses a new account's key.
// Prints key names only; values may be secrets.
export const envSaver =
  (path: string, env: EnvValues) =>
  (updates: Record<string, string>): void => {
    const written = writeEnvValues(path, updates);
    if (!written.ok) {
      throw new Error(`refused to write ${written.data.key}: ${written.data.reason}`);
    }
    Object.assign(env, updates);
    bootstrapLog(`saved ${Object.keys(updates).join(', ')}`);
  };

// Each step skips work whose result is already in the env file, which makes reruns safe
export const isDone = (context: Pick<BootstrapContext, 'env'>, key: string): boolean =>
  hasValue(context.env, key);
