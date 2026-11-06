import { z } from 'zod';

export type RulePackStatus = {
  id: string;
  reviewed: boolean;
  // "core": read from Core; "fixture": Core was unreachable or its answer didn't parse
  source: 'core' | 'fixture';
};

// The pack the Console assumes when Core can't be asked.
export const FALLBACK_RULE_PACK: RulePackStatus = {
  id: 'in-2026.2',
  reviewed: false,
  source: 'fixture'
};

// Only the part of GET /v1/supported the badge needs. The full shape comes from @kosha/shared (A02).
const supportedSchema = z.object({
  rulepack: z.object({ id: z.string().min(1), reviewedBy: z.string().nullable() })
});

export const parseRulePackStatus = (body: unknown): RulePackStatus | null => {
  const parsed = supportedSchema.safeParse(body);
  if (!parsed.success) {
    return null;
  }
  const { id, reviewedBy } = parsed.data.rulepack;
  return { id, reviewed: reviewedBy !== null, source: 'core' };
};
