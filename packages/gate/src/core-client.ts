import { type ErrorCode, errorResponseSchema } from '@kosha/shared/error-codes';
import {
  type FacilitatorRequest,
  type QuoteRequest,
  quoteResponseSchema,
  settleResponseSchema,
  type VerifyResponse,
  verifyResponseSchema
} from '@kosha/shared/facilitator-api';
import { type PaymentRequired, type SettlementResponse } from '@kosha/shared/x402-payment';
import { type z } from 'zod';

const DEFAULT_TIMEOUT_MS = 10_000;

// Settle waits on the chain, so it gets longer than quote and verify. Core's slow path is a receipt
// that never comes: the Hedera SDK asks 10 times with backoff of 0.5 s doubling to an 8 s cap (about
// 50 s), then Core asks the Mirror Node 5 times 2 s apart (about 10 s). 75 s covers both plus the
// submit. A node hanging every call can still run to the SDK's 2-minute ceiling; the client's retry
// with the same signed payment then gets Core's earlier result instead of paying twice.
const DEFAULT_SETTLE_TIMEOUT_MS = 75_000;

export const CORE_PATHS = {
  quote: '/v1/quote',
  verify: '/v1/verify',
  settle: '/v1/settle'
} as const;

export type CoreFailure =
  // Core could not be reached, timed out, or answered 5xx
  | { reason: 'core_unavailable'; status?: number }
  // Core rejected Gate's API key
  | { reason: 'unauthorized'; status: number }
  // Core refused the request and said why: a 403 with a policy_* code (the agent's spending
  // policy), or another 4xx with Core's error body (e.g. 400 invalid_payload)
  | { reason: 'refused'; status: number; error: ErrorCode; message?: string }
  // Core answered, but not with the shape the contract promises
  | { reason: 'invalid_response'; status: number };

export type PolicyCode = Extract<ErrorCode, `policy_${string}`>;

const isPolicyCode = (code: ErrorCode): code is PolicyCode => code.startsWith('policy_');

const FORBIDDEN = 403;

// A 4xx carrying Core's error body is Core's answer to the agent's request, so Gate passes it on.
// A 403 counts only with a policy code; otherwise it keeps meaning a bad API key.
const readRefusal = async (response: Response): Promise<CoreFailure | null> => {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return null;
  }
  const parsed = errorResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  if (response.status === FORBIDDEN && !isPolicyCode(parsed.data.error)) return null;
  const { error, message } = parsed.data;
  return {
    reason: 'refused',
    status: response.status,
    error,
    ...(message ? { message } : {})
  };
};

export type CoreResult<T> = { ok: true; data: T } | { ok: false; data: CoreFailure };

export type CoreClientOptions = {
  // Core's base URL, e.g. https://core.kosha.dev
  core: string;
  // The receiver's API key; identifies the API owner in Core
  apiKey: string;
  // For quote and verify
  timeoutMs?: number;
  settleTimeoutMs?: number;
  fetch?: typeof fetch;
};

export type CoreClient = {
  quote: (request: QuoteRequest) => Promise<CoreResult<PaymentRequired>>;
  verify: (request: FacilitatorRequest) => Promise<CoreResult<VerifyResponse>>;
  settle: (request: FacilitatorRequest) => Promise<CoreResult<SettlementResponse>>;
};

// Money is bigint in code but always a string on the wire
const toWireJson = (body: unknown): string =>
  JSON.stringify(body, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value
  );

// Gate → Core calls for one receiver. Every response is validated against @kosha/shared, so a
// contract drift shows up as `invalid_response` rather than a crash further down.
export const createCoreClient = (options: CoreClientOptions): CoreClient => {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const settleTimeoutMs = options.settleTimeoutMs ?? DEFAULT_SETTLE_TIMEOUT_MS;
  const baseUrl = options.core.replace(/\/+$/, '');

  const post = async <T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    waitMs: number = timeoutMs
  ) => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json'
        },
        body: toWireJson(body),
        signal: AbortSignal.timeout(waitMs)
      });
    } catch {
      return { ok: false, data: { reason: 'core_unavailable' } } satisfies CoreResult<T>;
    }

    const { status } = response;
    const refusal =
      status >= 400 && status < 500 && status !== 401 ? await readRefusal(response) : null;
    if (refusal) {
      return { ok: false, data: refusal } satisfies CoreResult<T>;
    }
    if (status === 401 || status === 403) {
      return { ok: false, data: { reason: 'unauthorized', status } } satisfies CoreResult<T>;
    }
    if (status >= 500) {
      return { ok: false, data: { reason: 'core_unavailable', status } } satisfies CoreResult<T>;
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, data: { reason: 'invalid_response', status } } satisfies CoreResult<T>;
    }
    const parsed = schema.safeParse(json);
    return parsed.success
      ? ({ ok: true, data: parsed.data } satisfies CoreResult<T>)
      : ({ ok: false, data: { reason: 'invalid_response', status } } satisfies CoreResult<T>);
  };

  return {
    quote: (request) => post(CORE_PATHS.quote, request, quoteResponseSchema),
    verify: (request) => post(CORE_PATHS.verify, request, verifyResponseSchema),
    settle: (request) => post(CORE_PATHS.settle, request, settleResponseSchema, settleTimeoutMs)
  };
};
