import { type CompleteResult, type KoshaPay } from './kosha-pay';
import { type PreparedPayment } from './prepare-payment';
import {
  createMemorySpendStore,
  type SpendStore,
  type SpendTotals,
  withSpendLock
} from './spend-store';
import {
  AbstractPolicy,
  AgentMode,
  BaseTool,
  type Context,
  type Plugin,
  type PostCoreActionParams,
  type PostSecondaryActionParams,
  TOOL_STATUS,
  TOOL_TYPE,
  type ToolType
} from '@hashgraph/hedera-agent-kit';
import { type Client } from '@hiero-ledger/sdk';
import { formatUsdc } from '@kosha/shared/money';
import { z } from 'zod';

// The LangChain tool name; hooks and policies list it in relevantTools
export const KOSHA_PAID_FETCH = 'kosha_paid_fetch';
// The LLM reads the body; a long one would crowd out its context
const MAX_BODY_CHARS = 4_000;

const paramsSchema = z.object({ url: z.url() });
type Params = z.output<typeof paramsSchema>;

// What the LLM (and the kit's HcsAuditTrailHook, through raw.status and raw.transactionId) sees.
// Strings only: the kit runs JSON.stringify over it, which throws on bigint.
export type PaidFetchOutput = {
  raw: {
    status: string;
    url: string;
    paid: boolean;
    httpStatus?: number;
    body?: unknown;
    // Set when the body couldn't be read; on a paid call the payment still stands
    bodyError?: string;
    transactionId?: string;
    totalUsdc?: string;
    tdsUsdc?: string;
    hashscanUrl?: string;
    error?: string;
    // Set when something threw before the payment was sent, so the tool runs the audit hooks
    aborted?: boolean;
  };
  humanMessage: string;
};

// coreAction's result: a signed payment awaiting the policies, or an answer with nothing to pay
type CoreResult = { payment: PreparedPayment } | PaidFetchOutput;

const isQuoted = (result: unknown): result is { payment: PreparedPayment } =>
  typeof result === 'object' && result !== null && 'payment' in result;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Never throws: after a payment settles, a failed read must not turn it into an error
const readBody = async (
  response: Response
): Promise<Pick<PaidFetchOutput['raw'], 'body' | 'bodyError'>> => {
  let text: string;
  try {
    text = (await response.text()).slice(0, MAX_BODY_CHARS);
  } catch (error) {
    return { bodyError: `the response body could not be read: ${errorText(error)}` };
  }
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { body: text };
  }
};

// Fetches a Kosha-protected URL and pays its 402 through Kosha Pay. A BaseTool, so the kit runs
// policies between the two steps: coreAction checks and signs the quote without sending it, and
// secondaryAction sends the payment only if every policy let it through.
export class KoshaPaidFetchTool extends BaseTool<Params, Params> {
  method = KOSHA_PAID_FETCH;
  name = 'Kosha paid fetch';
  description =
    'Fetch a paid API that answers HTTP 402. Pays in USDC on Hedera through Kosha, with any Indian ' +
    'TDS reserved in your own reserve on top of the price. Returns the response body and a receipt.';
  parameters = paramsSchema;
  // It moves funds, so kit policies that act on every transaction tool cover it too
  override toolType: ToolType = TOOL_TYPE.TRANSACTION;

  constructor(private readonly pay: KoshaPay) {
    super();
  }

  async normalizeParams(params: Params): Promise<Params> {
    return paramsSchema.parse(params);
  }

  async coreAction({ url }: Params, context: Context): Promise<CoreResult> {
    // Pay signs the payer's half and the API's facilitator submits it, so there are no bytes to
    // hand back and nothing for a custom strategy to execute. Any other mode means the owner wants
    // to sign or approve each transaction, so Pay neither fetches nor pays.
    const mode = context.mode ?? AgentMode.AUTONOMOUS;
    if (mode !== AgentMode.AUTONOMOUS) {
      const message = `Kosha Pay pays only in AgentMode.AUTONOMOUS, and this agent runs in ${mode}`;
      return {
        raw: { status: TOOL_STATUS.ERROR, url, paid: false, error: `unsupported_mode: ${message}` },
        humanMessage: `Kosha Pay did not fetch or pay for ${url}: ${message}.`
      };
    }
    const prepared = await this.pay.prepare(url);
    if (!prepared.ok) {
      const { reason, message } = prepared.data;
      return {
        raw: { status: TOOL_STATUS.ERROR, url, paid: false, error: `${reason}: ${message}` },
        humanMessage: `Kosha Pay did not pay for ${url}: ${message}`
      };
    }
    if (prepared.data.kind === 'payment') return { payment: prepared.data.payment };
    const { response } = prepared.data;
    return {
      raw: {
        status: TOOL_STATUS.SUCCESS,
        url,
        paid: false,
        httpStatus: response.status,
        ...(await readBody(response))
      },
      humanMessage: `${url} answered ${response.status} without asking for payment.`
    };
  }

