import type { FxSource } from './fx';
import type { CreTrust, FxReport } from './fx-report';
import { z } from 'zod';

// FX from the kosha-fx Chainlink CRE workflow: the latest verified report's rate while it is fresh,
// otherwise the configured fallback (FX_DEMO_INR_PER_USD), so a quote never waits on a feed.
export const CRE_FX_SOURCES = {
  signers: 'chainlink-cre',
  simulation: 'chainlink-cre-simulation'
} as const;

const HOUR_MS = 3_600_000;
// Chainlink's INR/USD feed updates at least every 24 h; two hours of slack
const DEFAULT_MAX_AGE_HOURS = 26;
const ADDRESS = /^0x[0-9a-f]{40}$/;

export type CreFxConfig = { trust: CreTrust; maxAgeMs: number };

const envSchema = z.object({
  CRE_FX_TRUST: z.enum(['signers', 'simulation']).optional(),
  CRE_FX_SIGNERS: z.string().optional(),
  CRE_FX_MIN_SIGNATURES: z.coerce.number().int().positive().optional(),
  CRE_FX_MAX_AGE_HOURS: z.coerce.number().positive().optional()
});
const ENV_KEYS = Object.keys(envSchema.shape) as (keyof typeof envSchema.shape)[];

export type LoadedCreFxConfig =
  { ok: true; data: CreFxConfig | null } | { ok: false; data: { key: string } };

// Unset CRE_FX_TRUST means no CRE source: Core keeps the fallback rate, exactly as before
export const loadCreFxConfig = (env: NodeJS.ProcessEnv): LoadedCreFxConfig => {
  const present = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]?.trim() || undefined]));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    return { ok: false, data: { key: String(parsed.error.issues[0]?.path[0] ?? 'CRE_FX_TRUST') } };
  }
  const { CRE_FX_TRUST: mode, CRE_FX_SIGNERS, CRE_FX_MIN_SIGNATURES: min } = parsed.data;
  if (!mode) return { ok: true, data: null };
  const maxAgeMs = (parsed.data.CRE_FX_MAX_AGE_HOURS ?? DEFAULT_MAX_AGE_HOURS) * HOUR_MS;
  if (mode === 'simulation') {
    return { ok: true, data: { trust: { mode, minSignatures: min ?? 1 }, maxAgeMs } };
  }

  const signers = (CRE_FX_SIGNERS ?? '')
    .split(',')
    .map((signer) => signer.trim().toLowerCase())
    .filter(Boolean);
  if (signers.length === 0 || signers.some((signer) => !ADDRESS.test(signer))) {
    return { ok: false, data: { key: 'CRE_FX_SIGNERS' } };
  }
  // A DON of n = 3f + 1 nodes tolerates f faulty ones, so f + 1 signatures are needed
  const quorum = Math.floor((signers.length - 1) / 3) + 1;
  return {
    ok: true,
    data: { trust: { mode, signers: new Set(signers), minSignatures: min ?? quorum }, maxAgeMs }
  };
};

export type CreFx = {
  source: FxSource;
  // false for a report already applied, or older than the one in use
  accept: (report: FxReport) => boolean;
};

export const createCreFx = ({
  fallback,
  config,
  now = () => new Date()
}: {
  fallback: FxSource;
  config: CreFxConfig;
  now?: () => Date;
}): CreFx => {
  let latest: FxReport | null = null;
  const sourceName = CRE_FX_SOURCES[config.trust.mode];

  return {
    accept: (report) => {
      if (latest?.reportHash === report.reportHash) return false;
      if (latest && report.feedUpdatedAt < latest.feedUpdatedAt) return false;
      latest = report;
      return true;
    },
    source: {
      current: async () => {
        const fresh = latest && now().getTime() - latest.feedUpdatedAt.getTime() <= config.maxAgeMs;
        if (!latest || !fresh) return fallback.current();
        return {
          inrPerUsdMicro: latest.inrPerUsdMicro,
          asOf: latest.feedUpdatedAt,
          source: sourceName
        };
      }
    }
  };
};
