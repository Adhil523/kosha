import 'server-only';
import { api, type ApiError, type ApiOptions, type ApiResponse } from '@/lib/api';
import {
  FALLBACK_RULE_PACK,
  parseRulePackStatus,
  type RulePackStatus
} from '@/lib/rule-pack-status';
import { URLS } from '@/lib/urls';
import {
  type AggregateRow,
  aggregateRowSchema,
  type LedgerPage,
  ledgerPageSchema
} from '@kosha/shared/console-api';
import { AGGREGATES_FIXTURE, LEDGER_PAGE_FIXTURE } from '@kosha/shared/fixtures';
import { z } from 'zod';

// The receiver the API-owner workspace shows. The fixtures use rcv_in; live Core uses the ID
// that seed gives receiver-in.
const DEFAULT_RECEIVER_ID = 'rcv_in';
const BAD_GATEWAY = 502;
const NOT_CONFIGURED = 503;

export const isMockMode = (): boolean => process.env.KOSHA_MOCK === '1';
export const consoleReceiverId = (): string =>
  process.env.CONSOLE_RECEIVER_ID?.trim() || DEFAULT_RECEIVER_ID;

// Server-side only: the admin token never reaches the browser.
const coreOptions = (): ApiOptions => {
  const token = process.env.CONSOLE_ADMIN_TOKEN;
  return token ? { headers: { authorization: `Bearer ${token}` } } : {};
};

type CoreResult<T> = ApiResponse<T, ApiError>;

// Every Core answer is parsed with its @kosha/shared schema; a mismatch is a 502, not bad data
const getParsed = async <T>(url: string, schema: z.ZodType<T>): Promise<CoreResult<T>> => {
  const response = await api.get<unknown>(url, coreOptions());
  if (!response.ok) return response;
  const parsed = schema.safeParse(response.data);
  if (parsed.success) return { ok: true, status: response.status, data: parsed.data };
  console.error(`[core]: ${new URL(url).pathname} broke its schema: ${parsed.error.message}`);
  return { ok: false, status: BAD_GATEWAY, data: { message: 'Core answered in an unknown shape' } };
};

const coreBase = (): string | null => process.env.CORE_URL?.trim() || null;
const notConfigured = {
  ok: false,
  status: NOT_CONFIGURED,
  data: { message: 'CORE_URL is not set' }
} as const;

export const getLedger = async (): Promise<CoreResult<LedgerPage>> => {
  if (isMockMode()) return { ok: true, status: 200, data: LEDGER_PAGE_FIXTURE };
  const base = coreBase();
  if (!base) return notConfigured;
  const query = { receiverId: consoleReceiverId(), limit: '50' };
  return getParsed(URLS.core.ledger(base, query), ledgerPageSchema);
};

export const getAggregates = async (): Promise<CoreResult<AggregateRow[]>> => {
  if (isMockMode()) return { ok: true, status: 200, data: AGGREGATES_FIXTURE };
  const base = coreBase();
  if (!base) return notConfigured;
  return getParsed(URLS.core.aggregates(base, consoleReceiverId()), z.array(aggregateRowSchema));
};

export const openCoreStream = async (
  signal: AbortSignal
): Promise<CoreResult<ReadableStream<Uint8Array>>> => {
  const base = coreBase();
  if (!base) return notConfigured;
  return api.stream(URLS.core.stream(base, consoleReceiverId()), { ...coreOptions(), signal });
};

export const getActiveRulePack = async (): Promise<RulePackStatus> => {
  const base = coreBase();
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
