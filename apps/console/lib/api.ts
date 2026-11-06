// The one HTTP wrapper. Every response becomes { ok, status, data }; callers branch on `ok`.
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ApiError = { message: string };

export type ApiResponse<T, E = ApiError> =
  { ok: true; status: number; data: T } | { ok: false; status: number; data: E };

export type ApiOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  customFetch?: Fetch;
};

const DEFAULT_TIMEOUT_MS = 5_000;
// status 0: the request never got an HTTP response (network error or timeout)
const NO_RESPONSE = 0;

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const request = async <T, E>(
  method: string,
  url: string,
  body: unknown,
  { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, customFetch = fetch }: ApiOptions
): Promise<ApiResponse<T, E | ApiError>> => {
  try {
    const response = await customFetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await readBody(response);
    return response.ok
      ? { ok: true, status: response.status, data: data as T }
      : { ok: false, status: response.status, data: data as E };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed';
    return { ok: false, status: NO_RESPONSE, data: { message } };
  }
};

const withoutBody =
  (method: string) =>
  <T, E = ApiError>(url: string, options: ApiOptions = {}) =>
    request<T, E>(method, url, undefined, options);

const withBody =
  (method: string) =>
  <T, E = ApiError>(url: string, body: unknown, options: ApiOptions = {}) =>
    request<T, E>(method, url, body, options);

// Server-sent events: the body stays an open stream, so there is no timeout; the caller's signal
// ends it. Used only by the route handler that proxies Core's stream.
const stream = async (
  url: string,
  { headers = {}, customFetch = fetch, signal }: ApiOptions & { signal?: AbortSignal } = {}
): Promise<ApiResponse<ReadableStream<Uint8Array>>> => {
  try {
    const response = await customFetch(url, {
      headers: { accept: 'text/event-stream', ...headers },
      signal
    });
    if (!response.ok || !response.body) {
      const data = await readBody(response);
      const message = data && typeof data === 'object' && 'message' in data ? data.message : null;
      return {
        ok: false,
        status: response.status,
        data: { message: typeof message === 'string' ? message : 'stream unavailable' }
      };
    }
    return { ok: true, status: response.status, data: response.body };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'stream failed';
    return { ok: false, status: NO_RESPONSE, data: { message } };
  }
};

export const api = {
  get: withoutBody('GET'),
  delete: withoutBody('DELETE'),
  post: withBody('POST'),
  put: withBody('PUT'),
  patch: withBody('PATCH'),
  stream
} as const;
