import { defineConfig, devices } from '@playwright/test';

const env = process.env;
const PORT = 3100;
// Set ORIGIN to test a Console that is already running; otherwise Playwright builds and starts one
const baseURL = env.ORIGIN ?? `http://localhost:${PORT}`;

// The Console end to end, on mock mode (KOSHA_MOCK=1): sample data and a fake event stream, so the
// suite needs no Core, no database and no testnet
export default defineConfig({
  testDir: './tests',
  fullyParallel: !env.CI,
  workers: env.CI ? 1 : undefined,
  retries: env.CI ? 2 : 0,
  forbidOnly: !!env.CI,
  reporter: env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Locally, the installed Chrome; CI installs Playwright's Chromium
    ...devices['Desktop Chrome'],
    ...(env.CI ? {} : { channel: 'chrome' })
  },
  webServer: env.ORIGIN
    ? undefined
    : {
        command: `pnpm build && pnpm start -p ${PORT}`,
        url: `${baseURL}/sign-in`,
        reuseExistingServer: !env.CI,
        timeout: 180_000,
        env: { KOSHA_MOCK: '1', DEMO_AUTH: '1' }
      }
});
