import 'server-only';
import { api, type ApiOptions } from '@/lib/api';
import {
  FALLBACK_RULE_PACK,
  parseRulePackStatus,
  type RulePackStatus
} from '@/lib/rule-pack-status';
import { URLS } from '@/lib/urls';

// Server-side only: the admin token never reaches the browser.
const coreOptions = (): ApiOptions => {
  const token = process.env.CONSOLE_ADMIN_TOKEN;
  return token ? { headers: { authorization: `Bearer ${token}` } } : {};
};

export const getActiveRulePack = async (): Promise<RulePackStatus> => {
  const base = process.env.CORE_URL;
  if (!base) {
    return FALLBACK_RULE_PACK;
  }
  const response = await api.get<unknown>(URLS.core.supported(base), coreOptions());
  if (!response.ok) {
    console.error(`[core]: GET /v1/supported failed (${response.status}); using fixture rule pack`);
    return FALLBACK_RULE_PACK;
  }
  return parseRulePackStatus(response.data) ?? FALLBACK_RULE_PACK;
};
