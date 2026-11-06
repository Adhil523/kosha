import { parsePayConfig, type PayConfigInput } from './pay-config';
import { readSettlement, type Receipt, toReceipt } from './pay-receipt';
import {
  type PayFailure,
  PAYMENT_REQUIRED_STATUS,
  type PreparedPayment,
  preparePayment,
  type PrepareResult,
  withHeaders
} from './prepare-payment';
import { registerAgent, type RegisterInput, type RegisterResult } from './register';
import { createMemorySpendStore, type SpendStore } from './spend-store';
import { HEADERS } from '@kosha/shared/headers';
import { type AgentIdentity } from '@kosha/shared/ids';

export type CompleteResult =
  | { ok: true; data: { response: Response; receipt: Receipt | null } }
  | { ok: false; data: PayFailure };

export type KoshaPay = {
  // Step 1: fetch, and on a 402 check and sign the quote. Sends no payment.
  prepare: (url: string, init?: RequestInit) => Promise<PrepareResult>;
  // Step 2: retry once with the signed payment
  complete: (payment: PreparedPayment) => Promise<CompleteResult>;
  // Both steps, as a drop-in fetch. When Pay won't pay, the server's 402 comes back unchanged
  // and `lastError` says why.
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  // Registers or upgrades this agent with Core through a signed challenge; no admin token needed
  register: (
    input: Omit<RegisterInput, 'identity'> & { identity?: AgentIdentity }
  ) => Promise<RegisterResult>;
  readonly lastReceipt: Receipt | null;
  readonly lastError: Omit<PayFailure, 'response'> | null;
};

export type KoshaPayDeps = {
  fetch?: typeof fetch;
  store?: SpendStore;
  now?: () => Date;
};

// Throws on invalid options, naming the fields but never their values (the key is a secret)
export const createKoshaPay = (input: PayConfigInput, deps: KoshaPayDeps = {}): KoshaPay => {
  const parsed = parsePayConfig(input);
  if (!parsed.ok) {
    const detail = 'issues' in parsed.data ? parsed.data.issues.join('; ') : parsed.data.reason;
    throw new Error(`[kosha-pay]: invalid options: ${detail}`);
  }
  const config = parsed.data;
  const store = deps.store ?? createMemorySpendStore();
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  let lastReceipt: Receipt | null = null;
  let lastError: KoshaPay['lastError'] = null;

  const prepare: KoshaPay['prepare'] = (url, init) =>
    preparePayment({ config, store, fetch: fetchImpl, now }, url, init);

  const complete: KoshaPay['complete'] = async (payment) => {
    const response = await fetchImpl(
      payment.url,
      withHeaders(payment.init, { [HEADERS.paymentSignature]: payment.signature })
    );
    const settlement = readSettlement(response);
    if (response.status === PAYMENT_REQUIRED_STATUS || settlement?.success === false) {
      const reason = settlement?.errorReason ?? 'unknown';
      return {
        ok: false,
        data: { reason: 'payment_rejected', message: `the server refused: ${reason}`, response }
      };
    }
    // Counted as spent unless the server said it failed: a lost receipt must never free up budget
    await store.record(now(), payment.totalMicro);
    const tdsMicroUsdc = BigInt(payment.quote.extra.kosha.tax.tdsMicroUsdc);
    const receipt = settlement
      ? toReceipt(settlement, { totalMicro: payment.totalMicro, tdsMicroUsdc })
      : null;
    return { ok: true, data: { response, receipt } };
  };

  const payFetch: KoshaPay['fetch'] = async (url, init) => {
    lastReceipt = null;
    lastError = null;
    const prepared = await prepare(url, init);
    if (!prepared.ok) {
      const { response, ...error } = prepared.data;
      lastError = error;
      return response;
    }
    if (prepared.data.kind === 'free') {
      return prepared.data.response;
    }
    const completed = await complete(prepared.data.payment);
    if (!completed.ok) {
      const { response, ...error } = completed.data;
      lastError = error;
      return response;
    }
    lastReceipt = completed.data.receipt;
    return completed.data.response;
  };

  const register: KoshaPay['register'] = (input) =>
    registerAgent(
      { fetch: fetchImpl, accountId: config.accountId, privateKey: config.privateKey },
      { ...input, identity: input.identity ?? config.agentId }
    );

  return {
    prepare,
    complete,
    fetch: payFetch,
    register,
    get lastReceipt() {
      return lastReceipt;
    },
    get lastError() {
      return lastError;
    }
  };
};