  // A policy that blocks here throws, and the payment Pay prepared won't be sent: free its caps
  override async postCoreActionHook(params: PostCoreActionParams<Params, Params>): Promise<void> {
    try {
      await super.postCoreActionHook(params);
    } catch (error) {
      const result: unknown = params.coreActionResult;
      if (isQuoted(result)) await this.release(params.context, result.payment);
      throw error;
    }
  }

  // Gives the caps back to Pay and to every budget policy that counted the payment
  private async release(context: Context, payment: PreparedPayment): Promise<void> {
    await this.pay.release(payment);
    const budgets = (context.hooks ?? []).filter((hook) => hook instanceof KoshaBudgetPolicy);
    for (const budget of budgets) await budget.release(payment);
  }

  override async shouldSecondaryAction(coreActionResult: CoreResult): Promise<boolean> {
    return isQuoted(coreActionResult);
  }

  override async secondaryAction(
    quoted: { payment: PreparedPayment },
    _client: Client,
    context: Context
  ): Promise<PaidFetchOutput> {
    const { url } = quoted.payment;
    let completed: CompleteResult;
    try {
      completed = await this.pay.complete(quoted.payment);
    } catch (error) {
      // The signed payment left, so it may have settled: say so, or the agent would pay again
      const message = `no answer after the payment was sent (${errorText(error)}); it may have settled`;
      return {
        raw: { status: TOOL_STATUS.ERROR, url, paid: false, error: message },
        humanMessage: `Payment for ${url} may have gone through: ${message}. Do not pay again.`
      };
    }
    if (!completed.ok) {
      // The server refused, so nothing moved; Pay has already freed its own caps
      await this.release(context, quoted.payment);
      return {
        raw: { status: TOOL_STATUS.ERROR, url, paid: false, error: completed.data.message },
        humanMessage: `Payment for ${url} was refused: ${completed.data.message}`
      };
    }
    const { response, receipt } = completed.data;
    const totalUsdc = formatUsdc(quoted.payment.totalMicro);
    const tdsUsdc = formatUsdc(receipt?.tdsMicroUsdc ?? 0n);
    return {
      raw: {
        status: TOOL_STATUS.SUCCESS,
        url,
        paid: true,
        httpStatus: response.status,
        ...(await readBody(response)),
        transactionId: receipt?.txId,
        totalUsdc,
        tdsUsdc,
        hashscanUrl: receipt?.hashscanUrl ?? undefined
      },
      humanMessage: `Paid ${totalUsdc} USDC for ${url} (TDS reserved: ${tdsUsdc} USDC).`
    };
  }

  override async handleError(error: unknown, context: Context): Promise<PaidFetchOutput> {
    const output = (await super.handleError(error, context)) as PaidFetchOutput;
    return { ...output, raw: { ...output.raw, aborted: true } };
  }

  // Every hook gets its turn, and none can change the outcome: once a payment has settled, a
  // throwing hook must not report it unpaid (the agent would pay again) or skip the audit after it
  override async postToolExecutionHook(
    params: PostSecondaryActionParams<Params, Params>
  ): Promise<PaidFetchOutput> {
    for (const hook of params.context.hooks ?? []) {
      try {
        await hook.postToolExecutionHook(params, this.method);
      } catch (error) {
        console.error(`[kosha-pay]: hook ${hook.name} failed after the call; it stands`, error);
      }
    }
    return params.toolResult as PaidFetchOutput;
  }

