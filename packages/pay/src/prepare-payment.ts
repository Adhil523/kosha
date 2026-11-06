import { checkPolicy, type PolicyBlockReason, type PolicyWarning } from './check-policy';
import { checkTarget, type TargetRefusal } from './fetch-target';
import { signSplitPayment, type SplitRefusal } from './kosha-split-scheme';
import { type PayConfig } from './pay-config';
import { type SpendStore, withSpendLock } from './spend-store';
import { decodeHeader, encodeHeader, HEADERS, SCHEMES, X402_VERSION } from '@kosha/shared/headers';
import {
  type KoshaSplitRequirements,
  koshaSplitRequirementsSchema,
  offeredPaymentRequiredSchema,
  type PaymentPayload,
  type PaymentRequired
} from '@kosha/shared/x402-payment';

export const PAYMENT_REQUIRED_STATUS = 402;

export type PayFailureReason =
  | 'invalid_402'
  | 'no_kosha_split'
  | 'payment_rejected'
  | PolicyBlockReason
  | SplitRefusal
  | TargetRefusal;

export type PayFailure = {
  reason: PayFailureReason;
  message: string;
  // The server's 402, so a caller (or `pay.fetch`) can hand it back unchanged. `Response.error()`
  // (status 0, no body) when Pay refused the URL before contacting the server.
  response: Response;
};

// A checked, signed payment, ready for `complete()` to send
export type PreparedPayment = {
  url: string;
  init: RequestInit;
  quote: KoshaSplitRequirements;
  // The PAYMENT-SIGNATURE header value
  signature: string;
  totalMicro: bigint;
  // When `totalMicro` was recorded against the caps; a release must name the same day
  reservedAt: Date;
  warnings: PolicyWarning[];
};

export type PrepareResult =
  // The resource was free (or the server answered something other than 402)
  | { ok: true; data: { kind: 'free'; response: Response } }
  | { ok: true; data: { kind: 'payment'; payment: PreparedPayment } }
  | { ok: false; data: PayFailure };

export type PrepareDeps = {
  config: PayConfig;
  store: SpendStore;
  fetch: typeof fetch;
  now: () => Date;
};

const fail = (reason: PayFailureReason, message: string, response: Response): PrepareResult => ({
  ok: false,
  data: { reason, message, response }
});

// Adds X-KOSHA-AGENT, so Core quotes with this agent's verification level from the first call
export const withHeaders = (init: RequestInit, extra: Record<string, string>): RequestInit => {
  const headers = new Headers(init.headers);
  Object.entries(extra).forEach(([name, value]) => headers.set(name, value));
  return { ...init, headers };
};

// The quote from the PAYMENT-REQUIRED header, or from the 402 body when the header is missing.
// Entries for schemes or networks Kosha doesn't model are dropped, so they can't spoil the 402.
const readPaymentRequired = async (response: Response): Promise<PaymentRequired | null> => {
  const header = response.headers.get(HEADERS.paymentRequired);
  if (header) {
    const decoded = decodeHeader(offeredPaymentRequiredSchema, header);
    return decoded.ok ? decoded.data : null;
  }
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return null;
  }
  const parsed = offeredPaymentRequiredSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

// Step 1 of a paid call: check the host, fetch; on a 402, take the kosha-split entry, check it
// against the owner's policy, record it against the caps, and sign exactly the quoted transfer.
// Nothing is sent yet: a caller that won't send it must release it.
export const preparePayment = async (
  deps: PrepareDeps,
  url: string,
  init: RequestInit = {}
): Promise<PrepareResult> => {
  const { config, store } = deps;
  const target = checkTarget(url, config.policy.allowlist);
  if (!target.ok) {
    return fail(target.data.reason, target.data.message, Response.error());
  }
  // Only this URL's host was checked; following a redirect would reach one nobody checked
  const request = withHeaders(
    { ...init, redirect: init.redirect ?? 'manual' },
    { [HEADERS.koshaAgent]: config.agentId }
  );
  const response = await deps.fetch(url, request);
  if (response.status !== PAYMENT_REQUIRED_STATUS) {
    return { ok: true, data: { kind: 'free', response } };
  }

  const paymentRequired = await readPaymentRequired(response);
  if (!paymentRequired) {
    return fail('invalid_402', 'the 402 carried no readable PAYMENT-REQUIRED', response);
  }
  const entry = paymentRequired.accepts.find((accept) => accept.scheme === SCHEMES.koshaSplit);
  const parsedQuote = koshaSplitRequirementsSchema.safeParse(entry);
  if (!parsedQuote.success) {
    return fail('no_kosha_split', 'the 402 offered no kosha-split payment', response);
  }
  const quote = parsedQuote.data;

  const now = deps.now();
  // Checked and recorded as one step, so payments in flight together each see the others
  const policy = await withSpendLock(store, async () => {
    const checked = checkPolicy({
      policy: config.policy,
      url,
      quote,
      spent: await store.totals(now)
    });
    if (checked.ok) await store.record(now, checked.data.totalMicro);
    return checked;
  });
  if (!policy.ok) {
    return fail(policy.data.reason, policy.data.message, response);
  }
  const signed = await signSplitPayment(quote, config, now);
  if (!signed.ok) {
    await store.release(now, policy.data.totalMicro);
    return fail(signed.data.reason, `refused to sign the quote: ${signed.data.reason}`, response);
  }

  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    resource: paymentRequired.resource,
    accepted: quote,
    payload: { transaction: signed.data.transaction }
  };
  return {
    ok: true,
    data: {
      kind: 'payment',
      payment: {
        url,
        init: request,
        quote,
        signature: encodeHeader(payload),
        totalMicro: policy.data.totalMicro,
        reservedAt: now,
        warnings: policy.data.warnings
      }
    }
  };
};
