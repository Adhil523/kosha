import { signedScheduleSign } from './cosign-release';
import { adminHttp, demoCore } from './lib/demo-core';
import { sendDirect } from './lib/demo-outside';
import { DEMO_STEPS, type DemoAgent, type DemoContext, type StepOutcome } from './lib/demo-steps';
import { seedEnvSchema, seedResetDemo } from './seed';
import { parsePrivateKey } from '@kosha/hedera/client';
import { createKoshaPay } from '@kosha/pay/kosha-pay';
import { type PayConfigInput } from '@kosha/pay/pay-config';
import { loadEnv } from '@kosha/shared/env';
import {
  accountIdSchema,
  agentIdentitySchema,
  tokenIdSchema,
  topicIdSchema,
  type Uaid,
  uaidSchema
} from '@kosha/shared/ids';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { createClientHederaSigner, ExactHederaScheme } from '@x402/hedera';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// `pnpm demo` (B17): resets the demo (first-rupee mode, both pairs at ₹0), then runs the spec's
// eight demo steps in order against a running Core and both demo APIs, asserting what each one
// shows on stage. A step whose feature is not merged, or was cut, prints SKIPPED (cut) and never
// fails the run. Needs Core,
// demo-api-in, demo-api-global and `pnpm seed --profiles`; every payment is real, on testnet.

const DEFAULT_DEMO_API_IN_PORT = 4101;
const DEFAULT_DEMO_API_GLOBAL_PORT = 4102;
// From the demo APIs' mock datasets
const SAMPLE_GSTIN = '29AAKCK4821M1ZQ';
const SAMPLE_CIN = 'U72200KA2016PTC094512';
const SAMPLE_LEI = '5493001KQW6DM7KEDR62';
// The stock client pays only default assets unless told otherwise: allow tUSDC, capped at 1 USDC
const MAX_MICRO_PER_PAYMENT = '1000000';
// Demo step 7's direct transfer: 0.10 tUSDC, one GST lookup's price
const OUTSIDE_MICRO = 100_000;
const HEALTH_TIMEOUT_MS = 3000;
const PORT_RANGE = { min: 1, max: 65_535 };

const port = (fallback: number) =>
  z.coerce.number().int().min(PORT_RANGE.min).max(PORT_RANGE.max).default(fallback);

export const demoEnvSchema = seedEnvSchema.extend({
  CORE_ACCOUNT_ID: accountIdSchema,
  SETTLEMENT_TOKEN_ID: tokenIdSchema,
  HCS_PAYMENTS_TOPIC: topicIdSchema,
  MAX_TX_FEE_HBAR: z.string().min(1),
  AGENT_RESIDENT_PRIVATE_KEY: z.string().min(1),
  AGENT_NONRESIDENT_PRIVATE_KEY: z.string().min(1),
  AGENT_UNKNOWN_PRIVATE_KEY: z.string().min(1),
  DEMO_API_IN_PORT: port(DEFAULT_DEMO_API_IN_PORT),
  DEMO_API_GLOBAL_PORT: port(DEFAULT_DEMO_API_GLOBAL_PORT),
  // Deployed demo APIs; the local ones otherwise
  DEMO_API_IN_URL: z.url().optional(),
  DEMO_API_GLOBAL_URL: z.url().optional(),
  // Written by `pnpm register-agents` (B23)
  AGENT_RESIDENT_UAID: uaidSchema.optional(),
  AGENT_NONRESIDENT_UAID: uaidSchema.optional()
});
export type DemoEnv = z.output<typeof demoEnvSchema>;

// Names only, never values: several of these are private keys
export const readDemoEnv = (
  env: NodeJS.ProcessEnv
): { ok: true; data: DemoEnv } | { ok: false; data: { keys: string[] } } => {
  const parsed = demoEnvSchema.safeParse(env);
  if (parsed.success) return { ok: true, data: parsed.data };
  const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  return { ok: false, data: { keys } };
};

