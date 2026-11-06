import { readRulePack } from './active-rule-pack';
import { buildApp } from './app';
import { loadConfig } from './config';
import { wireCore } from './core-wiring';
import { createDb, migrateDb } from './db/client';
import { queueRulepackOnce, startOutboxLoop } from './hcs-outbox';
import { buildClient } from '@kosha/hedera/client';
import { loadEnv } from '@kosha/shared/env';

const OUTBOX_LOOP = { intervalMs: 2_000, maxIntervalMs: 60_000 };

// Kosha Core's entry point: `pnpm --filter @kosha/core dev`. Fails fast, naming every problem.
const main = async (): Promise<void> => {
  const env = loadEnv();
  if (!env.ok) {
    console.error(`[core]: no pnpm workspace found above ${env.data.searchedFrom}`);
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(process.env);
  if (!config.ok) {
    const problems = config.data.problems.map(({ key, problem }) => `${key} (${problem})`);
    console.error(`[core]: fix these env keys and restart: ${problems.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const rulePack = await readRulePack(config.data.rulePackPath, env.data.root);
  if (!rulePack.ok) {
    console.error(`[core]: rule pack ${rulePack.data.path} is ${rulePack.data.reason}`);
    process.exitCode = 1;
    return;
  }

  const operator = buildClient({
    network: config.data.network,
    operatorId: config.data.coreAccountId,
    privateKey: config.data.corePrivateKey
  });
  if (!operator.ok) {
    console.error(`[core]: CORE_PRIVATE_KEY can't be used (${operator.data.reason})`);
    process.exitCode = 1;
    return;
  }

  await migrateDb(config.data.databaseUrl);
  const database = createDb(config.data.databaseUrl);
  const wiring = wireCore(config.data, rulePack.data, database.db, {
    client: operator.data.client,
    key: operator.data.operatorKey
  });
  if (!wiring.ok) {
    console.error(`[core]: ${wiring.data.problem}`);
    process.exitCode = 1;
    await database.close();
    return;
  }

  // Every pay message's rule-pack hash prefix must resolve to a full hash on the topic
  await queueRulepackOnce(
    database.db,
    config.data.paymentsTopicId,
    rulePack.data.pack.id,
    rulePack.data.hash
  );
  const stopOutbox = startOutboxLoop(wiring.data.outbox, OUTBOX_LOOP);
  const app = buildApp({ routes: wiring.data.routes });

  const shutdown = async () => {
    stopOutbox();
    await app.close();
    await database.close();
    operator.data.client.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  try {
    await app.listen({ port: config.data.port, host: '0.0.0.0' });
  } catch (error) {
    console.error('[core]: could not start the server', error);
    process.exitCode = 1;
    await shutdown();
  }
};

void main();