  // The kit runs postToolExecution hooks only when nothing threw, so a payment a policy blocked
  // would never reach the audit trail. That refusal is the event most worth auditing. Nothing
  // throws once a payment is sent (see secondaryAction and postToolExecutionHook), so an aborted
  // call was never paid and its hooks haven't run yet.
  override async execute(
    client: Client,
    context: Context,
    params: Params
  ): Promise<PaidFetchOutput> {
    const result = (await super.execute(client, context, params)) as PaidFetchOutput;
    if (!result.raw.aborted) return result;
    // The kit's error handler doesn't see the params; name the URL so the agent and the audit can
    const output = { ...result, raw: { ...result.raw, url: params.url, paid: false } };
    return this.postToolExecutionHook({
      context,
      rawParams: params,
      normalisedParams: params,
      coreActionResult: null,
      toolResult: output,
      client,
      toolType: this.toolType
    });
  }
}

export type BudgetCaps = {
  perPaymentMicro?: bigint;
  dailyMicro?: bigint;
  fyMicro?: bigint;
};

// The cap a payment of `totalMicro` would break, named with the amounts, or null if it fits
const brokenCap = (
  { perPaymentMicro, dailyMicro, fyMicro }: BudgetCaps,
  spent: SpendTotals,
  totalMicro: bigint
): string | null => {
  const usdc = (micro: bigint) => `${formatUsdc(micro)} USDC`;
  if (perPaymentMicro !== undefined && totalMicro > perPaymentMicro) {
    return `per-payment cap: ${usdc(totalMicro)} is over ${usdc(perPaymentMicro)}`;
  }
  const day = spent.dayMicro + totalMicro;
  if (dailyMicro !== undefined && day > dailyMicro) {
    return `daily cap: ${usdc(totalMicro)} would bring today to ${usdc(day)}, over ${usdc(dailyMicro)}`;
  }
  const year = spent.fyMicro + totalMicro;
  if (fyMicro !== undefined && year > fyMicro) {
    return `financial-year cap: ${usdc(totalMicro)} would bring the year to ${usdc(year)}, over ${usdc(fyMicro)}`;
  }
  return null;
};

// The owner's budget, enforced by the kit between quote and payment. Caps count the all-in total
// (price plus TDS). A quote that fits is recorded at once, under the store's lock, so two calls
// in flight can't both fit under the same headroom; the lock holds within one process, so a store
// shared between processes needs its own transaction. If a later policy blocks the payment or the
// server refuses it, the tool calls `release` and the budget is given back.
export class KoshaBudgetPolicy extends AbstractPolicy {
  name = 'Kosha budget';
  description = 'Per-payment, daily and financial-year caps on the all-in total, tax included';
  relevantTools = [KOSHA_PAID_FETCH];

  constructor(
    private readonly caps: BudgetCaps,
    private readonly store: SpendStore = createMemorySpendStore(),
    private readonly now: () => Date = () => new Date()
  ) {
    super();
  }

  // Payments this policy recorded and hasn't given back, with when it recorded them
  private readonly held = new WeakMap<PreparedPayment, Date>();

  // Throws rather than returning true, so the agent learns which cap and by how much
  protected override async shouldBlockPostCoreAction(
    params: PostCoreActionParams,
    method: string
  ): Promise<boolean> {
    const result: unknown = params.coreActionResult;
    if (!isQuoted(result)) return false;
    const { payment } = result;
    const at = this.now();
    const broken = await withSpendLock(this.store, async () => {
      const cap = brokenCap(this.caps, await this.store.totals(at), payment.totalMicro);
      if (!cap) await this.store.record(at, payment.totalMicro);
      return cap;
    });
    if (broken) throw new Error(`Action ${method} blocked by policy: ${this.name} (${broken})`);
    this.held.set(payment, at);
    return false;
  }

  // Gives back a payment this policy let through that won't go ahead after all; once only
  async release(payment: PreparedPayment): Promise<void> {
    const at = this.held.get(payment);
    if (!at) return;
    this.held.delete(payment);
    await this.store.release(at, payment.totalMicro);
  }
}

export const koshaPayPlugin = (pay: KoshaPay): Plugin => ({
  name: 'kosha-pay',
  version: '0.1.0',
  description: 'Pays x402 APIs in USDC on Hedera through Kosha, with Indian TDS handled',
  tools: () => [new KoshaPaidFetchTool(pay)]
});
