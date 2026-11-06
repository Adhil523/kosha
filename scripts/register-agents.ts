import { hasValue, readEnvFile, writeEnvValues } from './lib/env-file';
import { inscribeProfile } from './lib/hcs11-inscribe';
import { clientRunner } from './lib/hedera-run';
import { Hbar } from '@hiero-ledger/sdk';
import { buildClient, parsePrivateKey } from '@kosha/hedera/client';
import { credentialHash, issueCredential, issuerName } from '@kosha/hedera/credentials';
import { createProfileReader } from '@kosha/hedera/hcs11-profile';
import { createMirrorClient } from '@kosha/hedera/mirror';
import { createKoshaPay } from '@kosha/pay/kosha-pay';
import { createUaid } from '@kosha/pay/uaid';
import { loadEnv } from '@kosha/shared/env';
import {
  accountIdSchema,
  hederaNetworkSchema,
  tokenIdSchema,
  topicIdSchema,
  type Uaid
} from '@kosha/shared/ids';
import { hashscanAccount, hashscanTopic } from '@kosha/shared/links';
import { type Credential } from '@kosha/shared/registry';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// `pnpm register-agents` (B23): gives each Level 1 demo agent an HCS-14 identity. For each one it
// computes a UAID offline, inscribes an HCS-11 profile (uaid set, properties.kosha holding the
// credential issuer, the credential's hash and the declared wallet, never the PAN) on an HCS-1
// topic paid for and signed by the agent itself, points the account memo at it, waits until the
// profile resolves the way Core reads it, then registers the UAID and the credential through
// Kosha Pay's register() (a signed challenge, no admin token) and writes the UAID and topic to the
// env file. An agent whose UAID is already in the env file is skipped.

const REGISTRY = 'kosha';
// HCS-11's own field name, kept as data so the lint naming rule does not apply
const DISPLAY_NAME_KEY = 'display_name';
const PROFILE_VERSION = '1.0';
const AI_AGENT_TYPE = 1; // HCS-11: 1 = AI agent
const AUTONOMOUS = 1; // HCS-11 aiAgent.type: 1 = autonomous
const TEXT_GENERATION = 0; // HCS-11 capability 0
const MODEL = 'claude-sonnet-5-5';
const RESOLVE_TIMEOUT_MS = 180_000;
const RESOLVE_POLL_MS = 6_000;
const DEFAULT_MIRROR_URL = 'https://testnet.mirrornode.hedera.com';

const envSchema = z.object({
  HEDERA_NETWORK: hederaNetworkSchema,
  CORE_URL: z.url(),
  CORE_ACCOUNT_ID: accountIdSchema,
  SETTLEMENT_TOKEN_ID: tokenIdSchema,
  MAX_TX_FEE_HBAR: z.string().min(1),
  ISSUER_PRIVATE_KEY: z.string().min(1),
  MIRROR_URL: z.url().default(DEFAULT_MIRROR_URL),
  AGENT_RESIDENT_ACCOUNT_ID: accountIdSchema,
  AGENT_RESIDENT_PRIVATE_KEY: z.string().min(1),
  AGENT_RESIDENT_RESERVE_ID: accountIdSchema,
  AGENT_NONRESIDENT_ACCOUNT_ID: accountIdSchema,
  AGENT_NONRESIDENT_PRIVATE_KEY: z.string().min(1),
  AGENT_NONRESIDENT_RESERVE_ID: accountIdSchema
});
type Env = z.output<typeof envSchema>;

type Level1Agent = {
  name: string;
  prefix: 'AGENT_RESIDENT' | 'AGENT_NONRESIDENT';
  claims: Credential['claims'];
};

// The Level 1 demo agents; agent-unknown stays at Level 0 until the demo upgrades it
export const LEVEL1_AGENTS: Level1Agent[] = [
  {
    name: 'agent-resident',
    prefix: 'AGENT_RESIDENT',
    claims: { residency: 'resident', panOnFile: true, level: 1 }
  },
  {
    name: 'agent-nonresident',
    prefix: 'AGENT_NONRESIDENT',
    claims: { residency: 'non_resident', panOnFile: false, level: 1 }
  }
];

export const uaidFor = (
  network: string,
  agent: Pick<Level1Agent, 'name'>,
  accountId: string
): Uaid =>
  createUaid(
    {
      registry: REGISTRY,
      name: `kosha-demo-${agent.name}`,
      version: '1.0.0',
      protocol: 'hcs-10',
      nativeId: `hedera:${network}:${accountId}`,
      skills: [TEXT_GENERATION]
    },
    { uid: '0' }
  );

