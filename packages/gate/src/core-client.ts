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
  // Core answered, but not with the shape the contract promises
  | { reason: 'invalid_response'; status: number };

export type CoreResult<T> = { ok: true; data: T } | { ok: false; data: CoreFailure };

export type CoreClientOptions = {
  // Core's base URL, e.g. https://core.kosha.dev
  core: string;
  // The receiver's API key; identifies the API owner in Core
  apiKey: string;
  timeoutMs?: number;
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
  const baseUrl = options.core.replace(/\/+$/, '');

  const post = async <T>(path: string, body: unknown, schema: z.ZodType<T>) => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json'
        },
        body: toWireJson(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      return { ok: false, data: { reason: 'core_unavailable' } } satisfies CoreResult<T>;
    }

    const { status } = response;
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
    settle: (request) => post(CORE_PATHS.settle, request, settleResponseSchema)
  };
};
