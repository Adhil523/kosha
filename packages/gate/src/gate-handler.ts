import {
  type CoreClientOptions,
  type CoreFailure,
  type CoreResult,
  createCoreClient
} from './core-client';
import { buildTerms, TERMS_PATH, type TermsOptions } from './kosha-terms';
import { createReserveProver, type ReserveProofOptions } from './reserve-proof';
import { compileRoutes, type MatchedRoute, type Routes } from './route-match';
import { type ErrorCode, errorCodeSchema } from '@kosha/shared/error-codes';
import { type FacilitatorRequest, type QuoteRequest } from '@kosha/shared/facilitator-api';
import {
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  decodeHeader,
  encodeHeader,
  HEADERS,
  SCHEMES,
  X402_NETWORKS,
  X402_VERSION
} from '@kosha/shared/headers';
import { type AccountId, type AgentIdentity, agentIdentitySchema } from '@kosha/shared/ids';
import { bigintToAmount } from '@kosha/shared/money';
import {
  type PaymentPayload,
  paymentPayloadSchema,
  type PaymentRequired,
  type SettlementResponse
} from '@kosha/shared/x402-payment';

const STATUS = {
  ok: 200,
  noContent: 204,
  paymentRequired: 402,
  unavailable: 503
} as const;
type X402Network = (typeof X402_NETWORKS)[keyof typeof X402_NETWORKS];

export type GateHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

// A framework-neutral request: adapters (Express, Hono) build one of these
export type GateRequest = {
  method: string;
  // The absolute URL of the resource, e.g. https://api.demo-in.dev/v1/gst-lookup?gstin=…
  url: string;
  headers: GateHeaders;
};

// What the API's own handler sees once a payment has settled
export type KoshaContext = {
  route: string;
  // X-KOSHA-AGENT, when the caller sent a valid one
  agentId: AgentIdentity | null;
  payer: AccountId | null;
  txId: SettlementResponse['transaction'];
  hashscanUrl: string | null;
  tdsMicroUsdc: bigint;
  hcsSequence: number | null;
  // The Mirror Node check of the reserve leg: proven on-chain, nothing to prove, Mirror Node too
  // slow to answer (Core's word stands), or turned off
  reserveProof: 'proven' | 'skipped' | 'unconfirmed' | 'off';
};

export type GateResult =
  // Not a priced route: let the request through untouched
  | { action: 'next' }
  // Answer now: a 402 quote, a failed payment, a preflight or Core being down
  | { action: 'respond'; status: number; headers: Record<string, string>; body: unknown }
  // Paid and settled: run the API's handler with these response headers added
  | { action: 'pass'; headers: Record<string, string>; kosha: KoshaContext }
  // Paid and verified, settlement deferred: run the API's handler, then settle on a 2xx
  | { action: 'verified'; settle: () => Promise<SettledResult> };

// What a deferred settlement resolves to: settled, or a failure to answer with instead
export type SettledResult = Extract<GateResult, { action: 'pass' | 'respond' }>;

export type HandleOptions = {
  // Verify now but settle later (settleMode "after"): the result is `verified`, not `pass`
  deferSettle?: boolean;
};

export type GateOptions = CoreClientOptions & {
  routes: Routes;
  // The network named in a failed PAYMENT-RESPONSE when the payload can't be read
  network?: X402Network;
  // When set, Gate answers GET /.well-known/kosha with these terms and the route prices
  terms?: TermsOptions;
  // Check the reserve leg on the Mirror Node after settling (default on). `false` skips it, as
  // the burst script does, to avoid the Mirror Node's few seconds of lag.
  onChainProof?: boolean | ReserveProofOptions;
};

const EXPOSE_HEADERS = { 'access-control-expose-headers': CORS_EXPOSED_HEADERS.join(', ') };

const readHeader = (headers: GateHeaders, name: string): string | undefined => {
  const value = headers[name.toLowerCase()];
  return typeof value === 'string' ? value : value?.[0];
};

const pathOf = (url: string): string => new URL(url, 'http://gate.invalid').pathname;

type Responded = Extract<GateResult, { action: 'respond' }>;

// Asks Core for a fresh quote on the same route, for the same agent
type Requote = () => Promise<CoreResult<PaymentRequired>>;

const failure = (
  code: ErrorCode,
  network: X402Network,
  settlement?: SettlementResponse,
  message?: string
): Responded => {
  const response: SettlementResponse = settlement ?? {
    success: false,
    errorReason: code,
    transaction: '',
    network
  };
  return {
    action: 'respond',
    status: STATUS.paymentRequired,
    headers: { ...EXPOSE_HEADERS, [HEADERS.paymentResponse]: encodeHeader(response) },
    body: { x402Version: X402_VERSION, error: code, ...(message ? { message } : {}) }
  };
};

