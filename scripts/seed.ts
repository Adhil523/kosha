import { parsePrivateKey } from '@kosha/hedera/client';
import { issueCredential } from '@kosha/hedera/credentials';
import { loadEnv } from '@kosha/shared/env';
import { accountIdSchema, agentIdentitySchema, hederaNetworkSchema } from '@kosha/shared/ids';
import {
  type AgentRegister,
  receiverChallengeSchema,
  type ReceiverCreate
} from '@kosha/shared/registry';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// `pnpm seed --profiles`: the demo's receivers and agents (A11), registered through Core's admin
// API, so it works against either agent's Core and database. Safe to run again: a receiver whose
// wallet is already onboarded answers 409, and agent registration is an upsert.

const MIN_SECRET_LENGTH = 32;
const secret = z.string().min(MIN_SECRET_LENGTH);

export const seedEnvSchema = z.object({
  HEDERA_NETWORK: hederaNetworkSchema,
  CORE_URL: z.url(),
  CONSOLE_ADMIN_TOKEN: secret,
  ISSUER_PRIVATE_KEY: z.string().min(1),
  DEMO_API_IN_KEY: secret,
  DEMO_API_GLOBAL_KEY: secret,
  RECEIVER_IN_ACCOUNT_ID: accountIdSchema,
  RECEIVER_IN_PRIVATE_KEY: z.string().min(1),
  RECEIVER_IN_SOLO_ACCOUNT_ID: accountIdSchema,
  RECEIVER_IN_SOLO_PRIVATE_KEY: z.string().min(1),
  RECEIVER_GLOBAL_ACCOUNT_ID: accountIdSchema,
  RECEIVER_GLOBAL_PRIVATE_KEY: z.string().min(1),
  AGENT_RESIDENT_ACCOUNT_ID: accountIdSchema,
  AGENT_RESIDENT_RESERVE_ID: accountIdSchema,
  AGENT_NONRESIDENT_ACCOUNT_ID: accountIdSchema,
  AGENT_NONRESIDENT_RESERVE_ID: accountIdSchema,
  AGENT_UNKNOWN_ACCOUNT_ID: accountIdSchema,
  AGENT_UNKNOWN_RESERVE_ID: accountIdSchema
});
export type SeedEnv = z.output<typeof seedEnvSchema>;

// Names only, never values: several of these are private keys
export const readSeedEnv = (
  env: NodeJS.ProcessEnv
): { ok: true; data: SeedEnv } | { ok: false; data: { keys: string[] } } => {
  const parsed = seedEnvSchema.safeParse(env);
  if (parsed.success) return { ok: true, data: parsed.data };
  const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  return { ok: false, data: { keys } };
};

type ReceiverProfile = Omit<ReceiverCreate, 'challengeNonce' | 'wallets'> & {
  name: string;
  wallet: { accountId: string; privateKey: string };
};

// Demo identifiers only: valid in format, not real taxpayers
export const demoReceivers = (env: SeedEnv): ReceiverProfile[] => [
  {
    name: 'receiver-in',
    legalName: 'Demo Data Labs Pvt Ltd',
    residency: 'resident',
    specifiedPerson: false,
    pan: 'AAPFU0939F',
    tan: 'MUMD12345E',
    gstin: '27AAPFU0939F1ZV',
    mode: 'threshold',
    unverifiedPolicy: 'threshold_tolerant',
    apiKey: env.DEMO_API_IN_KEY,
    wallet: { accountId: env.RECEIVER_IN_ACCOUNT_ID, privateKey: env.RECEIVER_IN_PRIVATE_KEY }
  },
  {
    // A specified person: the ₹50,000 threshold, and a PAN with no TAN
    name: 'receiver-in-solo',
    legalName: 'Asha Rao (independent developer)',
    residency: 'resident',
    specifiedPerson: true,
    pan: 'ABCPR1234K',
    mode: 'threshold',
    wallet: {
      accountId: env.RECEIVER_IN_SOLO_ACCOUNT_ID,
      privateKey: env.RECEIVER_IN_SOLO_PRIVATE_KEY
    }
  },
  {
    name: 'receiver-global',
    legalName: 'Global Data Inc',
    residency: 'non_resident',
    specifiedPerson: false,
    mode: 'threshold',
    apiKey: env.DEMO_API_GLOBAL_KEY,
    wallet: {
      accountId: env.RECEIVER_GLOBAL_ACCOUNT_ID,
      privateKey: env.RECEIVER_GLOBAL_PRIVATE_KEY
    }
  }
];

type AgentProfile = {
  name: string;
  accountId: string;
  reserveAccountId: string;
  // No claims: a Level 0 agent
  claims: { residency: 'resident' | 'non_resident'; panOnFile: boolean; level: 1 } | null;
};

