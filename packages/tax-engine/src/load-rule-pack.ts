import in2026v1 from '../../../rulepacks/in-2026.1.json' with { type: 'json' };
import { type RulePack, rulePackSchema } from './rule-pack';

const BUILT_IN_RULE_PACKS: Readonly<Record<string, unknown>> = {
  'in-2026.1': in2026v1
};

export type LoadRulePackResult =
  | { ok: true; data: RulePack }
  | { ok: false; data: { reason: 'invalid_rule_pack'; issues: string[] } }
  | { ok: false; data: { reason: 'unknown_rule_pack'; id: string } };

// Validates a rule pack from any source (a file, Core's database, a signed download).
export const loadRulePack = (raw: unknown): LoadRulePackResult => {
  const parsed = rulePackSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return { ok: false, data: { reason: 'invalid_rule_pack', issues } };
  }
  return { ok: true, data: parsed.data };
};

// Loads a pack shipped in rulepacks/ by its id, e.g. "in-2026.1".
export const loadBuiltInRulePack = (id: string): LoadRulePackResult => {
  const raw = BUILT_IN_RULE_PACKS[id];
  if (raw === undefined) {
    return { ok: false, data: { reason: 'unknown_rule_pack', id } };
  }
  return loadRulePack(raw);
};
