import { ensureDemoAccounts } from './lib/bootstrap-accounts';
import { ensureTokenHoldings } from './lib/bootstrap-association';
import { type BootstrapContext, bootstrapLog, envSaver } from './lib/bootstrap-context';
import { ensureSettlementToken } from './lib/bootstrap-token';
import { ensureSecrets, ensureTopics } from './lib/bootstrap-topics';
import { readEnvFile } from './lib/env-file';
import { clientRunner } from './lib/hedera-run';
import { accountTable, accountTableMarkdown, TESTNET_ACCOUNTS_DOC } from './lib/testnet-accounts';
import { Hbar } from '@hiero-ledger/sdk';
import { coreClientFromEnv } from '@kosha/hedera/client';
import { findRepoRoot } from '@kosha/shared/env';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MIRROR_URL = 'https://testnet.mirrornode.hedera.com';
// Token creation costs about 15 HBAR on testnet; the SDK's default cap is too low for it
const BOOTSTRAP_MAX_FEE_HBAR = 30;

// Creates every testnet resource the demo needs and writes the IDs and keys into the shared env
// file (.env, a symlink to ../kosha.env). Idempotent: anything already in the file is skipped.
const main = async () => {
  const root = findRepoRoot(process.cwd());
  if (!root) throw new Error('run bootstrap inside the Kosha workspace');
  const envFile = readEnvFile(root);
  if (!envFile.ok) throw new Error(`no env file at ${envFile.data.path} (PROTOCOL §10)`);
  const env = envFile.data.values;
  if (env.HEDERA_NETWORK !== 'testnet') throw new Error('bootstrap runs on testnet only');

  const built = coreClientFromEnv(env);
  if (!built.ok) throw new Error(`Core operator not usable: ${built.data.reason} (step H2)`);
  const { client, operatorId, operatorKey } = built.data;
  client.setDefaultMaxTransactionFee(new Hbar(BOOTSTRAP_MAX_FEE_HBAR));

  const context: BootstrapContext = {
    run: clientRunner(client),
    coreId: operatorId,
    coreKey: operatorKey,
    mirrorUrl: env.MIRROR_URL?.trim() || DEFAULT_MIRROR_URL,
    env,
    save: envSaver(envFile.data.path, env)
  };

  bootstrapLog(`operator ${operatorId.toString()}, env file ${envFile.data.path}`);
  try {
    const tokenId = await ensureSettlementToken(context);
    const holders = await ensureDemoAccounts(context);
    await ensureTokenHoldings(context, holders, tokenId);
    await ensureTopics(context);
    ensureSecrets(context);
  } finally {
    client.close();
  }

  const rows = accountTable('testnet', env);
  for (const row of rows) bootstrapLog(`${row.role.padEnd(48)} ${row.id ?? 'not set'}`);
  writeFileSync(join(root, TESTNET_ACCOUNTS_DOC), accountTableMarkdown('testnet', rows));
  bootstrapLog(`wrote ${TESTNET_ACCOUNTS_DOC}`);
};

main().catch((error: unknown) => {
  console.error(`[bootstrap]: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
