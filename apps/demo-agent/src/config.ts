import { type BudgetCaps } from '@kosha/pay/agent-kit-plugin';
import { type PayConfigInput } from '@kosha/pay/pay-config';
import {
  accountIdSchema,
  hederaNetworkSchema,
  tokenIdSchema,
  topicIdSchema,
  uaidSchema
} from '@kosha/shared/ids';
import { z } from 'zod';

const DEFAULT_DEMO_API_IN_PORT = 4101;
const LLM_PROVIDERS = ['anthropic', 'openai'] as const;
const USDC_PATTERN = /^(\d+)(?:\.(\d{1,6}))?$/;
const MICRO_DIGITS = 6;

// The spec's demo prompt (Step 9), with the five companies to look up
const DEMO_GSTINS = [
  '29AAKCK4821M1ZQ',
  '27AADCS7310Q1Z4',
  '24AAECN2287F1ZK',
  '07AAHCY5521D1Z9',
  '33AAFCT9064R1Z2'
];

const usdc = z
  .string()
  .regex(USDC_PATTERN, 'expected a USDC amount with up to 6 decimals')
  .transform((text) => {
    const [whole = '0', fraction = ''] = text.split('.');
    return BigInt(whole) * 10n ** BigInt(MICRO_DIGITS) + BigInt(fraction.padEnd(MICRO_DIGITS, '0'));
  });

const envSchema = z.object({
  LLM_PROVIDER: z.enum(LLM_PROVIDERS),
  LLM_MODEL: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  HEDERA_NETWORK: hederaNetworkSchema,
  CORE_ACCOUNT_ID: accountIdSchema,
  // Signs the audit hook's HCS messages: every Kosha topic's submit key is Core's
  CORE_PRIVATE_KEY: z.string().min(1),
  HCS_AUDIT_TOPIC: topicIdSchema,
  SETTLEMENT_TOKEN_ID: tokenIdSchema,
  MAX_TX_FEE_HBAR: z.string().min(1),
  AGENT_RESIDENT_ACCOUNT_ID: accountIdSchema,
  AGENT_RESIDENT_PRIVATE_KEY: z.string().min(1),
  // The HCS-14 identity `pnpm register-agents` wrote (B23); the account identity otherwise
  AGENT_RESIDENT_UAID: uaidSchema.optional(),
  AGENT_RESIDENT_RESERVE_ID: accountIdSchema,
  DEMO_API_IN_PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_DEMO_API_IN_PORT),
  // The Agent Kit budget policy's caps, all-in (tax included)
  DEMO_AGENT_PER_PAYMENT_USDC: usdc.default(usdc.parse('1')),
  DEMO_AGENT_DAILY_USDC: usdc.default(usdc.parse('5'))
});

export type AgentEnv = z.output<typeof envSchema>;
export type LlmProvider = AgentEnv['LLM_PROVIDER'];

const PROVIDER_KEYS: Record<LlmProvider, 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY'
};

// The API key for the chosen provider; readAgentEnv has already checked it is set
export const providerApiKey = (env: AgentEnv): string => env[PROVIDER_KEYS[env.LLM_PROVIDER]] ?? '';

// Names only, never values: several of these are secrets. Empty values count as missing.
export const readAgentEnv = (
  env: NodeJS.ProcessEnv
): { ok: true; data: AgentEnv } | { ok: false; data: { keys: string[] } } => {
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== '')
  );
  const parsed = envSchema.safeParse(present);
  const keys = parsed.success
    ? []
    : [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))];
  // The chosen provider's key, checked here so it's reported alongside every other missing key
  const providerKey = PROVIDER_KEYS[present.LLM_PROVIDER as LlmProvider];
  if (providerKey && !present[providerKey]) keys.push(providerKey);
  if (parsed.success && keys.length === 0) return { ok: true, data: parsed.data };
  return { ok: false, data: { keys } };
};

export const demoApiBase = (env: AgentEnv): string => `http://localhost:${env.DEMO_API_IN_PORT}`;

// agent-resident pays from its own account into its own reserve, trusting only this Core. Pay's own
// caps sit above the kit policy's, so the policy is the one that blocks in the demo.
export const payOptions = (env: AgentEnv): PayConfigInput => ({
  network: env.HEDERA_NETWORK,
  accountId: env.AGENT_RESIDENT_ACCOUNT_ID,
  privateKey: env.AGENT_RESIDENT_PRIVATE_KEY,
  reserveAccountId: env.AGENT_RESIDENT_RESERVE_ID,
  ...(env.AGENT_RESIDENT_UAID ? { agentId: env.AGENT_RESIDENT_UAID } : {}),
  asset: env.SETTLEMENT_TOKEN_ID,
  trustedFacilitators: [env.CORE_ACCOUNT_ID],
  maxTransactionFeeHbar: env.MAX_TX_FEE_HBAR,
  policy: {
    perPaymentUsdc: '10',
    dailyUsdc: '50',
    fyBudgetUsdc: '500',
    allowlist: ['localhost']
  }
});

export const budgetCaps = (env: AgentEnv): BudgetCaps => ({
  perPaymentMicro: env.DEMO_AGENT_PER_PAYMENT_USDC,
  dailyMicro: env.DEMO_AGENT_DAILY_USDC
});

export const demoPrompt = (env: AgentEnv): string =>
  [
    'Find GST details for these 5 companies and summarise.',
    `Look each one up with kosha_paid_fetch at ${demoApiBase(env)}/v1/gst-lookup?gstin=<GSTIN>.`,
    `GSTINs: ${DEMO_GSTINS.join(', ')}.`,
    'For each company give its legal name, state and registration status, and say what you paid,',
    'including any TDS reserved.'
  ].join(' ');