// A stock x402 v2 client reads terms only from PAYMENT-REQUIRED, so a failure the payer can fix by
// signing again carries a fresh quote. None after settlement_pending or replay: the first payment
// may still land or already has, and a fresh quote invites paying twice. None after a policy_*
// refusal: the agent's own cap would refuse the next payment just the same.
const offersRetry = (code: ErrorCode): boolean =>
  code !== 'settlement_pending' && code !== 'replay' && !code.startsWith('policy_');

const refuse = async (
  requote: Requote,
  code: ErrorCode,
  network: X402Network,
  settlement?: SettlementResponse,
  message?: string
): Promise<Responded> => {
  const failed = failure(code, network, settlement, message);
  if (!offersRetry(code)) return failed;
  const quoted = await requote();
  // Core couldn't quote: the bare failure still tells the payer what went wrong
  if (!quoted.ok) return failed;
  const terms = encodeHeader({ ...quoted.data, error: code });
  return { ...failed, headers: { ...failed.headers, [HEADERS.paymentRequired]: terms } };
};

// Core's refusals (a spending policy, a bad request) reach the agent with Core's status and body;
// every other failure is a 503
const unavailable = (data: CoreFailure): SettledResult => {
  if (data.reason === 'refused') {
    const { status, error, message } = data;
    return {
      action: 'respond',
      status,
      headers: EXPOSE_HEADERS,
      body: { error, ...(message ? { message } : {}) }
    };
  }
  return {
    action: 'respond',
    status: STATUS.unavailable,
    headers: EXPOSE_HEADERS,
    body: { error: data.reason === 'unauthorized' ? 'unauthorized' : 'core_unavailable' }
  };
};

// The paid entry must be for this route: the split's net credit is exactly the route's price, and
// the compatibility entry's all-in total is at least it. Stops a cheap quote paying for a dear route.
const coversRoute = (accepted: PaymentPayload['accepted'], route: MatchedRoute): boolean => {
  const amount = BigInt(accepted.amount);
  return accepted.scheme === SCHEMES.koshaSplit
    ? amount === route.priceMicroUsdc
    : amount >= route.priceMicroUsdc;
};

// Core sends a Kosha code as the errorReason when it has one; anything else is a bad payload
const settleErrorCode = (settlement: SettlementResponse): ErrorCode => {
  const parsed = errorCodeSchema.safeParse(settlement.errorReason);
  return parsed.success ? parsed.data : 'invalid_payload';
};

// e.g. "rateBps=100; tdsMicroUsdc=1019; rulepack=in-2026.2"
const taxHeader = (accepted: PaymentPayload['accepted'], tdsMicroUsdc: bigint): string => {
  const parts = [`tdsMicroUsdc=${tdsMicroUsdc}`];
  if (accepted.scheme === SCHEMES.koshaSplit) {
    const { rateBps, rulepack } = accepted.extra.kosha.tax;
    parts.unshift(`rateBps=${rateBps}`);
    parts.push(`rulepack=${rulepack}`);
  }
  return parts.join('; ');
};

