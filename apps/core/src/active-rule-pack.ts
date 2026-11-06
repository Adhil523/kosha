import { loadRulePack } from '@kosha/tax-engine/load-rule-pack';
import type { RulePack } from '@kosha/tax-engine/rule-pack';
import { rulePackHash } from '@kosha/tax-engine/rule-pack-hash';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export type ActiveRulePack = { pack: RulePack; hash: string };

export type ReadRulePackResult =
  | { ok: true; data: ActiveRulePack }
  | { ok: false; data: { reason: 'unreadable' | 'invalid_json'; path: string } }
  | { ok: false; data: { reason: 'invalid_rule_pack'; path: string; issues: string[] } };

// Reads the pack at RULEPACK_PATH (relative to the repo root unless absolute), validates it, and
// computes the hash Core publishes to HCS and serves on /v1/supported.
export const readRulePack = async (
  rulePackPath: string,
  repoRoot: string
): Promise<ReadRulePackResult> => {
  const path = isAbsolute(rulePackPath) ? rulePackPath : join(repoRoot, rulePackPath);

  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { ok: false, data: { reason: 'unreadable', path } };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, data: { reason: 'invalid_json', path } };
  }

  const loaded = loadRulePack(raw);
  if (!loaded.ok) {
    const issues = loaded.data.reason === 'invalid_rule_pack' ? loaded.data.issues : [];
    return { ok: false, data: { reason: 'invalid_rule_pack', path, issues } };
  }
  return { ok: true, data: { pack: loaded.data, hash: rulePackHash(loaded.data) } };
};