export const demoUrls = (env: DemoEnv): DemoContext['urls'] => {
  const inBase = env.DEMO_API_IN_URL ?? `http://localhost:${env.DEMO_API_IN_PORT}`;
  const globalBase = env.DEMO_API_GLOBAL_URL ?? `http://localhost:${env.DEMO_API_GLOBAL_PORT}`;
  const gstLookup = new URL('/v1/gst-lookup', inBase);
  gstLookup.searchParams.set('gstin', SAMPLE_GSTIN);
  return {
    gstLookup: gstLookup.toString(),
    company: new URL(`/v1/company/${SAMPLE_CIN}`, inBase).toString(),
    lei: new URL(`/v1/lei/${SAMPLE_LEI}`, globalBase).toString()
  };
};

// uaid: the HCS-14 identity `pnpm register-agents` gave a Level 1 agent, sent as X-KOSHA-AGENT
type AgentKeys = { accountId: string; privateKey: string; reserveId: string; uaid?: Uaid };

export const agentKeys = (env: DemoEnv, agent: DemoAgent): AgentKeys => {
  switch (agent) {
    case 'resident':
      return {
        accountId: env.AGENT_RESIDENT_ACCOUNT_ID,
        privateKey: env.AGENT_RESIDENT_PRIVATE_KEY,
        reserveId: env.AGENT_RESIDENT_RESERVE_ID,
        uaid: env.AGENT_RESIDENT_UAID
      };
    case 'nonresident':
      return {
        accountId: env.AGENT_NONRESIDENT_ACCOUNT_ID,
        privateKey: env.AGENT_NONRESIDENT_PRIVATE_KEY,
        reserveId: env.AGENT_NONRESIDENT_RESERVE_ID,
        uaid: env.AGENT_NONRESIDENT_UAID
      };
    case 'unknown':
      return {
        accountId: env.AGENT_UNKNOWN_ACCOUNT_ID,
        privateKey: env.AGENT_UNKNOWN_PRIVATE_KEY,
        reserveId: env.AGENT_UNKNOWN_RESERVE_ID
      };
  }
};

// Each agent pays from its own account into its own reserve, trusting only this Core, with caps
// wide enough for the run and an allowlist of just the two demo APIs
export const payConfigFor = (env: DemoEnv, agent: DemoAgent, hosts: string[]): PayConfigInput => {
  const keys = agentKeys(env, agent);
  return {
    network: env.HEDERA_NETWORK,
    accountId: keys.accountId,
    privateKey: keys.privateKey,
    reserveAccountId: keys.reserveId,
    asset: env.SETTLEMENT_TOKEN_ID,
    trustedFacilitators: [env.CORE_ACCOUNT_ID],
    maxTransactionFeeHbar: env.MAX_TX_FEE_HBAR,
    ...(keys.uaid ? { agentId: keys.uaid } : {}),
    policy: { perPaymentUsdc: '1', dailyUsdc: '10', fyBudgetUsdc: '500', allowlist: hosts }
  };
};

const STATUS_LABEL = { passed: 'PASSED ', failed: 'FAILED ', skipped: 'SKIPPED' } as const;

export const formatOutcome = (label: string, title: string, outcome: StepOutcome): string =>
  `[demo]: ${label.padEnd(2)} ${STATUS_LABEL[outcome.status]} ${title}: ${outcome.detail}`;

const keyOf = (text: string, name: string) => {
  const key = parsePrivateKey(text);
  if (!key.ok) throw new Error(`the private key for ${name} is not usable`);
  return key.data;
};

