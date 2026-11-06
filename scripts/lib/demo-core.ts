import {
  type AggregateRow,
  aggregateRowSchema,
  ledgerPageSchema,
  type OutsidePaymentRow,
  outsidePaymentRowSchema
} from '@kosha/shared/console-api';
import { type AgentRow, agentRowSchema, type Policy, policySchema } from '@kosha/shared/registry';
import {
  type ChallanRow,
  challanRowSchema,
  type MonthlyClose,
  monthlyCloseSchema,
  type OutsideClassify,
  type ReleaseRow,
  releaseRowSchema
} from '@kosha/shared/tax-reports';
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
  outsidePayments: (receiverId: string) => Promise<CoreResult<OutsidePaymentRow[]>>;
  classifyOutside: (id: string, body: OutsideClassify) => Promise<CoreResult<OutsidePaymentRow>>;
  monthlyClose: (receiverId: string, month: string) => Promise<CoreResult<MonthlyClose>>;
  // The month's challan: recorded now, or the one already recorded (Core allows one per month)
  closeMonth: (
    receiverId: string,
    month: string,
    challanRef: string
  ) => Promise<CoreResult<ChallanRow>>;
  releases: (challanId: string) => Promise<CoreResult<ReleaseRow[]>>;
  cosignRelease: (id: string, transaction: string) => Promise<CoreResult<ReleaseRow>>;
  // The status an optional endpoint answers: 404 means the feature is not built
  probe: (path: string) => Promise<number>;
};

const NOT_FOUND = 404;
const OK = 200;
const CREATED = 201;
const CONFLICT = 409;

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
    outsidePayments: async (receiverId) => {
      const path = `/v1/outside-payments?receiverId=${encodeURIComponent(receiverId)}`;
      const response = await core('GET', path);
      if (response.status !== OK)
        return {
          ok: false,
          data: refusal('GET /v1/outside-payments', response.status, response.body)
        };
      return parse('GET /v1/outside-payments', z.array(outsidePaymentRowSchema), response.body);
    },
    classifyOutside: async (id, body) => {
      const path = `/v1/outside-payments/${encodeURIComponent(id)}/classify`;
      const response = await core('POST', path, body);
      if (response.status !== OK)
        return { ok: false, data: refusal('POST classify', response.status, response.body) };
      return parse('POST classify', outsidePaymentRowSchema, response.body);
    },
    monthlyClose: async (receiverId, month) => {
      const path = `/v1/close?receiverId=${encodeURIComponent(receiverId)}&month=${month}`;
      const response = await core('GET', path);
      if (response.status !== OK)
        return { ok: false, data: refusal('GET /v1/close', response.status, response.body) };
      return parse('GET /v1/close', monthlyCloseSchema, response.body);
    },
    closeMonth: async (receiverId, month, challanRef) => {
      const recorded = await core('POST', '/v1/challans', { receiverId, month, challanRef });
      if (recorded.status === CREATED) {
        const body = parse(
          'POST /v1/challans',
          z.object({ challan: challanRowSchema }),
          recorded.body
        );
        return body.ok ? { ok: true, data: body.data.challan } : body;
      }
      if (recorded.status !== CONFLICT)
        return { ok: false, data: refusal('POST /v1/challans', recorded.status, recorded.body) };
      const listed = await core('GET', `/v1/challans?receiverId=${encodeURIComponent(receiverId)}`);
      const rows = parse('GET /v1/challans', z.array(challanRowSchema), listed.body);
      if (!rows.ok) return rows;
      const existing = rows.data.find((row) => row.month === month);
      return existing
        ? { ok: true, data: existing }
        : { ok: false, data: `${month} is closed, but no challan is listed` };
    },
    releases: async (challanId) => {
      const response = await core('GET', `/v1/releases?challanId=${encodeURIComponent(challanId)}`);
      if (response.status !== OK)
        return { ok: false, data: refusal('GET /v1/releases', response.status, response.body) };
      return parse('GET /v1/releases', z.array(releaseRowSchema), response.body);
    },
    cosignRelease: async (id, transaction) => {
      const response = await core('POST', `/v1/releases/${encodeURIComponent(id)}/cosign`, {
        transaction
      });
      if (response.status !== OK)
        return { ok: false, data: refusal('POST cosign', response.status, response.body) };
      return parse('POST cosign', releaseRowSchema, response.body);
    },
    probe: async (path) => (await core('GET', path)).status
  };
};

const IST_OFFSET_MS = 19_800_000;

// The calendar month `now` falls in (IST), for the monthly close: "2026-11"
export const currentMonth = (now: Date): string =>
  new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);
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
