import 'server-only';
import { api, type ApiError, type ApiOptions, type ApiResponse } from '@/lib/api';
import { istMonthStart, type Overview, overviewStats } from '@/lib/overview';
import {
  FALLBACK_RULE_PACK,
  parseRulePackStatus,
  type RulePackStatus
} from '@/lib/rule-pack-status';
import { toCsv } from '@/lib/tax-report';
import { URLS } from '@/lib/urls';
import {
  type AggregateRow,
  aggregateRowSchema,
  type LedgerPage,
  ledgerPageSchema,
  type OutsidePaymentRow,
  outsidePaymentRowSchema
} from '@kosha/shared/console-api';
import { type SupportedResponse, supportedResponseSchema } from '@kosha/shared/facilitator-api';
import {
  AGENTS_FIXTURE,
  AGGREGATES_FIXTURE,
  LEDGER_PAGE_FIXTURE,
  OUTSIDE_PAYMENTS_FIXTURE,
  POLICY_FIXTURE,
  SUPPORTED_FIXTURE,
  TDS_EXPORT_FIXTURE
} from '@kosha/shared/fixtures';
import { type AgentRow, agentRowSchema, type Policy, policySchema } from '@kosha/shared/registry';
import { type OutsideClassify } from '@kosha/shared/tax-reports';
import { z } from 'zod';

// The receiver the API-owner workspace shows. The fixtures use rcv_in; live Core uses the ID
// that seed gives receiver-in.
const DEFAULT_RECEIVER_ID = 'rcv_in';
const NOT_FOUND = 404;
const CONFLICT = 409;
const BAD_GATEWAY = 502;
const NOT_CONFIGURED = 503;
const LEDGER_PAGE_LIMIT = '200';
// 10 pages of 200: a month of demo traffic; Core paginates newest first
const MAX_LEDGER_PAGES = 10;

export const isMockMode = (): boolean => process.env.KOSHA_MOCK === '1';
export const consoleReceiverId = (): string =>
  process.env.CONSOLE_RECEIVER_ID?.trim() || DEFAULT_RECEIVER_ID;

// Server-side only: the admin token never reaches the browser.
const coreOptions = (): ApiOptions => {
  const token = process.env.CONSOLE_ADMIN_TOKEN;
  return token ? { headers: { authorization: `Bearer ${token}` } } : {};
};

export type CoreResult<T> = ApiResponse<T, ApiError>;

// Every Core answer is parsed with its @kosha/shared schema; a mismatch is a 502, not bad data
export const getParsed = async <T>(url: string, schema: z.ZodType<T>): Promise<CoreResult<T>> => {
  const response = await api.get<unknown>(url, coreOptions());
  if (!response.ok) return response;
  const parsed = schema.safeParse(response.data);
  if (parsed.success) return { ok: true, status: response.status, data: parsed.data };
  console.error(`[core]: ${new URL(url).pathname} broke its schema: ${parsed.error.message}`);
  return { ok: false, status: BAD_GATEWAY, data: { message: 'Core answered in an unknown shape' } };
};

// A write: the body sent as JSON, Core's answer parsed like a read
export const sendParsed = async <T>(
  method: 'post' | 'put',
  url: string,
  body: unknown,
  schema: z.ZodType<T>
): Promise<CoreResult<T>> => {
  const response = await api[method]<unknown>(url, body, coreOptions());
  if (!response.ok) return response;
  const parsed = schema.safeParse(response.data);
  if (parsed.success) return { ok: true, status: response.status, data: parsed.data };
  console.error(`[core]: ${method.toUpperCase()} ${new URL(url).pathname} broke its schema`);
  return { ok: false, status: BAD_GATEWAY, data: { message: 'Core answered in an unknown shape' } };
};

export const coreBase = (): string | null => process.env.CORE_URL?.trim() || null;
export const notConfigured = {
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

// Payments since `from` for one receiver or one agent, newest first, following Core's cursor
const getLedgerSince = async (
  base: string,
  from: Date,
  scope: { receiverId: string } | { agentId: string }
): Promise<CoreResult<LedgerPage['rows']>> => {
  const rows: LedgerPage['rows'] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LEDGER_PAGES; page += 1) {
    const query: Record<string, string> = {
      ...scope,
      from: from.toISOString(),
      limit: LEDGER_PAGE_LIMIT,
      ...(cursor ? { cursor } : {})
    };
    const response = await getParsed(URLS.core.ledger(base, query), ledgerPageSchema);
    if (!response.ok) return response;
    rows.push(...response.data.rows);
    cursor = response.data.nextCursor;
    if (!cursor) break;
  }
  return { ok: true, status: 200, data: rows };
};

export const getOverview = async (now: Date): Promise<CoreResult<Overview>> => {
  if (isMockMode()) {
    // The fixtures are dated; measure from the newest fixture so the cards show numbers
    const rows = LEDGER_PAGE_FIXTURE.rows;
    const newest = rows[0] ? new Date(rows[0].consensusAt) : now;
    return { ok: true, status: 200, data: overviewStats(rows, newest) };
  }
  const base = coreBase();
  if (!base) return notConfigured;
  const rows = await getLedgerSince(base, istMonthStart(now), { receiverId: consoleReceiverId() });
  return rows.ok ? { ok: true, status: 200, data: overviewStats(rows.data, now) } : rows;
};

export const getAggregates = async (): Promise<CoreResult<AggregateRow[]>> => {
  if (isMockMode()) return { ok: true, status: 200, data: AGGREGATES_FIXTURE };
  const base = coreBase();
  if (!base) return notConfigured;
  return getParsed(URLS.core.aggregates(base, consoleReceiverId()), z.array(aggregateRowSchema));
};