export const createGateHandler = (options: GateOptions) => {
  const core = createCoreClient(options);
  const matchRoute = compileRoutes(options.routes);
  const fallbackNetwork = options.network ?? X402_NETWORKS.testnet;
  const { onChainProof = true } = options;
  const proveReserve = onChainProof
    ? createReserveProver(onChainProof === true ? {} : onChainProof)
    : null;
  const termsResult: GateResult | null = options.terms
    ? {
        action: 'respond',
        status: STATUS.ok,
        headers: { 'access-control-allow-origin': '*' },
        body: buildTerms(options.routes, fallbackNetwork, options.terms)
      }
    : null;

  const preflight = (request: GateRequest): GateResult => {
    const wanted = readHeader(request.headers, 'access-control-request-method');
    if (!wanted || !matchRoute(wanted, pathOf(request.url))) {
      return { action: 'next' };
    }
    return {
      action: 'respond',
      status: STATUS.noContent,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': wanted.toUpperCase(),
        'access-control-allow-headers': CORS_ALLOWED_HEADERS.join(', ')
      },
      body: null
    };
  };

  const quoteRequest = (
    request: GateRequest,
    route: MatchedRoute,
    agent?: AgentIdentity
  ): QuoteRequest => ({
    method: request.method.toUpperCase(),
    resource: { url: request.url, description: route.description, mimeType: route.mimeType },
    priceMicroUsdc: bigintToAmount(route.priceMicroUsdc),
    agent
  });

  const quote = async (request: GateRequest, route: MatchedRoute, agent?: AgentIdentity) => {
    const quoted = await core.quote(quoteRequest(request, route, agent));
    if (!quoted.ok) {
      return unavailable(quoted.data);
    }
    return {
      action: 'respond',
      status: STATUS.paymentRequired,
      headers: { ...EXPOSE_HEADERS, [HEADERS.paymentRequired]: encodeHeader(quoted.data) },
      body: quoted.data
    } satisfies GateResult;
  };

  const pay = async (
    rawPayment: string,
    route: MatchedRoute,
    agent: AgentIdentity | undefined,
    requote: Requote,
    deferSettle: boolean
  ): Promise<GateResult> => {
    const decoded = decodeHeader(paymentPayloadSchema, rawPayment);
    if (!decoded.ok) {
      return refuse(requote, 'invalid_payload', fallbackNetwork);
    }
    const paymentPayload = decoded.data;
    const { accepted } = paymentPayload;
    if (!coversRoute(accepted, route)) {
      return refuse(requote, 'amount_mismatch', accepted.network);
    }

    const body: FacilitatorRequest = {
      x402Version: paymentPayload.x402Version,
      paymentPayload,
      paymentRequirements: accepted
    };
    const verified = await core.verify(body);
    if (!verified.ok) {
      return unavailable(verified.data);
    }
    const settle = () => settlePayment(body, route, agent, requote);
    if (!verified.data.isValid) {
      const code = verified.data.extra?.kosha.errorCode ?? 'invalid_payload';
      // A client resending the payment after a lost settle response gets replay from verify. Settle
      // answers it with the earlier result (and keeps any other transaction on a used quote as
      // replay), so it goes there now, deferred or not: the handler never runs on a bare replay.
      if (code === 'replay') return settle();
      return refuse(requote, code, accepted.network, undefined, verified.data.invalidMessage);
    }

    return deferSettle ? { action: 'verified', settle } : settle();
  };

  const settlePayment = async (
    body: FacilitatorRequest,
    route: MatchedRoute,
    agent: AgentIdentity | undefined,
    requote: Requote
  ): Promise<SettledResult> => {
    const accepted = body.paymentRequirements;
    const settled = await core.settle(body);
    if (!settled.ok) {
      return unavailable(settled.data);
    }
    const settlement = settled.data;
    if (!settlement.success) {
      return refuse(requote, settleErrorCode(settlement), accepted.network, settlement);
    }

    const proof =
      proveReserve && settlement.transaction
        ? await proveReserve(settlement.transaction, accepted)
        : { status: proveReserve ? ('unconfirmed' as const) : ('off' as const) };
    if (proof.status === 'failed') {
      // Core said settled but the chain disagrees: the API must not serve on Core's word alone. No
      // fresh quote: a transfer did land, and the payer should not be invited to pay again.
      const refused = { ...settlement, success: false, errorReason: 'amount_mismatch' } as const;
      return failure(
        'amount_mismatch',
        accepted.network,
        refused,
        `reserve proof: ${proof.reason}`
      );
    }

    const kosha = settlement.extensions?.kosha;
    const tdsMicroUsdc = BigInt(
      kosha?.tdsMicroUsdc ??
        (accepted.scheme === SCHEMES.koshaSplit ? accepted.extra.kosha.tax.tdsMicroUsdc : '0')
    );
    return {
      action: 'pass',
      headers: {
        ...EXPOSE_HEADERS,
        [HEADERS.paymentResponse]: encodeHeader(settlement),
        [HEADERS.koshaTax]: taxHeader(accepted, tdsMicroUsdc)
      },
      kosha: {
        route: route.key,
        agentId: agent ?? null,
        payer: settlement.payer ?? null,
        txId: settlement.transaction,
        hashscanUrl: kosha?.hashscanUrl ?? null,
        tdsMicroUsdc,
        hcsSequence: kosha?.hcsSequence ?? null,
        reserveProof: proof.status
      }
    };
  };

  // Quote an unpaid request, or verify and settle a paid one, before the API's handler runs
  return async (request: GateRequest, handleOptions: HandleOptions = {}): Promise<GateResult> => {
    if (request.method.toUpperCase() === 'OPTIONS') {
      return preflight(request);
    }
    const path = pathOf(request.url);
    if (termsResult && request.method.toUpperCase() === 'GET' && path === TERMS_PATH) {
      return termsResult;
    }
    const route = matchRoute(request.method, path);
    if (!route) {
      return { action: 'next' };
    }

    const agentHeader = readHeader(request.headers, HEADERS.koshaAgent);
    // A malformed identity is ignored: the caller is treated as an unverified payer
    const parsedAgent = agentIdentitySchema.safeParse(agentHeader);
    const agent = parsedAgent.success ? parsedAgent.data : undefined;
    const rawPayment =
      readHeader(request.headers, HEADERS.paymentSignature) ??
      readHeader(request.headers, HEADERS.legacyPayment);

    if (!rawPayment) {
      return quote(request, route, agent);
    }
    const requote = () => core.quote(quoteRequest(request, route, agent));
    return pay(rawPayment, route, agent, requote, handleOptions.deferSettle ?? false);
  };
};

export type GateHandler = ReturnType<typeof createGateHandler>;