export const buildContext = (env: DemoEnv, fetchImpl: typeof fetch = fetch): DemoContext => {
  const core = demoCore(adminHttp(env.CORE_URL, env.CONSOLE_ADMIN_TOKEN, fetchImpl));
  const urls = demoUrls(env);
  const hosts = [...new Set(Object.values(urls).map((url) => new URL(url).hostname))];
  const network = `hedera:${env.HEDERA_NETWORK}` as const;
  // The UAID once register-agents has run (Core then lists the agent under it), else the account
  const identityOf = (agent: DemoAgent) => {
    const keys = agentKeys(env, agent);
    return keys.uaid ?? agentIdentitySchema.parse(`hedera:${env.HEDERA_NETWORK}:${keys.accountId}`);
  };
  return {
    core,
    urls,
    identityOf,
    payFor: (agent) => createKoshaPay(payConfigFor(env, agent, hosts), { fetch: fetchImpl }),
    coreUrl: env.CORE_URL,
    issuerKey: keyOf(env.ISSUER_PRIVATE_KEY, 'the test issuer'),
    stockFetchFor: (agent) => {
      const keys = agentKeys(env, agent);
      const signer = createClientHederaSigner(keys.accountId, keyOf(keys.privateKey, agent), {
        network
      });
      return wrapFetchWithPaymentFromConfig(fetchImpl, {
        schemes: [{ network, client: new ExactHederaScheme(signer) }],
        spendControls: {
          allowedAssets: [
            { network, asset: env.SETTLEMENT_TOKEN_ID, maxAmountPerPayment: MAX_MICRO_PER_PAYMENT }
          ]
        }
      });
    },
    sendOutside: (agent) =>
      sendDirect({
        network: env.HEDERA_NETWORK,
        tokenId: env.SETTLEMENT_TOKEN_ID,
        from: agentKeys(env, agent),
        to: env.RECEIVER_IN_ACCOUNT_ID,
        micro: OUTSIDE_MICRO
      }),
    signRelease: (agent, scheduleId) => signedScheduleSign(scheduleId, agentKeys(env, agent)),
    now: () => new Date(),
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
};

// null when the service answers its health check, else what to start
const unhealthy = async (name: string, baseUrl: string, start: string): Promise<string | null> => {
  try {
    const response = await fetch(new URL('/health', baseUrl), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    if (response.ok) return null;
  } catch {
    // not reachable
  }
  return `${name} is not answering on ${baseUrl}; start it with \`${start}\``;
};

const main = async (): Promise<void> => {
  const loaded = loadEnv();
  if (!loaded.ok) throw new Error(`no pnpm workspace found above ${loaded.data.searchedFrom}`);
  const read = readDemoEnv(process.env);
  if (!read.ok)
    throw new Error(`set these env keys (pnpm bootstrap): ${read.data.keys.join(', ')}`);
  const env = read.data;
  const urls = demoUrls(env);

  const down = (
    await Promise.all([
      unhealthy('Core', env.CORE_URL, 'pnpm --filter @kosha/core dev'),
      unhealthy(
        'demo-api-in',
        new URL(urls.gstLookup).origin,
        'pnpm --filter @kosha/demo-api-in dev'
      ),
      unhealthy(
        'demo-api-global',
        new URL(urls.lei).origin,
        'pnpm --filter @kosha/demo-api-global dev'
      )
    ])
  ).filter((problem): problem is string => problem !== null);
  if (down.length > 0) throw new Error(down.join('\n'));

  console.info('[demo]: resetting the demo: first-rupee mode, pairs at ₹0 (seed --reset-demo)');
  await seedResetDemo(adminHttp(env.CORE_URL, env.CONSOLE_ADMIN_TOKEN), env);

  const context = buildContext(env);
  const outcomes: StepOutcome[] = [];
  for (const step of DEMO_STEPS) {
    console.info(`[demo]: ${step.label.padEnd(2)} ${step.title}…`);
    const outcome = await step.run(context).catch((error: unknown): StepOutcome => ({
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error)
    }));
    outcomes.push(outcome);
    console.info(formatOutcome(step.label, step.title, outcome));
  }

  const count = (status: StepOutcome['status']) =>
    outcomes.filter((outcome) => outcome.status === status).length;
  console.info(
    `[demo]: ${count('passed')} passed, ${count('skipped')} skipped (cut), ${count('failed')} failed`
  );
  if (count('failed') > 0) process.exitCode = 1;
};

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url);
};

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    console.error('[demo]: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
