import { buildApp } from './app';
import { loadConfig } from './config';
import { loadEnv } from '@kosha/shared/env';

// The Indian demo API's entry point: `pnpm --filter @kosha/demo-api-in dev`
const main = (): void => {
  const env = loadEnv();
  if (!env.ok) {
    console.error(`[demo-api-in]: no pnpm workspace found above ${env.data.searchedFrom}`);
    process.exitCode = 1;
    return;
  }
  const config = loadConfig(process.env);
  if (!config.ok) {
    console.error(
      `[demo-api-in]: fix these env keys and restart: ${config.data.problems.join(', ')}`
    );
    process.exitCode = 1;
    return;
  }

  const { port, ...options } = config.data;
  buildApp(options)
    .listen(port, () => {
      console.info(`[demo-api-in]: listening on http://localhost:${port}`);
    })
    .on('error', (error) => {
      console.error('[demo-api-in]: could not start the server', error);
      process.exitCode = 1;
    });
};

main();
