import { createKoshaPay } from '@kosha/pay/kosha-pay';
import { type PayConfigInput } from '@kosha/pay/pay-config';
import { loadEnv } from '@kosha/shared/env';
import {
  accountIdSchema,
  hederaNetworkSchema,
  tokenIdSchema,
  topicIdSchema,
  uaidSchema
} from '@kosha/shared/ids';
import { hashscanAccount, hashscanTopic } from '@kosha/shared/links';
import { formatUsdc } from '@kosha/shared/money';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// `pnpm pay-once` (B12): agent-resident pays demo-api-in once through Kosha Pay, the same client
// an agent embeds, then prints the receipt and the HashScan link. Needs Core and demo-api-in
// running, and `pnpm seed --profiles`. Below the receiver's threshold the payment has one leg (the
// price); once the pair has crossed it, a second leg reserves the TDS in the agent's own reserve.

const DEFAULT_DEMO_API_IN_PORT = 4101;
// A GSTIN from the demo API's mock dataset
const SAMPLE_GSTIN = '29AAKCK4821M1ZQ';
const LOOKUP_PATH = '/v1/gst-lookup';

export const payOnceEnvSchema = z.object({
  HEDERA_NETWORK: hederaNetworkSchema,
  CORE_ACCOUNT_ID: accountIdSchema,
  SETTLEMENT_TOKEN_ID: tokenIdSchema,
  AGENT_RESIDENT_ACCOUNT_ID: accountIdSchema,
  AGENT_RESIDENT_PRIVATE_KEY: z.string().min(1),
  AGENT_RESIDENT_RESERVE_ID: accountIdSchema,
  // The HCS-14 identity `pnpm register-agents` wrote (B23); the account identity otherwise
  AGENT_RESIDENT_UAID: uaidSchema.optional(),
  HCS_PAYMENTS_TOPIC: topicIdSchema,
  MAX_TX_FEE_HBAR: z.string().min(1),
  DEMO_API_IN_PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_DEMO_API_IN_PORT),
  // A deployed demo API, e.g. https://kosha-demo-api-in.fly.dev; the local one otherwise
  DEMO_API_IN_URL: z.url().optional()
});
export type PayOnceEnv = z.output<typeof payOnceEnvSchema>;

// Names only, never values: the agent's private key is among them
export const readPayOnceEnv = (
  env: NodeJS.ProcessEnv
): { ok: true; data: PayOnceEnv } | { ok: false; data: { keys: string[] } } => {
  const parsed = payOnceEnvSchema.safeParse(env);
  if (parsed.success) return { ok: true, data: parsed.data };
  const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  return { ok: false, data: { keys } };
};

export const lookupUrl = (env: PayOnceEnv): string => {
  const url = new URL(
    LOOKUP_PATH,
    env.DEMO_API_IN_URL ?? `http://localhost:${env.DEMO_API_IN_PORT}`
  );
  url.searchParams.set('gstin', SAMPLE_GSTIN);
  return url.toString();
};

// agent-resident at Level 0: pays from its own account, reserves TDS in its own 2-of-2 reserve,
// and lets only this Core submit its transactions
export const payOnceConfig = (env: PayOnceEnv): PayConfigInput => ({
  network: env.HEDERA_NETWORK,
  accountId: env.AGENT_RESIDENT_ACCOUNT_ID,
  privateKey: env.AGENT_RESIDENT_PRIVATE_KEY,
  reserveAccountId: env.AGENT_RESIDENT_RESERVE_ID,
  asset: env.SETTLEMENT_TOKEN_ID,
  trustedFacilitators: [env.CORE_ACCOUNT_ID],
  maxTransactionFeeHbar: env.MAX_TX_FEE_HBAR,
  ...(env.AGENT_RESIDENT_UAID ? { agentId: env.AGENT_RESIDENT_UAID } : {}),
  policy: {
    perPaymentUsdc: '1',
    dailyUsdc: '10',
    fyBudgetUsdc: '500',
    // Pay only the demo API this run targets
    allowlist: [new URL(lookupUrl(env)).hostname]
  }
});

const main = async (): Promise<void> => {
  const loaded = loadEnv();
  if (!loaded.ok) throw new Error(`no pnpm workspace found above ${loaded.data.searchedFrom}`);
  const env = readPayOnceEnv(process.env);
  if (!env.ok) {
    throw new Error(`set these env keys (pnpm bootstrap): ${env.data.keys.join(', ')}`);
  }

  const pay = createKoshaPay(payOnceConfig(env.data));
  const url = lookupUrl(env.data);
  const response = await pay.fetch(url);
  if (!response.ok) {
    const reason = pay.lastError ? `${pay.lastError.reason}: ${pay.lastError.message}` : '';
    throw new Error(`${url} answered ${response.status} ${reason}`);
  }
  const receipt = pay.lastReceipt;
  if (!receipt) throw new Error('the API answered without a PAYMENT-RESPONSE receipt');

  const body: unknown = await response.json();
  const network = env.data.HEDERA_NETWORK;
  console.info(`[pay-once]: ${response.status} from ${url}`);
  console.info(`[pay-once]: response ${JSON.stringify(body)}`);
  console.info(`[pay-once]: settled ${receipt.txId}`);
  console.info(
    `[pay-once]: paid ${formatUsdc(receipt.totalMicro)} USDC in total, ` +
      `TDS reserved ${formatUsdc(receipt.tdsMicroUsdc)} USDC`
  );
  console.info(`[pay-once]: HashScan ${receipt.hashscanUrl ?? 'not returned'}`);
  console.info(
    `[pay-once]: reserve ${hashscanAccount(network, env.data.AGENT_RESIDENT_RESERVE_ID)}`
  );
  console.info(
    `[pay-once]: HCS record #${receipt.hcsSequence ?? 'pending'} on ` +
      hashscanTopic(network, env.data.HCS_PAYMENTS_TOPIC)
  );
};

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url);
};

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    console.error('[pay-once]: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
