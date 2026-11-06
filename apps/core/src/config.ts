import {
  accountIdSchema,
  hederaNetworkSchema,
  tokenIdSchema,
  topicIdSchema
} from '@kosha/shared/ids';
import { z } from 'zod';

const DECIMAL = /^\d+(\.\d+)?$/;
// Bootstrap generates these as 32 random bytes in hex; anything much shorter is a mistake
const MIN_SECRET_LENGTH = 32;
// Three nodes per quote, so one busy node can't block settlement (PROTOCOL §2)
export const SETTLEMENT_NODE_ACCOUNT_IDS = ['0.0.3', '0.0.4', '0.0.5'];

const secret = z.string().min(MIN_SECRET_LENGTH);

// Every env key Core needs to serve quotes, registration, verify and settle. All come from the
// shared env file; bootstrap (B03) writes the IDs and secrets.
const envSchema = z.object({
  HEDERA_NETWORK: hederaNetworkSchema,
  CORE_PORT: z.coerce.number().int().min(1).max(65_535),
  CORE_ACCOUNT_ID: accountIdSchema,
  CORE_PRIVATE_KEY: z.string().min(1),
  RULEPACK_PATH: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  MIRROR_URL: z.url(),
  SETTLEMENT_TOKEN_ID: tokenIdSchema,
  HCS_PAYMENTS_TOPIC: topicIdSchema,
  // Compatibility mode (A23): payTo of the exact entry (Core's key), and the 2-of-2 pooled TDS
  COMPAT_SETTLEMENT_ACCOUNT_ID: accountIdSchema,
  POOL_RESERVE_ACCOUNT_ID: accountIdSchema,
  MAX_TX_FEE_HBAR: z.string().regex(DECIMAL),
  FX_DEMO_INR_PER_USD: z.string().regex(DECIMAL),
  PAIR_HMAC_SECRET: secret,
  PAN_COMMIT_SECRET: secret,
  CONSOLE_ADMIN_TOKEN: secret,
  ISSUER_PRIVATE_KEY: z.string().min(1)
});

export type CoreConfig = {
  network: z.output<typeof hederaNetworkSchema>;
  port: number;
  coreAccountId: z.output<typeof accountIdSchema>;
  // Raw key text; @kosha/hedera/client parses it
  corePrivateKey: string;
  rulePackPath: string;
  databaseUrl: string;
  mirrorUrl: string;
  settlementTokenId: z.output<typeof tokenIdSchema>;
  paymentsTopicId: z.output<typeof topicIdSchema>;
  compatSettlementAccountId: z.output<typeof accountIdSchema>;
  poolReserveAccountId: z.output<typeof accountIdSchema>;
  maxTxFeeHbar: string;
  fxInrPerUsd: string;
  pairHmacSecret: string;
  panCommitSecret: string;
  adminToken: string;
  issuerPrivateKey: string;
};

export type ConfigProblem = { key: string; problem: 'missing' | 'invalid' };

export type LoadedConfig =
  { ok: true; data: CoreConfig } | { ok: false; data: { problems: ConfigProblem[] } };

// Reports every missing or invalid key at once, by name only: values may be secrets
export const loadConfig = (env: NodeJS.ProcessEnv): LoadedConfig => {
  const keys = Object.keys(envSchema.shape) as (keyof typeof envSchema.shape)[];
  const present = Object.fromEntries(
    keys.flatMap((key) => {
      const value = env[key]?.trim();
      return value ? [[key, value]] : [];
    })
  );

  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const problems = keys.flatMap((key): ConfigProblem[] => {
      if (!(key in present)) return [{ key, problem: 'missing' }];
      const invalid = parsed.error.issues.some((issue) => issue.path[0] === key);
      return invalid ? [{ key, problem: 'invalid' }] : [];
    });
    return { ok: false, data: { problems } };
  }

  const values = parsed.data;
  return {
    ok: true,
    data: {
      network: values.HEDERA_NETWORK,
      port: values.CORE_PORT,
      coreAccountId: values.CORE_ACCOUNT_ID,
      corePrivateKey: values.CORE_PRIVATE_KEY,
      rulePackPath: values.RULEPACK_PATH,
      databaseUrl: values.DATABASE_URL,
      mirrorUrl: values.MIRROR_URL,
      settlementTokenId: values.SETTLEMENT_TOKEN_ID,
      paymentsTopicId: values.HCS_PAYMENTS_TOPIC,
      compatSettlementAccountId: values.COMPAT_SETTLEMENT_ACCOUNT_ID,
      poolReserveAccountId: values.POOL_RESERVE_ACCOUNT_ID,
      maxTxFeeHbar: values.MAX_TX_FEE_HBAR,
      fxInrPerUsd: values.FX_DEMO_INR_PER_USD,
      pairHmacSecret: values.PAIR_HMAC_SECRET,
      panCommitSecret: values.PAN_COMMIT_SECRET,
      adminToken: values.CONSOLE_ADMIN_TOKEN,
      issuerPrivateKey: values.ISSUER_PRIVATE_KEY
    }
  };
};