// The HCS-11 AI-agent profile with the Kosha properties Core verifies (A18)
export const profileFor = (
  agent: Pick<Level1Agent, 'name'>,
  uaid: Uaid,
  accountId: string,
  kosha: { credentialIssuer: string; credentialHash: string }
) => ({
  version: PROFILE_VERSION,
  type: AI_AGENT_TYPE,
  [DISPLAY_NAME_KEY]: `Kosha demo agent (${agent.name})`,
  alias: agent.name,
  bio: 'A demo payer agent for Kosha, the tax-native x402 payment gateway on Hedera testnet.',
  uaid,
  aiAgent: { type: AUTONOMOUS, capabilities: [TEXT_GENERATION], model: MODEL },
  properties: { kosha: { ...kosha, wallets: [accountId] } }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const registerOne = async (env: Env, agent: Level1Agent): Promise<Record<string, string>> => {
  const accountId = env[`${agent.prefix}_ACCOUNT_ID`];
  const privateKey = env[`${agent.prefix}_PRIVATE_KEY`];
  const reserveId = env[`${agent.prefix}_RESERVE_ID`];
  const tag = `[register-agents]: ${agent.name}`;

  const issuer = parsePrivateKey(env.ISSUER_PRIVATE_KEY);
  if (!issuer.ok) throw new Error('ISSUER_PRIVATE_KEY is not a usable key');
  const built = buildClient({ network: env.HEDERA_NETWORK, operatorId: accountId, privateKey });
  if (!built.ok) throw new Error(`${agent.name}: ${built.data.reason}`);
  const { client, operatorKey } = built.data;
  client.setDefaultMaxTransactionFee(new Hbar(Number(env.MAX_TX_FEE_HBAR)));

  const uaid = uaidFor(env.HEDERA_NETWORK, agent, accountId);
  const credential = issueCredential(issuer.data, uaid, agent.claims);
  const profile = profileFor(agent, uaid, accountId, {
    credentialIssuer: issuerName(issuer.data.publicKey),
    credentialHash: credentialHash(credential)
  });
  console.info(`${tag}: UAID ${uaid}`);

  const inscribed = await inscribeProfile(
    clientRunner(client),
    { accountId, key: operatorKey },
    profile
  );
  client.close();
  if (!inscribed.ok) {
    throw new Error(
      `${agent.name}: inscription failed at ${inscribed.data.step}: ${inscribed.data.status}`
    );
  }
  const { topicId, chunks } = inscribed.data;
  console.info(
    `${tag}: profile on ${hashscanTopic(env.HEDERA_NETWORK, topicIdSchema.parse(topicId))} (${chunks} chunk${chunks === 1 ? '' : 's'})`
  );
  console.info(`${tag}: memo set on ${hashscanAccount(env.HEDERA_NETWORK, accountId)}`);

  // Core reads the profile exactly this way, so wait until that read works
  const reader = createProfileReader({
    mirror: createMirrorClient(env.MIRROR_URL),
    network: env.HEDERA_NETWORK
  });
  const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
  let resolved = false;
  while (Date.now() < deadline) {
    const read = await reader.profileForUaid(uaid);
    if (read.ok && read.data.uaid === uaid && read.data.kosha) {
      resolved = true;
      break;
    }
    console.info(
      `${tag}: profile not readable yet (${read.ok ? 'incomplete' : read.data.reason}); waiting`
    );
    await sleep(RESOLVE_POLL_MS);
  }
  if (!resolved) {
    throw new Error(
      `${agent.name}: the profile on topic ${topicId} did not resolve within ${RESOLVE_TIMEOUT_MS / 1000} s; rerun once the CDN serves it`
    );
  }
  console.info(`${tag}: profile resolves through the Mirror Node and the inscription CDN`);

  const pay = createKoshaPay({
    network: env.HEDERA_NETWORK,
    accountId,
    privateKey,
    reserveAccountId: reserveId,
    asset: env.SETTLEMENT_TOKEN_ID,
    trustedFacilitators: [env.CORE_ACCOUNT_ID],
    maxTransactionFeeHbar: env.MAX_TX_FEE_HBAR,
    agentId: uaid,
    policy: { perPaymentUsdc: '1', dailyUsdc: '10', fyBudgetUsdc: '500', allowlist: ['localhost'] }
  });
  const registered = await pay.register({ coreUrl: env.CORE_URL, credential });
  if (!registered.ok) {
    throw new Error(
      `${agent.name}: Core ${registered.data.reason} (${registered.data.status}): ${registered.data.message}`
    );
  }
  console.info(
    `${tag}: Core ${registered.data.status} the agent at Level ${registered.data.agent.level}`
  );

  return { [`${agent.prefix}_UAID`]: uaid, [`${agent.prefix}_PROFILE_TOPIC`]: topicId };
};

const main = async (): Promise<void> => {
  const loaded = loadEnv();
  if (!loaded.ok) throw new Error(`no pnpm workspace found above ${loaded.data.searchedFrom}`);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`set these env keys (pnpm bootstrap): ${keys.join(', ')}`);
  }
  const env = parsed.data;
  const envFile = readEnvFile(loaded.data.root);
  if (!envFile.ok) throw new Error(`no env file at ${envFile.data.path}`);

  for (const agent of LEVEL1_AGENTS) {
    if (hasValue(envFile.data.values, `${agent.prefix}_UAID`)) {
      console.info(
        `[register-agents]: ${agent.name}: already has a UAID in the env file; skipping`
      );
      continue;
    }
    const written = writeEnvValues(envFile.data.path, await registerOne(env, agent));
    if (!written.ok) throw new Error(`could not write ${written.data.key}: ${written.data.reason}`);
    console.info(
      `[register-agents]: wrote ${[...written.data.updated, ...written.data.appended].join(', ')}`
    );
  }
};

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url);
};

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    console.error('[register-agents]: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
