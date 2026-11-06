import { accountIdSchema, hederaNetworkSchema } from '@kosha/shared/ids';
import { z } from 'zod';

// The env keys Core reads today. Later tasks add theirs (DATABASE_URL in A06, the topic and
// token IDs in A10), so Core never refuses to start for a key it doesn't use yet.
const envSchema = z.object({
  HEDERA_NETWORK: hederaNetworkSchema,
  CORE_PORT: z.coerce.number().int().min(1).max(65_535),
  CORE_ACCOUNT_ID: accountIdSchema,
  RULEPACK_PATH: z.string().min(1)
});

export type CoreConfig = {
  network: z.output<typeof hederaNetworkSchema>;
  port: number;
  coreAccountId: z.output<typeof accountIdSchema>;
  rulePackPath: string;
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

  const { HEDERA_NETWORK, CORE_PORT, CORE_ACCOUNT_ID, RULEPACK_PATH } = parsed.data;
  return {
    ok: true,
    data: {
      network: HEDERA_NETWORK,
      port: CORE_PORT,
      coreAccountId: CORE_ACCOUNT_ID,
      rulePackPath: RULEPACK_PATH
    }
  };
};