export const demoAgents = (env: SeedEnv): AgentProfile[] => [
  {
    name: 'agent-resident',
    accountId: env.AGENT_RESIDENT_ACCOUNT_ID,
    reserveAccountId: env.AGENT_RESIDENT_RESERVE_ID,
    claims: { residency: 'resident', panOnFile: true, level: 1 }
  },
  {
    // Verified by a Tax Residency Certificate rather than a PAN
    name: 'agent-nonresident',
    accountId: env.AGENT_NONRESIDENT_ACCOUNT_ID,
    reserveAccountId: env.AGENT_NONRESIDENT_RESERVE_ID,
    claims: { residency: 'non_resident', panOnFile: false, level: 1 }
  },
  {
    // Level 0: the demo upgrades it to Level 1 on stage
    name: 'agent-unknown',
    accountId: env.AGENT_UNKNOWN_ACCOUNT_ID,
    reserveAccountId: env.AGENT_UNKNOWN_RESERVE_ID,
    claims: null
  }
];

export type CoreHttp = (
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
) => Promise<{ status: number; body: unknown }>;

// Core's admin API, authenticated with CONSOLE_ADMIN_TOKEN
export const coreHttp =
  (baseUrl: string, adminToken: string, fetchImpl: typeof fetch = fetch): CoreHttp =>
  async (method, path, body) => {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${adminToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    try {
      return { status: response.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: response.status, body: text };
    }
  };

export type SeedOutcome = { name: string; result: 'created' | 'updated' | 'exists' };

const errorSchema = z.object({ error: z.string(), message: z.string().optional() });
const failure = (name: string, status: number, body: unknown): Error => {
  const parsed = errorSchema.safeParse(body);
  const detail = parsed.success ? `${parsed.data.error} ${parsed.data.message ?? ''}` : '';
  return new Error(`[seed]: ${name} was refused: ${status} ${detail}`.trim());
};

const keyFrom = (text: string, name: string) => {
  const key = parsePrivateKey(text);
  if (!key.ok) throw new Error(`[seed]: the private key for ${name} is not usable`);
  return key.data;
};

// Each receiver proves it owns its wallet by signing a fresh Core challenge with the wallet's key
export const seedReceivers = async (core: CoreHttp, env: SeedEnv): Promise<SeedOutcome[]> => {
  const outcomes: SeedOutcome[] = [];
  for (const { name, wallet, ...fields } of demoReceivers(env)) {
    const challenge = await core('GET', '/v1/receivers/challenge');
    if (challenge.status !== 200) throw failure(name, challenge.status, challenge.body);
    const { nonce } = receiverChallengeSchema.parse(challenge.body);
    const signature = keyFrom(wallet.privateKey, name).sign(new TextEncoder().encode(nonce));

    const response = await core('POST', '/v1/receivers', {
      ...fields,
      challengeNonce: nonce,
      wallets: [{ accountId: wallet.accountId, signature: Buffer.from(signature).toString('hex') }]
    });
    if (response.status === 201) outcomes.push({ name, result: 'created' });
    else if (response.status === 409) outcomes.push({ name, result: 'exists' });
    else throw failure(name, response.status, response.body);
  }
  return outcomes;
};

// Level 1 agents carry a credential from Core's test issuer; each uses its bootstrap reserve
export const seedAgents = async (core: CoreHttp, env: SeedEnv): Promise<SeedOutcome[]> => {
  const issuer = keyFrom(env.ISSUER_PRIVATE_KEY, 'the test issuer');
  const outcomes: SeedOutcome[] = [];
  for (const { name, accountId, reserveAccountId, claims } of demoAgents(env)) {
    const identity = agentIdentitySchema.parse(`hedera:${env.HEDERA_NETWORK}:${accountId}`);
    const body: AgentRegister = {
      identity,
      wallets: [accountIdSchema.parse(accountId)],
      reserveAccountId: accountIdSchema.parse(reserveAccountId),
      ...(claims ? { credential: issueCredential(issuer, identity, claims) } : {})
    };
    const response = await core('POST', '/v1/agents', body);
    if (response.status === 201) outcomes.push({ name, result: 'created' });
    else if (response.status === 200) outcomes.push({ name, result: 'updated' });
    else throw failure(name, response.status, response.body);
  }
  return outcomes;
};

const USAGE = 'usage: pnpm seed --profiles';

const main = async (): Promise<void> => {
  if (!process.argv.slice(2).includes('--profiles')) {
    console.error(`[seed]: ${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const loaded = loadEnv();
  if (!loaded.ok) {
    console.error(`[seed]: no pnpm workspace found above ${loaded.data.searchedFrom}`);
    process.exitCode = 1;
    return;
  }
  const env = readSeedEnv(process.env);
  if (!env.ok) {
    console.error(`[seed]: set these env keys (run pnpm bootstrap): ${env.data.keys.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const core = coreHttp(env.data.CORE_URL, env.data.CONSOLE_ADMIN_TOKEN);
  const outcomes = [
    ...(await seedReceivers(core, env.data)),
    ...(await seedAgents(core, env.data))
  ];
  for (const { name, result } of outcomes) console.info(`[seed]: ${name} ${result}`);
};

const isEntryPoint = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url);
};

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    console.error('[seed]: failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
