import { buildApp } from './app';
import { loadConfig } from './config';
import { loadEnv } from '@kosha/shared/env';

// The foreign demo API's entry point: `pnpm --filter @kosha/demo-api-global dev`
const main = (): void => {
  const env = loadEnv();
  if (!env.ok) {
    console.error(`[demo-api-global]: no pnpm workspace found above ${env.data.searchedFrom}`);
    process.exitCode = 1;
    return;
  }
  const config = loadConfig(process.env);
  if (!config.ok) {
    console.error(
      `[demo-api-global]: fix these env keys and restart: ${config.data.problems.join(', ')}`
    );
    process.exitCode = 1;
    return;
  }

  const { port, ...options } = config.data;
  buildApp(options)
    .listen(port, () => {
      console.info(`[demo-api-global]: listening on http://localhost:${port}`);
    })
    .on('error', (error) => {
      console.error('[demo-api-global]: could not start the server', error);
      process.exitCode = 1;
    });
};

main();
