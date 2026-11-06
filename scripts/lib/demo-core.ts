import { type AggregateRow, aggregateRowSchema, ledgerPageSchema } from '@kosha/shared/console-api';
import { type AgentRow, agentRowSchema, type Policy, policySchema } from '@kosha/shared/registry';
import { z } from 'zod';

// What the demo runner reads and sets through Core's admin API (B17): the IDs behind the
// identities, the pair's aggregate for the counter, the agent's spending policy, the TDS file,
// and whether an optional endpoint exists at all.

export type CoreResult<T> = { ok: true; data: T } | { ok: false; data: string };

export type AdminHttp = (
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown
) => Promise<{ status: number; body: unknown }>;

// Core's admin API with CONSOLE_ADMIN_TOKEN, as the seed calls it, plus PUT for the policy.
// A JSON body is parsed; anything else (the CSV export) comes back as text.
export const adminHttp =
  (baseUrl: string, adminToken: string, fetchImpl: typeof fetch = fetch): AdminHttp =>
  async (method, path, body) => {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${adminToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    try {
      return { status: response.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: response.status, body: text };
    }
  };

export type DemoCore = {
  agents: () => Promise<CoreResult<AgentRow[]>>;
  agentIdByIdentity: (identity: string) => Promise<CoreResult<string>>;
  // The receiver behind the agent's newest settled payment
  receiverIdForAgent: (agentId: string) => Promise<CoreResult<string>>;
  aggregate: (receiverId: string, agentId: string) => Promise<CoreResult<AggregateRow>>;
  getPolicy: (agentId: string) => Promise<CoreResult<Policy | null>>;
  putPolicy: (agentId: string, policy: Policy) => Promise<CoreResult<Policy>>;
  tdsExport: (receiverId: string, quarter: string) => Promise<CoreResult<string>>;
  // The status an optional endpoint answers: 404 means the feature is not built
  probe: (path: string) => Promise<number>;
};

const NOT_FOUND = 404;
const OK = 200;

const errorSchema = z.object({ error: z.string(), message: z.string().optional() });

const refusal = (what: string, status: number, body: unknown): string => {
  const parsed = errorSchema.safeParse(body);
  const detail = parsed.success ? ` ${parsed.data.error} ${parsed.data.message ?? ''}` : '';
  return `${what} answered ${status}${detail}`.trim();
};

const parse = <T>(what: string, schema: z.ZodType<T>, body: unknown): CoreResult<T> => {
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, data: `${what} answered a shape the runner does not know` };
};

export const demoCore = (core: AdminHttp): DemoCore => {
  const agents: DemoCore['agents'] = async () => {
    const response = await core('GET', '/v1/agents');
    if (response.status !== OK)
      return { ok: false, data: refusal('GET /v1/agents', response.status, response.body) };
    return parse('GET /v1/agents', z.array(agentRowSchema), response.body);
  };

  return {
    agents,
    agentIdByIdentity: async (identity) => {
      const rows = await agents();
      if (!rows.ok) return rows;
      const row = rows.data.find((agent) => agent.identity === identity);
      return row
        ? { ok: true, data: row.agentId }
        : { ok: false, data: `${identity} is not registered; run pnpm seed --profiles` };
    },
    receiverIdForAgent: async (agentId) => {
      const path = `/v1/ledger?agentId=${encodeURIComponent(agentId)}&limit=1`;
      const response = await core('GET', path);
      if (response.status !== OK)
        return { ok: false, data: refusal('GET /v1/ledger', response.status, response.body) };
      const page = parse('GET /v1/ledger', ledgerPageSchema, response.body);
      if (!page.ok) return page;
      const row = page.data.rows[0];
      return row
        ? { ok: true, data: row.receiverId }
        : { ok: false, data: 'the agent has no settled payment yet' };
    },
    aggregate: async (receiverId, agentId) => {
      const path = `/v1/aggregates?receiverId=${encodeURIComponent(receiverId)}&agentId=${encodeURIComponent(agentId)}`;
      const response = await core('GET', path);
      if (response.status !== OK)
        return { ok: false, data: refusal('GET /v1/aggregates', response.status, response.body) };
      const rows = parse('GET /v1/aggregates', z.array(aggregateRowSchema), response.body);
      if (!rows.ok) return rows;
      const row = rows.data[0];
      return row ? { ok: true, data: row } : { ok: false, data: 'no aggregate for the pair yet' };
    },
    getPolicy: async (agentId) => {
      const response = await core('GET', `/v1/agents/${encodeURIComponent(agentId)}/policy`);
      if (response.status === NOT_FOUND) return { ok: true, data: null };
      if (response.status !== OK)
        return { ok: false, data: refusal('GET policy', response.status, response.body) };
      return parse('GET policy', policySchema, response.body);
    },
    putPolicy: async (agentId, policy) => {
      const response = await core(
        'PUT',
        `/v1/agents/${encodeURIComponent(agentId)}/policy`,
        policy
      );
      if (response.status !== OK)
        return { ok: false, data: refusal('PUT policy', response.status, response.body) };
      return parse('PUT policy', policySchema, response.body);
    },
    tdsExport: async (receiverId, quarter) => {
      const path = `/v1/exports/tds?receiverId=${encodeURIComponent(receiverId)}&quarter=${quarter}`;
      const response = await core('GET', path);
      if (response.status !== OK)
        return { ok: false, data: refusal('GET /v1/exports/tds', response.status, response.body) };
      return typeof response.body === 'string'
        ? { ok: true, data: response.body }
        : { ok: false, data: 'the TDS export was not CSV text' };
    },
    probe: async (path) => (await core('GET', path)).status
  };
};

const IST_OFFSET_MS = 19_800_000;
const FY_START_MONTH = 3; // April, zero-based

// The financial-year quarter `now` falls in (IST): 2026-Q3 is October to December 2026
export const currentQuarter = (now: Date): string => {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const month = ist.getUTCMonth();
  const year = ist.getUTCFullYear();
  const sinceApril = (month - FY_START_MONTH + 12) % 12;
  const fyStart = month >= FY_START_MONTH ? year : year - 1;
  return `${fyStart}-Q${Math.floor(sinceApril / 3) + 1}`;
};
