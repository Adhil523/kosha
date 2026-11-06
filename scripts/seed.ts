import { accountIdSchema, hederaNetworkSchema } from '@kosha/shared/ids';
import type { ReceiverCreate } from '@kosha/shared/registry';
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
