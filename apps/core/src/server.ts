import { readRulePack } from './active-rule-pack';
import { buildApp } from './app';
import { loadConfig } from './config';
import { supportedRoutes } from './supported-routes';
import { loadEnv } from '@kosha/shared/env';

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

  const app = buildApp({
    routes: [
      supportedRoutes({
        network: config.data.network,
        feePayer: config.data.coreAccountId,
        rulePack: rulePack.data
      })
    ]
  });

  try {
    await app.listen({ port: config.data.port, host: '0.0.0.0' });
  } catch (error) {
    console.error('[core]: could not start the server', error);
    process.exitCode = 1;
  }
};

void main();