// Every registered agent (GET /v1/agents, requested from Agent A in issue #47)
export const getAgents = async (): Promise<CoreResult<AgentRow[]>> => {
  if (isMockMode()) return { ok: true, status: 200, data: AGENTS_FIXTURE };
  const base = coreBase();
  if (!base) return notConfigured;
  return getParsed(URLS.core.agents(base), z.array(agentRowSchema));
};

// One agent's payments since `from`. Mock mode: the sample payments, measured from the newest.
export const getAgentLedger = async (
  agentId: string,
  from: Date
): Promise<CoreResult<LedgerPage['rows']>> => {
  if (isMockMode()) {
    const rows = LEDGER_PAGE_FIXTURE.rows.filter((row) => row.agentId === agentId);
    return { ok: true, status: 200, data: rows };
  }
  const base = coreBase();
  if (!base) return notConfigured;
  return getLedgerSince(base, from, { agentId });
};

// The agent's spending policy; null when none is set (Core answers 404, and there are no caps)
// Mock mode keeps edits in memory, so the editor round-trips until the server restarts
const mockPolicies = new Map<string, Policy>();

export const getPolicy = async (agentId: string): Promise<CoreResult<Policy | null>> => {
  if (isMockMode())
    return { ok: true, status: 200, data: mockPolicies.get(agentId) ?? POLICY_FIXTURE };
  const base = coreBase();
  if (!base) return notConfigured;
  const policy = await getParsed(URLS.core.agentPolicy(base, agentId), policySchema);
  if (!policy.ok && policy.status === NOT_FOUND) return { ok: true, status: 200, data: null };
  return policy;
};

// Replaces every rule of the agent's policy (PUT /v1/agents/:id/policy)
export const putPolicy = async (agentId: string, policy: Policy): Promise<CoreResult<Policy>> => {
  if (isMockMode()) {
    mockPolicies.set(agentId, policy);
    return { ok: true, status: 200, data: policy };
  }
  const base = coreBase();
  if (!base) return notConfigured;
  return sendParsed('put', URLS.core.agentPolicy(base, agentId), policy, policySchema);
};

// Mock mode keeps classifications in memory too, so the screen round-trips
const mockOutside = new Map<string, OutsidePaymentRow>(
  OUTSIDE_PAYMENTS_FIXTURE.map((row) => [row.id, row])
);

// Transfers the watcher flagged for this receiver (A19), newest first
export const getOutsidePayments = async (): Promise<CoreResult<OutsidePaymentRow[]>> => {
  if (isMockMode()) return { ok: true, status: 200, data: [...mockOutside.values()] };
  const base = coreBase();
  if (!base) return notConfigured;
  return getParsed(
    URLS.core.outsidePayments(base, consoleReceiverId()),
    z.array(outsidePaymentRowSchema)
  );
};

// The owner's call on one flagged transfer: consideration, or a gift with a note
export const classifyOutsidePayment = async (
  id: string,
  classification: OutsideClassify
): Promise<CoreResult<OutsidePaymentRow>> => {
  if (isMockMode()) {
    const row = mockOutside.get(id);
    if (!row)
      return { ok: false, status: NOT_FOUND, data: { message: `no outside payment ${id}` } };
    if (row.classification !== 'pending') {
      return {
        ok: false,
        status: CONFLICT,
        data: { message: 'this transfer is already classified' }
      };
    }
    const classified = { ...row, ...classification, note: classification.note ?? null };
    mockOutside.set(id, classified);
    return { ok: true, status: 200, data: classified };
  }
  const base = coreBase();
  if (!base) return notConfigured;
  return sendParsed(
    'post',
    URLS.core.outsideClassify(base, id),
    classification,
    outsidePaymentRowSchema
  );
};

// Core's quarterly TDS file for this receiver, as Core streams it (RFC 4180 CSV)
export const openTdsExport = async (
  quarter: string
): Promise<CoreResult<ReadableStream<Uint8Array>>> => {
  if (isMockMode()) {
    const body = new Response(toCsv(TDS_EXPORT_FIXTURE)).body;
    return body ? { ok: true, status: 200, data: body } : notConfigured;
  }
  const base = coreBase();
  if (!base) return notConfigured;
  const { headers } = coreOptions();
  return api.stream(URLS.core.tdsExport(base, consoleReceiverId(), quarter), {
    headers: { ...headers, accept: 'text/csv' }
  });
};

// The active rule pack: its ID, the hash Core publishes to HCS, and who reviewed it
export const getRulePack = async (): Promise<
  CoreResult<SupportedResponse['kosha']['rulepack']>
> => {
  if (isMockMode()) return { ok: true, status: 200, data: SUPPORTED_FIXTURE.kosha.rulepack };
  const base = coreBase();
  if (!base) return notConfigured;
  const supported = await getParsed(URLS.core.supported(base), supportedResponseSchema);
  return supported.ok ? { ...supported, data: supported.data.kosha.rulepack } : supported;
};

export const openCoreStream = async (
  signal: AbortSignal
): Promise<CoreResult<ReadableStream<Uint8Array>>> => {
  const base = coreBase();
  if (!base) return notConfigured;
  return api.stream(URLS.core.stream(base, consoleReceiverId()), { ...coreOptions(), signal });
};

export const getActiveRulePack = async (): Promise<RulePackStatus> => {
  if (isMockMode()) return FALLBACK_RULE_PACK;
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
